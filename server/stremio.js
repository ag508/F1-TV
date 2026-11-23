/**
 * Stremio addon client for live TV channels.
 *
 * Talks to any Stremio addon that exposes live channels through the standard
 * addon protocol (https://github.com/Stremio/stremio-addon-sdk):
 *
 *   manifest  GET {addon}/manifest.json
 *   meta      GET {addon}/meta/tv/{id}.json
 *   catalog   GET {addon}/catalog/tv/{catalogId}/{extras}.json
 *   stream    GET {addon}/stream/tv/{id}.json
 *
 * Stream responses follow the official Stream Object spec
 * (docs/api/responses/stream.md). The behaviours mirrored from Stremio's own
 * client (stremio-web + streaming server):
 *
 *  - Only actionable streams are offered (url / ytId / infoHash / externalUrl);
 *    entries without one - e.g. "support the project" placeholders - are
 *    dropped exactly like stremio-web does.
 *  - Streams are ordered highest -> lowest quality (SDK requirement); the best
 *    one is picked, quality is inferred from name/title labels (4K/1080/720).
 *  - `behaviorHints.proxyHeaders.request` are the headers the streaming server
 *    must inject when fetching the stream. We pass them to FFmpeg, which plays
 *    the same role as Stremio's local streaming server (proxy/transcode), so
 *    `notWebReady` streams work here too.
 *  - Stream URLs are signed and expiring (e.g. PenguPlay's psig + inner exp
 *    token), so they are resolved fresh at every FFmpeg spawn - never stored.
 *  - Addon requests time out (Stremio core uses ~10 s per addon); here the
 *    timeout is configurable and results are cached briefly, with single-
 *    flight deduplication so parallel health checks don't hammer the addon.
 */

const axios = require('axios');

const TIMEOUT_MS = Number(process.env.STREMIO_TIMEOUT) || 25000;
const POSITIVE_TTL_MS = 90 * 1000;   // resolved URLs are signed/short-lived
const NEGATIVE_TTL_MS = 20 * 1000;   // "no stream right now" - ask again soon

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Streams the addon returns that don't point at video (nag placeholders,
// "open in browser" links, torrents we can't use through this pipeline).
function actionable(stream) {
  if (!stream || typeof stream !== 'object') return false;
  return typeof stream.url === 'string' && /^https?:\/\//i.test(stream.url);
}

// Resolution class from the stream's labels. The `name` is checked first:
// addons put the stream quality there ("2160p", "1080p", "Auto"), while the
// description carries the channel name, which often contains misleading words
// ("Sky Sports F1 ULTRA", "(UHD/4K)") regardless of the actual stream.
function resolutionOf(stream) {
  const classify = (text) => {
    text = String(text || '').toLowerCase();
    if (/\b(4k|2160p?|uhd)\b/.test(text)) return '4k';
    if (/\b(1080p?\d*|fhd|full ?hd)\b/.test(text)) return '1080';
    if (/\b(720p?\d*|hd)\b/.test(text)) return '720';
    if (/\b(576p?|540p?|480p?|360p?|sd)\b/.test(text)) return 'sd';
    return null;
  };
  return classify(stream.name) || classify(stream.description || stream.title) || 'unknown';
}

// Preference for this pipeline, which restreams to browsers at <= 1080p.
// Unlike the Stremio app (whose native player decodes 4K HEVC directly), a
// 4K source here must be transcoded down - on a CPU-only host that runs below
// real time (measured: 4K HEVC 10-bit 50 fps -> 1080p x264 at ~0.9x) and the
// viewer buffers forever. So prefer sources that can be copied untouched:
// 1080p > 720p > unlabelled ("Auto") > 4K > SD. Ties keep the addon's order.
const PREFERENCE = { 1080: 5, 720: 4, unknown: 3, '4k': 2, sd: 1 };
const preference = (stream) => PREFERENCE[resolutionOf(stream)];

// Request headers the addon wants injected (behaviorHints.proxyHeaders.request)
function headersOf(stream) {
  const req = stream?.behaviorHints?.proxyHeaders?.request;
  if (!req || typeof req !== 'object') return null;
  const headers = {};
  for (const [key, value] of Object.entries(req)) {
    if (typeof value === 'string' && value) headers[key] = value;
  }
  return Object.keys(headers).length ? headers : null;
}

const streamInfo = (stream) => ({
  url: stream.url,
  headers: headersOf(stream),
  name: stream.name || null,
  title: stream.description || stream.title || null,
  notWebReady: !!stream.behaviorHints?.notWebReady,
  pref: preference(stream),
});

