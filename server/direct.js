/**
 * Direct playback of addon HLS streams (Stremio-style).
 *
 * Stremio's web player (stremio-video) probes a stream and, when the browser
 * can decode it, plays the ORIGINAL HLS with hls.js - only routing it through
 * the streaming server's `/proxy/` to inject `behaviorHints.proxyHeaders`.
 * Only streams the browser can't decode go through a transcoder (`/hlsv2`).
 * That is why addon channels are so consistent in Stremio: no re-encode, no
 * re-segmenting, no FFmpeg restarts - the player sees the source as-is.
 *
 * This module does the same for our server, as a thin HLS proxy:
 *  - playlists are fetched from the source and their URIs rewritten to opaque
 *    tokens under /hls/<key>/d/<gen>/..., so upstream URLs and headers stay
 *    server-side (and mixed-content / CORS issues don't reach the browser);
 *  - segments are relayed byte-for-byte, with the addon's request headers,
 *    retries on transient upstream errors, and a shared in-memory cache with
 *    single-flight + prefetch so every viewer is served from one upstream
 *    fetch per segment;
 *  - when a source dies (playlist/segments keep failing, or the provider's
 *    one-segment "offline" placeholder appears) the session rotates to the
 *    next stream of the channel's pool. Old playlist URLs then answer 410, the
 *    player rebuilds and rejoins on the new source.
 *
 * Sources the browser can't decode (HEVC, E-AC3...) are reported as
 * incompatible, and the caller falls back to the FFmpeg restream (hls.js).
 */

const crypto = require('crypto');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Codecs browsers decode inside HLS via MSE (what stremio-video accepts too)
const DIRECT_VIDEO = new Set(['h264']);
const DIRECT_AUDIO = new Set(['aac', 'mp3']);

const IDLE_MS = 60 * 1000;                 // no requests for this long -> drop session
const PLAYLIST_TTL_MS = 1000;              // coalesce playlist reloads across viewers
const SEGMENT_CACHE_BYTES = (Number(process.env.DIRECT_CACHE_MB) || 256) * 1024 * 1024;
const SEGMENT_TIMEOUT_MS = 45 * 1000;
const PLAYLIST_TIMEOUT_MS = 12 * 1000;
const ROTATE_AFTER_FAILURES = 3;           // consecutive upstream failures before switching source
const TOKEN_TTL_MS = 15 * 60 * 1000;
const PREPARE_MS = 60 * 1000;              // resolve + playlist + probe, worst case

// Keep-alive pools: segment after segment goes to the same origin
const agents = {
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 32 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 32 }),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTransient = (err) => {
  const status = err.response?.status;
  return !status || status >= 500 || status === 429 || status === 408;
};

// --- Upstream fetch with retries ------------------------------------------------

async function fetchUpstream(url, headers, { responseType = 'text', timeout, attempts = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(500 * i);
    try {
      const res = await axios.get(url, {
        ...agents,
        timeout,
        responseType,
        maxRedirects: 5,
        headers: { 'User-Agent': UA, ...(headers || {}) },
        // Some origins send playlists as octet-stream; never let axios parse JSON
        transformResponse: (d) => d,
      });
      return { data: res.data, finalUrl: res.request?.res?.responseUrl || url, contentType: res.headers['content-type'] };
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) break;
    }
  }
  throw lastErr;
}

// --- Token map: opaque id -> upstream URL ----------------------------------------

// A segment's identity is its URL minus volatile signing parameters. Origins
// and addon proxies (PenguPlay's `psig`, CDN tokens...) re-sign every URI on
// every playlist fetch; if the token followed the full URL, the same media
// sequence number would get a new URI on each reload, which hls.js rejects
// ("media sequence mismatch") - and the shared cache would never hit.
const VOLATILE_PARAMS = /^(psig|sig|signature|token|t|exp|expires|e|st|hdnts|hdnea|auth|wmsauthsign|md5|hash|ck|nonce|ts)$/i;
function identityOf(url) {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) if (VOLATILE_PARAMS.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch { return url; }
}

const tokens = new Map(); // tok -> { url (newest signed), at }
function tokenFor(url) {
  const tok = crypto.createHash('sha1').update(identityOf(url)).digest('base64url').slice(0, 22);
  tokens.set(tok, { url, at: Date.now() });
  return tok;
}

// --- Shared segment cache (LRU by bytes) + single-flight -------------------------

const segCache = new Map(); // url -> { buf, type }
let segBytes = 0;
const segInflight = new Map();

function cachePut(url, entry) {
  if (segCache.has(url)) return;
  segCache.set(url, entry);
  segBytes += entry.buf.length;
  for (const [k, v] of segCache) {
    if (segBytes <= SEGMENT_CACHE_BYTES) break;
    segCache.delete(k);
    segBytes -= v.buf.length;
  }
}

// Cached by segment identity; fetched with the newest signed URL
function getSegment(url, headers) {
  const id = identityOf(url);
  const hit = segCache.get(id);
  if (hit) {
    segCache.delete(id); segCache.set(id, hit); // LRU touch
    return Promise.resolve(hit);
  }
  if (segInflight.has(id)) return segInflight.get(id);
  const job = fetchUpstream(url, headers, { responseType: 'arraybuffer', timeout: SEGMENT_TIMEOUT_MS })
    .then(({ data, contentType }) => {
      const entry = { buf: Buffer.from(data), type: contentType };
      if (!entry.buf.length) throw new Error('empty segment');
      cachePut(id, entry);
      return entry;
    })
    .finally(() => segInflight.delete(id));
  segInflight.set(id, job);
  job.catch(() => { });
  return job;
}

// --- Playlist rewriting ---------------------------------------------------------

const segmentExt = (url) => {
  try {
    const m = new URL(url).pathname.match(/\.(ts|m4s|mp4|aac|m4a|vtt|key|bin)$/i);
    return m ? m[1].toLowerCase() : 'ts';
  } catch { return 'ts'; }
};

// Rewrite every URI in a playlist to /hls/<key>/d/<gen>/<tok>.<ext>.
// Variant/rendition playlists get .m3u8, everything else is media/keys.
function rewritePlaylist(text, baseUrl, prefix) {
  const abs = (u) => new URL(u, baseUrl).href;
  const route = (u) => {
    const url = abs(u);
    const isPlaylist = /\.m3u8?$/i.test(new URL(url).pathname);
    return `${prefix}/${tokenFor(url)}.${isPlaylist ? 'm3u8' : segmentExt(url)}`;
  };
  const isMaster = text.includes('#EXT-X-STREAM-INF');
  let expectVariant = false;
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) {
      if (t.startsWith('#EXT-X-STREAM-INF')) expectVariant = true;
      // URI="..." attributes: keys, init segments, alternate renditions, i-frames
      return line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${route(u)}"`);
    }
    if (isMaster || expectVariant) {
      expectVariant = false;
      const url = abs(t);
      return `${prefix}/${tokenFor(url)}.m3u8`;
    }
    return route(t);
  }).join('\n');
}

// Segment URIs of a media playlist (absolute), newest last
function segmentUris(text, baseUrl) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(u => new URL(u, baseUrl).href);
}