// Every addon channel a registry entry can play from: its own channelId,
// then its `fallbacks` (other channel ids, optionally on another addon).
// Live addons list the same broadcast under many ids and individual ids go
// dark (offline placeholder / upstream rejecting media) while others keep
// working - in the Stremio app you'd just pick another entry; this does that.
function sourcesOf(channel) {
  const list = [{ addon: channel.addon, channelId: channel.channelId }];
  for (const fb of Array.isArray(channel.fallbacks) ? channel.fallbacks : []) {
    const entry = typeof fb === 'string' ? { channelId: fb } : fb;
    if (entry?.channelId) list.push({ addon: entry.addon || channel.addon, channelId: entry.channelId });
  }
  return list.map((s) => ({ ...s, key: channel.key }));
}

// --- Cache + single-flight ----------------------------------------------------
// key -> { expires, result }. Entries are written ONLY by fetchStreams, once
// per real addon response, so a retry loop can never keep extending an entry
// (an earlier version re-armed the negative entry on every miss, which pinned
// a channel to "no stream" forever while its HLS session kept retrying).
const resolveCache = new Map();
// key -> { at, result }: last non-empty answer, served if the addon errors
const lastGood = new Map();
const inflight = new Map();

const cacheKeyOf = (channel) => `${channel.addon}|${channel.channelId}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Addon hosts (Cloudflare-fronted community addons) intermittently answer 502
// or a 200 with an empty body. Neither means "no stream": retry, and treat a
// body without a `streams` array as an error rather than an empty list.
const ATTEMPTS = 3;
const STALE_IF_ERROR_MS = 10 * 60 * 1000;

async function fetchStreamsUncached(channel) {
  const base = channel.addon.replace(/\/+$/, '');
  const url = `${base}/stream/tv/${encodeURIComponent(channel.channelId)}.json`;
  let lastErr;
  for (let i = 0; i < ATTEMPTS; i++) {
    if (i) await sleep(1000 * i);
    try {
      const { data } = await axios.get(url, {
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      if (!data || typeof data !== 'object' || !Array.isArray(data.streams)) {
        throw new Error('Addon returned an invalid stream response');
      }
      // Addon order is kept here; ranking happens when sources are merged
      return data.streams.filter(actionable).map(streamInfo);
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      if (status && status < 500 && status !== 429) break; // 4xx: retrying won't help
    }
  }
  throw lastErr;
}

// Cached + single-flight stream list, shared by playback resolution and health
// checks so parallel requests never hammer the addon. Errors propagate (after
// retries) unless a recent good answer exists, so callers can tell "addon
// down" from "no stream right now".
async function fetchStreams(channel, { fresh = false } = {}) {
  const cacheKey = cacheKeyOf(channel);
  const cached = resolveCache.get(cacheKey);
  if (!fresh && cached && cached.expires > Date.now()) return cached.result;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const job = fetchStreamsUncached(channel)
    .then((streams) => {
      const ttl = streams.length ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
      resolveCache.set(cacheKey, { expires: Date.now() + ttl, result: streams });
      if (streams.length) lastGood.set(cacheKey, { at: Date.now(), result: streams });
      return streams;
    })
    .catch((err) => {
      const good = lastGood.get(cacheKey);
      if (good && Date.now() - good.at < STALE_IF_ERROR_MS) {
        console.warn(`[Stremio] ${channel.key}: addon error (${err.message}), using last good stream list`);
        return good.result;
      }
      throw err;
    })
    .finally(() => inflight.delete(cacheKey));

  inflight.set(cacheKey, job);
  job.catch(() => { }); // shared promise: nobody may observe an unhandled rejection
  return job;
}

// Streams of all of a channel's sources (fetched in parallel), deduplicated
// and ranked for this pipeline: best preference first; ties keep the primary
// channel before fallbacks and each addon's own order. Throws only if every
// source failed.
async function fetchPool(channel, { fresh = false } = {}) {
  const sources = sourcesOf(channel);
  const results = await Promise.allSettled(sources.map((s) => fetchStreams(s, { fresh })));
  if (results.every((r) => r.status === 'rejected')) throw results[0].reason;
  const seen = new Set();
  const pool = [];
  results.forEach((r, sourceIdx) => {
    if (r.status !== 'fulfilled') return;
    r.value.forEach((s, idx) => {
      if (seen.has(s.url)) return;
      seen.add(s.url);
      pool.push({ s, sourceIdx, idx });
    });
  });
  return pool
    .sort((a, b) => b.s.pref - a.s.pref || a.sourceIdx - b.sourceIdx || a.idx - b.idx)
    .map(({ s }) => s);
}

/**
 * Resolve the playable source for a registry channel entry of type 'stremio':
 *   { addon: 'https://addon...', channelId: 'plaviohdtv-...' }
 * `index` picks an alternative stream (wraps around) so the HLS session can
 * rotate away from a stream that keeps failing; `fresh` bypasses the cache to
 * get newly signed URLs. Returns { url, headers, index, count }, or null when
 * the addon has nothing playable right now (or is unreachable).
 */
async function resolveSource(channel, { index = 0, fresh = false } = {}) {
  try {
    const streams = await fetchPool(channel, { fresh });
    if (!streams.length) {
      console.log(`[Stremio] ${channel.key}: no playable stream right now`);
      return null;
    }
    const i = index % streams.length;
    const pick = streams[i];
    return { url: pick.url, headers: pick.headers, index: i, count: streams.length };
  } catch (err) {
    console.warn(`[Stremio] ${channel.key}: resolve failed: ${err.message}`);
    return null;
  }
}

// Fetch the first KB of the newest media segment of a media playlist.
// true = media flows, false = upstream rejects it, null = not checkable
// (master playlist / no segments).
async function firstSegmentOk(stream, playlist, playlistUrl) {
  if (playlist.includes('#EXT-X-STREAM-INF')) return null;
  const uris = playlist.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (!uris.length) return null;
  let segUrl;
  try { segUrl = new URL(uris[uris.length - 1], playlistUrl).href; } catch { return null; }
  for (let i = 0; i < 2; i++) {
    try {
      // Stream it and stop at the first chunk: proxies often ignore Range and
      // send the whole (multi-MB) segment.
      const seg = await axios.get(segUrl, {
        timeout: 10000,
        maxRedirects: 5,
        responseType: 'stream',
        headers: { 'User-Agent': UA, Range: 'bytes=0-1023', ...(stream.headers || {}) },
      });
      const got = await new Promise((resolve) => {
        const timer = setTimeout(() => { seg.data.destroy(); resolve(false); }, 10000);
        seg.data.once('data', (chunk) => { clearTimeout(timer); seg.data.destroy(); resolve(chunk.length > 0); });
        seg.data.once('error', () => { clearTimeout(timer); resolve(false); });
        seg.data.once('end', () => { clearTimeout(timer); resolve(false); });
      });
      if (got) return true;
      throw new Error('empty segment');
    } catch (err) {
      if (i) return false;
      await sleep(1000);
    }
  }
  return false;
}

/**
 * Health check payload for a stremio channel (same shape the IPTV branch of
 * /api/stream-health produces). `probeFn(url, headers)` is the server's
 * ffprobe helper, used when the caller asks for codec/resolution details.
 */
async function checkHealth(channel, probeFn) {
  const checkedAt = new Date().toISOString();
  let streams;
  try {
    streams = await fetchPool(channel);
  } catch (err) {
    return { status: 'OFFLINE', reason: 'Addon unreachable', error: err.message, checkedAt };
  }
  if (!streams.length) {
    return { status: 'OFFLINE', reason: 'Addon returned no playable stream (channel may only broadcast during live events)', checkedAt };
  }
  // Playback rotates through the pool when a stream fails, so the channel is
  // ONLINE if any of the first few candidates actually delivers video.
  let firstFailure = null;
  for (const stream of streams.slice(0, HEALTH_CANDIDATES)) {
    const result = await checkStream(stream, probeFn);
    if (result.status === 'ONLINE') {
      return { ...result, alternatives: streams.length, checkedAt };
    }
    firstFailure = firstFailure || result;
  }
  return { ...firstFailure, alternatives: streams.length, checkedAt };
}

const HEALTH_CANDIDATES = 3;

// One stream, checked the way the pipeline will use it: playlist, a media
// segment, then (optionally) ffprobe with the injected headers.
async function checkStream(stream, probeFn) {
  try {
    const started = Date.now();
    const res = await axios.get(stream.url, {
      timeout: 12000,
      headers: { 'User-Agent': UA, ...(stream.headers || {}) },
      maxRedirects: 5,
    });
    const text = String(res.data || '');
    if (res.status !== 200 || !text.includes('#EXTM3U')) {
      return { status: 'DEGRADED', reason: 'Stream resolved but the playlist did not load' };
    }
    // A playlist can load while its origin rejects the media itself (seen
    // with addon proxies: playlist 200, every segment 502). Check one segment.
    const segOk = await firstSegmentOk(stream, text, res.request?.res?.responseUrl || stream.url);
    if (segOk === false) {
      return { status: 'DEGRADED', reason: 'Playlist loads but the upstream rejects the video segments' };
    }
    const source = probeFn ? await probeFn(stream.url, stream.headers).catch(() => null) : null;
    if (source?.audioOnly) {
      return { status: 'DEGRADED', reason: 'Upstream is sending audio only (no video track)' };
    }
    return {
      status: 'ONLINE',
      stream: { name: stream.name, title: stream.title },
      latencyMs: Date.now() - started,
      source,
    };
  } catch (err) {
    return { status: 'DEGRADED', reason: `Stream resolved but unreachable: ${err.message}` };
  }
}

module.exports = { resolveSource, checkHealth };