// Browser-playability from a master playlist's CODECS attributes. Returns
// null when the playlist declares none (media playlist, or attribute missing).
// avc1/avc3 = H.264, mp4a = AAC/MP3; hvc1/hev1 (HEVC), ec-3/ac-3, etc. aren't
// reliably decodable through MSE across browsers.
function codecsCompat(text) {
  if (!text.includes('#EXT-X-STREAM-INF')) return null;
  // hls.js drops variants whose codecs the browser can't play, so one fully
  // playable variant is enough
  const variants = [...text.matchAll(/^#EXT-X-STREAM-INF:.*CODECS="([^"]+)"/gm)]
    .map((m) => m[1].split(',').map((c) => c.trim().toLowerCase()));
  if (!variants.length) return null;
  const ok = variants.some((v) => v.every((c) => /^(avc1|avc3|mp4a)\b/.test(c)));
  return { ok, codecs: [...new Set(variants.flat())] };
}

// Warm the shared cache with the newest segments of a media playlist, so they
// are local by the time hls.js asks. hls.js starts ~3 segments behind live,
// so the newest 4 cover the start and the next fetch for every viewer.
const PREFETCH_SEGMENTS = 4;
function prefetch(text, baseUrl, headers) {
  if (text.includes('#EXT-X-STREAM-INF')) return;
  for (const u of segmentUris(text, baseUrl).slice(-PREFETCH_SEGMENTS)) getSegment(u, headers);
}

// Sample-based encryption (SAMPLE-AES, SAMPLE-AES-CTR / CENC) needs EME/DRM
// in the browser and can't be remuxed by FFmpeg without keys either. Whole-
// segment AES-128 is fine: hls.js decrypts it itself.
const isSampleEncrypted = (text) => /#EXT-X-KEY:[^\n]*METHOD=SAMPLE-AES/i.test(text);

// Fetch the newest segment of the playlist (or of its first variant, for a
// master). Returns null when media flows, or the reason it can't play.
async function verifyMedia(text, baseUrl, headers) {
  try {
    if (isOfflinePlaceholder(text)) return 'provider offline placeholder';
    if (text.includes('#EXT-X-STREAM-INF')) {
      const variant = segmentUris(text, baseUrl)[0];
      if (!variant) return 'empty master playlist';
      const sub = await fetchUpstream(variant, headers, { timeout: PLAYLIST_TIMEOUT_MS });
      text = String(sub.data);
      baseUrl = sub.finalUrl;
      if (isOfflinePlaceholder(text)) return 'provider offline placeholder';
    }
    if (isSampleEncrypted(text)) return { problem: 'encrypted (SAMPLE-AES), not playable without DRM' };
    const segs = segmentUris(text, baseUrl);
    if (!segs.length) return { problem: 'no segments' };
    const seg = await getSegment(segs[segs.length - 1], headers);
    return { segment: seg.buf };
  } catch (err) {
    return { problem: `segments unreachable (${err.response?.status || err.message})` };
  }
}

// Codecs of an already-downloaded segment (ffprobe over stdin): instant, and
// no second round-trip to a flaky origin. Works for MPEG-TS / self-contained
// segments; fMP4 media segments need their init segment, so this returns null
// and the caller falls back to probing the URL.
function probeBuffer(buf, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,height', '-of', 'json', '-i', 'pipe:0'],
      { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); proc.stdout.destroy(); resolve(null); }, timeoutMs);
    proc.stdout.on('data', (d) => (out += d));
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const streams = JSON.parse(out).streams || [];
        const v = streams.find((s) => s.codec_type === 'video');
        const a = streams.find((s) => s.codec_type === 'audio');
        resolve(v ? { vcodec: v.codec_name, height: v.height || 0, acodec: a?.codec_name } : null);
      } catch { resolve(null); }
    });
    proc.stdin.on('error', () => { }); // ffprobe may close stdin early once it has enough
    proc.stdin.end(buf);
  });
}

// The provider "channel offline" placeholder: a finished one-segment playlist
// served in place of a live stream (seen on PenguPlay's trtv origin).
const isOfflinePlaceholder = (text) =>
  text.includes('#EXT-X-ENDLIST') && !text.includes('#EXT-X-STREAM-INF') && (text.match(/#EXTINF/g) || []).length <= 1;

// --- Sessions -------------------------------------------------------------------

class DirectSession {
  constructor(key, resolveSource, probe) {
    this.key = key;
    this.resolveSource = resolveSource;
    this.probe = probe;
    this.gen = 1;               // bumps whenever the source changes
    this.index = 0;             // which stream of the channel's pool
    this.fresh = false;
    this.source = null;         // { url, headers, count }
    this.compat = null;         // null = unknown, true/false after probe
    this.failures = 0;
    this.lastAccess = Date.now();
    this.playlists = new Map(); // upstream url -> { at, promise }
    this.preparing = null;
  }

  touch() { this.lastAccess = Date.now(); }
  get active() { return Date.now() - this.lastAccess < 15000; }

  // Resolve + probe the current source once per generation
  prepare() {
    if (this.source && this.compat !== null) return Promise.resolve();
    if (this.preparing) return this.preparing;
    const work = (async () => {
      const src = await this.resolveSource({ index: this.index, fresh: this.fresh });
      this.fresh = false;
      if (!src?.url) throw Object.assign(new Error('Addon has no playable stream right now'), { status: 503 });
      this.index = src.index || 0;
      this.source = src;
      // 1) A master playlist's CODECS attributes are authoritative (hls.js
      //    relies on them too) and cover audio in separate renditions, which
      //    ffprobe often misses. 2) Otherwise probe the media like Stremio's
      //    /hlsv2/probe does.
      // 0) Make sure media actually flows before handing the stream to the
      //    player: providers often serve a fine playlist whose segments are
      //    403/502 ("Unauthorized domain", "upstream rejected media"). Fetching
      //    the newest segment also warms the shared cache.
      const entry = await this.playlist(src.url).catch(() => null);
      if (!entry) throw Object.assign(new Error('playlist unreachable'), { dead: true });
      const media = await verifyMedia(String(entry.data), entry.finalUrl, src.headers);
      if (media.problem) throw Object.assign(new Error(media.problem), { dead: true });
      let declared = null;
      try { declared = codecsCompat(String(entry.data)); } catch { /* probe instead */ }
      let p = null;
      if (declared === null) {
        p = await probeBuffer(media.segment);
        if (!p) p = await this.probe(src.url, src.headers);
      }
      // Unknown codecs (probe failed): try direct; hls.js tells us if it can't
      this.compat = declared !== null ? declared.ok
        : !p || (DIRECT_VIDEO.has(p.vcodec) && (!p.acodec || DIRECT_AUDIO.has(p.acodec)));
      this.probeInfo = p || declared;
      const what = declared ? `CODECS ${declared.codecs.join(',')}` : p ? `${p.vcodec} ${p.height}p / ${p.acodec || 'no audio'}` : 'probe failed';
      console.log(`[Direct ${this.key}] stream ${this.index + 1}/${src.count || 1}: ${what} -> ${this.compat ? 'direct' : 'restream (codec not browser-playable)'}`);
    })();
    // Never let one slow step wedge the channel: give up after PREPARE_MS,
    // the next request starts over.
    let timer;
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Source is slow to respond, retrying'), { status: 503 })), PREPARE_MS);
    });
    this.preparing = Promise.race([work, limit]).finally(() => { clearTimeout(timer); this.preparing = null; });
    work.catch(() => { });
    return this.preparing;
  }

  // Source keeps failing: next stream of the pool, fresh signed URLs
  rotate(reason) {
    console.warn(`[Direct ${this.key}] rotating source (${reason})`);
    this.gen++;
    this.index++;
    this.fresh = true;
    this.source = null;
    this.compat = null;
    this.failures = 0;
    this.playlists.clear();
  }

  fail(reason) {
    this.failures++;
    if (this.failures >= ROTATE_AFTER_FAILURES) this.rotate(reason);
  }

  async playlist(url) {
    const cached = this.playlists.get(url);
    if (cached && Date.now() - cached.at < PLAYLIST_TTL_MS) return cached.promise;
    const promise = fetchUpstream(url, this.source.headers, { timeout: PLAYLIST_TIMEOUT_MS });
    this.playlists.set(url, { at: Date.now(), promise });
    promise.catch(() => this.playlists.delete(url));
    return promise;
  }

  prefix(baseKey) { return `/hls/${encodeURIComponent(baseKey)}/d/${this.gen}`; }
}

const sessions = new Map(); // key -> DirectSession

setInterval(() => {
  const now = Date.now();
  for (const [key, s] of sessions) if (now - s.lastAccess > IDLE_MS) sessions.delete(key);
  for (const [tok, t] of tokens) if (now - t.at > TOKEN_TTL_MS) tokens.delete(tok);
}, 30000).unref();

function getDirectSession(key, resolveSource, probe) {
  let s = sessions.get(key);
  if (!s) { s = new DirectSession(key, resolveSource, probe); sessions.set(key, s); }
  s.touch();
  return s;
}

const isKeyActive = (key) => !!sessions.get(key)?.active;

const PLAYLIST_HEADERS = {
  'Content-Type': 'application/vnd.apple.mpegurl',
  'Cache-Control': 'no-cache, no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-Stream-Mode',
  'X-Stream-Mode': 'direct',
};

/**
 * Entry playlist for a direct-capable channel. Resolves `{ handled: true }`
 * when it has answered the request, or `{ handled: false, index }` when the
 * working source isn't browser-playable: the caller then restreams it with
 * FFmpeg, starting from that (already verified) stream of the pool.
 */
const ENTRY_ATTEMPTS = 5;
async function serveEntry(req, res, known, probe) {
  const s = getDirectSession(known.key, known.resolveSource, probe);
  for (let attempt = 0; attempt < ENTRY_ATTEMPTS; attempt++) {
    try {
      await s.prepare();
    } catch (err) {
      // Dead stream: skip it here, before the player ever sees it
      if (err.dead) { s.rotate(err.message); continue; }
      res.status(503).set('Retry-After', '3').send(err.message);
      return { handled: true };
    }
    if (!s.compat) return { handled: false, index: s.index };
    try {
      const { data, finalUrl } = await s.playlist(s.source.url);
      const text = String(data);
      if (!text.includes('#EXTM3U') || isOfflinePlaceholder(text)) {
        s.rotate(isOfflinePlaceholder(text) ? 'provider offline placeholder' : 'not a playlist');
        continue;
      }
      s.failures = 0;
      prefetch(text, finalUrl, s.source.headers);
      res.set(PLAYLIST_HEADERS).send(rewritePlaylist(text, finalUrl, s.prefix(known.key)));
      return { handled: true };
    } catch (err) {
      s.rotate(`entry playlist failed: ${err.response?.status || err.message}`);
    }
  }
  res.status(503).set('Retry-After', '3').send('No working source right now, retrying');
  return { handled: true };
}

function registerRoutes(app, resolveChannel) {
  // Media playlists and segments of a direct session
  app.get('/hls/:channel/d/:gen/:tok.:ext', async (req, res) => {
    const { channel, gen, tok, ext } = req.params;
    const s = sessions.get(channel);
    const t = tokens.get(tok);
    if (!s || !resolveChannel(channel)) return res.status(404).end();
    s.touch();
    // Source switched since this URL was handed out: make the player reload
    // the entry playlist (hls.js does not retry 4xx -> fatal -> rebuild).
    if (Number(gen) !== s.gen || !t || !s.source) return res.status(410).end();
    t.at = Date.now();

    if (ext === 'm3u8') {
      try {
        const { data, finalUrl } = await s.playlist(t.url);
        const text = String(data);
        if (isOfflinePlaceholder(text)) {
          s.rotate('provider offline placeholder');
          return res.status(410).end();
        }
        s.failures = 0;
        prefetch(text, finalUrl, s.source.headers);
        return res.set(PLAYLIST_HEADERS).send(rewritePlaylist(text, finalUrl, s.prefix(channel)));
      } catch (err) {
        s.fail(`playlist ${err.response?.status || err.message}`);
        return res.status(503).set('Retry-After', '1').end();
      }
    }

    try {
      const seg = await getSegment(t.url, s.source.headers);
      s.failures = 0;
      res.set({
        'Content-Type': seg.type || (ext === 'ts' ? 'video/mp2t' : 'application/octet-stream'),
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      }).send(seg.buf);
    } catch (err) {
      s.fail(`segment ${err.response?.status || err.message}`);
      res.status(err.response?.status === 404 ? 404 : 502).end();
    }
  });

  app.get('/api/direct/sessions', (_req, res) => res.json({
    cacheMB: Math.round(segBytes / 1048576),
    sessions: [...sessions.values()].map((s) => ({
      key: s.key, gen: s.gen, stream: s.index + 1, of: s.source?.count || null, compat: s.compat,
      source: s.probeInfo || null, active: s.active,
    })),
  }));
}

module.exports = { serveEntry, registerRoutes, isKeyActive };
