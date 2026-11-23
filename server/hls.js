/**
 * Supervised HLS restreaming with a DVR window and adaptive bitrate (ABR).
 *
 * One FFmpeg process per (account, channel, profile) writes rolling HLS
 * segments to a temp directory; every viewer reads the same files. Compared to
 * piping raw MPEG-TS this means:
 *  - a viewer that buffers or drops its connection resumes from the segments
 *    that are still on disk instead of losing that part of the broadcast,
 *  - a slow viewer never back-pressures the encoder for everybody else,
 *  - if the upstream source drops, FFmpeg is restarted automatically and the
 *    playlist continues (marked with a discontinuity) without kicking viewers.
 *
 * ABR ('abr' profile, the default): FFmpeg encodes a ladder of renditions
 * (by default three 1080p bitrates) with keyframes aligned at segment
 * boundaries and writes a master playlist. The player measures each viewer's
 * connection and switches rendition per segment, so a viewer whose bandwidth
 * drops below the top bitrate gets a lighter 1080p stream instead of
 * buffering. Encoding uses the Intel iGPU (VAAPI / Quick Sync) when available,
 * which keeps several 1080p50 encodes off the CPU.
 */

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(os.tmpdir(), 'f1tv-hls');
const SEGMENT_SECONDS = 2;
const DVR_SECONDS = Number(process.env.HLS_DVR_SECONDS) || 600;
const IDLE_TIMEOUT_MS = 60 * 1000;
const STALL_TIMEOUT_MS = 20 * 1000;
const DYNAMIC_STALL_TIMEOUT_MS = 30 * 1000;
// How long the entry playlist request waits for a starting stream before
// answering 503 + Retry-After. Must stay below the player's manifest timeout
// (client Player.jsx: 30 s), or the browser aborts before we ever answer.
const MANIFEST_WAIT_MS = 25 * 1000;
const FAST_FAIL_MS = 15000;
const UA = 'VLC/3.0.18 LibVLC/3.0.18';

// --- Configuration -----------------------------------------------------------

// 'auto' (detect VAAPI at startup), 'vaapi' (require it) or 'none' (CPU only)
const HWACCEL = (process.env.HLS_HWACCEL || 'auto').toLowerCase();
const VAAPI_DEVICE = process.env.HLS_VAAPI_DEVICE || '/dev/dri/renderD128';
// Profile for registry channels that don't pin one
const DEFAULT_PROFILE = process.env.HLS_DEFAULT_PROFILE || 'abr';
// Allow the ABR ladder on the CPU when no GPU is available (heavy: one x264
// encode per rendition). Off by default - without a GPU 'abr' falls back to a
// single rendition.
const ABR_SOFTWARE = process.env.HLS_ABR_SOFTWARE === '1';
const X264_PRESET = process.env.X264_PRESET || 'veryfast';

// Ladder: comma-separated "height:kbps[:fps]". Default keeps 1080p on every
// rung. Two rungs run at 25 fps: halving the frame rate halves decode load on
// devices that drop frames at 50 fps, while keeping (or raising) the bits per
// frame - so the player can fix stutter without dropping to a blurrier
// rendition. 6000/50 -> 120 kb/frame, 4000/25 -> 160, 3000/50 -> 60, 2000/25 -> 80.
function parseLadder(spec) {
  return spec.split(',').map(s => s.trim()).filter(Boolean).map(rung => {
    const [height, kbps, fps] = rung.split(':').map(Number);
    return { height: height || 1080, kbps: kbps || 4000, fps: fps || null };
  }).sort((a, b) => b.kbps - a.kbps);
}
const LADDER = parseLadder(process.env.HLS_ABR_LADDER || '1080:6000,1080:4000:25,1080:3000,1080:2000:25');
const SINGLE_KBPS = parseInt(process.env.HLS_1080P_BITRATE || '6000', 10);

// Codecs a browser can play directly inside an MPEG-TS/HLS stream
const BROWSER_VIDEO = new Set(['h264', 'avc1']);
const BROWSER_AUDIO = new Set(['aac']);
const PROFILES = new Set(['abr', 'auto', '1080p', 'source']);

// FFmpeg args carrying custom HTTP headers for the source (Stremio addons may
// require a specific User-Agent/Referer on their streams, mirroring what
// Stremio's streaming server injects via behaviorHints.proxyHeaders.request).
function headerArgs(headers) {
  const custom = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (typeof v === 'string' && v) custom[k.toLowerCase() === 'user-agent' ? 'User-Agent' : k] = v;
  }
  const ua = custom['User-Agent'] || UA;
  delete custom['User-Agent'];
  const args = ['-user_agent', ua];
  const text = Object.entries(custom).map(([k, v]) => `${k}: ${v}`).join('\r\n');
  if (text) args.push('-headers', `${text}\r\n`);
  return args;
}

const keyframeArgs = ['-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`];
const rateArgs = (kbps, idx = '') => [
  `-b:v${idx}`, `${kbps}k`, `-maxrate:v${idx}`, `${Math.round(kbps * 1.2)}k`, `-bufsize:v${idx}`, `${kbps * 2}k`
];
const AUDIO_AAC = ['-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '128k'];

// --- Hardware detection --------------------------------------------------------

// Encode a few frames on the GPU once at startup. Device files alone aren't
// enough: the driver (intel-media-driver / iHD for UHD 630) must work too.
let hwPromise = null;
function detectHardware() {
  if (hwPromise) return hwPromise;
  hwPromise = new Promise((resolve) => {
    if (HWACCEL === 'none') return resolve(null);
    if (!fs.existsSync(VAAPI_DEVICE)) {
      console.log(`[HLS] No GPU device at ${VAAPI_DEVICE} - using CPU encoding`);
      return resolve(null);
    }
    const proc = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-init_hw_device', `vaapi=va:${VAAPI_DEVICE}`, '-filter_hw_device', 'va',
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25', '-frames:v', '10',
      '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-f', 'null', '-'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), 20000);
    proc.stderr.on('data', d => (err += d));
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        console.log(`[HLS] Intel VAAPI hardware encoding available (${VAAPI_DEVICE})`);
        resolve('vaapi');
      } else {
        console.warn(`[HLS] VAAPI test failed - using CPU encoding. ${err.trim().split('\n').slice(-2).join(' | ')}`);
        resolve(null);
      }
    });
  });
  return hwPromise;
}
detectHardware();

// --- Source probing ---------------------------------------------------------

function probeSource(url, timeoutMs = 12000, headers = null) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', ...headerArgs(headers), '-rw_timeout', '10000000',
      '-analyzeduration', '4000000', '-probesize', '5000000',
      '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate', '-of', 'json', url
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', d => (out += d));
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const streams = JSON.parse(out).streams || [];
        const v = streams.find(s => s.codec_type === 'video');
        const a = streams.find(s => s.codec_type === 'audio');
        if (!v) return resolve(null);
        const [num, den] = String(v.avg_frame_rate || '0/1').split('/').map(Number);
        const fps = den ? num / den : 0;
        resolve({ vcodec: v.codec_name, height: v.height || 0, acodec: a?.codec_name, fps: fps > 0 && fps < 121 ? fps : null });
      } catch { resolve(null); }
    });
  });
}

// --- FFmpeg argument builders ------------------------------------------------
//
// An "attempt" describes one way to run FFmpeg:
//   kind: 'copy' | 'single' (one transcoded rendition) | 'abr' (ladder)
//   hw:   'vaapi' (GPU decode + encode) | 'vaapi-swdec' (CPU decode, GPU
//         encode - for codecs the GPU can't decode) | null (CPU only)

const isHlsUrl = (url) => {
  try { return /\.m3u8$/i.test(new URL(url).pathname); } catch { return false; }
};

function inputArgs(attempt, session) {
  const hwIn = attempt.hw === 'vaapi'
    ? ['-hwaccel', 'vaapi', '-hwaccel_device', VAAPI_DEVICE, '-hwaccel_output_format', 'vaapi']
    : attempt.hw === 'vaapi-swdec'
      ? ['-init_hw_device', `vaapi=va:${VAAPI_DEVICE}`, '-filter_hw_device', 'va']
      : [];
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-fflags', '+genpts+discardcorrupt',
    '-analyzeduration', '5000000', '-probesize', '5000000',
    ...hwIn,
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1',
    // Addon/CDN proxies answer transient 502/503s; retry them instead of
    // letting the very first playlist request kill FFmpeg.
    '-reconnect_on_http_error', '5xx',
    '-reconnect_delay_max', '10',
    '-rw_timeout', '15000000',
    // HLS sources (addon streams): ride out flaky playlist reloads/segments
    // instead of exiting after FFmpeg's default 3 reload failures. These are
    // HLS-demuxer options - FFmpeg rejects them for any other input format.
    ...(isHlsUrl(session.sourceUrl) ? ['-max_reload', '20', '-m3u8_hold_counters', '20', '-seg_max_retry', '5'] : []),
    ...headerArgs(session.sourceHeaders),
    '-i', session.sourceUrl
  ];
}

// Filter chain that turns decoded source frames into one rendition's frames
function scaleFilter(attempt, rung) {
  const fps = rung.fps ? `fps=${rung.fps},` : '';
  if (attempt.hw === 'vaapi') return `${fps}scale_vaapi=w=-2:h=${rung.height}:format=nv12`;
  if (attempt.hw === 'vaapi-swdec') return `${fps}format=nv12,hwupload,scale_vaapi=w=-2:h=${rung.height}:format=nv12`;
  return `${fps}scale=-2:${rung.height}:flags=bicubic,format=yuv420p`;
}

function encoderArgs(attempt, rung, idx) {
  const s = idx === undefined ? '' : `:${idx}`;
  if (attempt.hw) return [`-c:v${s}`, 'h264_vaapi', `-profile:v${s}`, 'high', ...rateArgs(rung.kbps, s)];
  return [`-c:v${s}`, 'libx264', `-preset${s}`, X264_PRESET, `-profile:v${s}`, 'high', ...rateArgs(rung.kbps, s)];
}

function hlsArgs() {
  return [
    '-max_muxing_queue_size', '2048',
    '-f', 'hls',
    '-hls_time', String(SEGMENT_SECONDS),
    '-hls_list_size', String(Math.ceil(DVR_SECONDS / SEGMENT_SECONDS)),
    '-hls_flags', 'delete_segments+append_list+discont_start+omit_endlist+independent_segments+temp_file',
  ];
}

function buildArgs(attempt, session) {
  const dir = session.dir;
  const input = inputArgs(attempt, session);

  if (attempt.kind === 'copy') {
    return [...input, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy',
      ...(attempt.copyAudio ? ['-c:a', 'copy'] : AUDIO_AAC),
      ...hlsArgs(), '-hls_segment_filename', path.join(dir, 'seg_%06d.ts'), path.join(dir, 'index.m3u8')];
  }

  if (attempt.kind === 'single') {
    const rung = { height: 1080, kbps: SINGLE_KBPS };
    return [...input, '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', scaleFilter(attempt, rung), ...encoderArgs(attempt, rung),
      ...keyframeArgs, ...(attempt.hw ? [] : ['-sc_threshold', '0']), ...AUDIO_AAC,
      ...hlsArgs(), '-hls_segment_filename', path.join(dir, 'seg_%06d.ts'), path.join(dir, 'index.m3u8')];
  }

  // ABR ladder: decode once, split, scale/encode each rung. Forced keyframes
  // on the same timestamps keep segments aligned across renditions so the
  // player can switch seamlessly at any segment boundary.
  const n = LADDER.length;
  const split = `[0:v]split=${n}${LADDER.map((_, i) => `[s${i}]`).join('')}`;
  const chains = LADDER.map((rung, i) => `[s${i}]${scaleFilter(attempt, rung)}[v${i}]`);
  const maps = [];
  LADDER.forEach((rung, i) => maps.push('-map', `[v${i}]`, ...encoderArgs(attempt, rung, i)));
  LADDER.forEach(() => maps.push('-map', '0:a:0'));
  for (let i = 0; i < n; i++) fs.mkdirSync(path.join(dir, `v${i}`), { recursive: true });
  // Forward slashes: FFmpeg writes variant URIs into the master playlist
  // relative to these paths, and they must be URL paths on every OS.
  const out = dir.split(path.sep).join('/');
  return [...input,
    '-filter_complex', [split, ...chains].join(';'),
    ...maps,
    ...keyframeArgs, ...(attempt.hw ? [] : ['-sc_threshold', '0']), ...AUDIO_AAC,
    ...hlsArgs(),
    '-master_pl_name', 'index.m3u8',
    '-var_stream_map', LADDER.map((_, i) => `v:${i},a:${i}`).join(' '),
    '-hls_segment_filename', `${out}/v%v/seg_%06d.ts`,
    `${out}/v%v/stream.m3u8`];
}

const attemptLabel = (a) => {
  const where = a.hw === 'vaapi' ? 'GPU' : a.hw === 'vaapi-swdec' ? 'CPU decode + GPU encode' : 'CPU';
  if (a.kind === 'copy') return `copy ${a.note || ''}`.trim();
  if (a.kind === 'single') return `transcode→1080p ${SINGLE_KBPS}k (${where})${a.note ? ` ${a.note}` : ''}`;
  return `ABR ${LADDER.map(r => `${r.height}p${r.fps ? r.fps : ''}@${r.kbps}k`).join(' / ')} (${where})`;
};

// FFmpeg exited quickly because of the encoder/GPU/filters, not the source?
// Only those failures should make us fall back to a lighter pipeline.
const NETWORK_ERROR = /Connection (refused|reset|timed out)|timed out|Server returned|HTTP error|I\/O error|End of file|Input\/output error|Network is unreachable|could not resolve|Failed to resolve/i;

// --- Sessions -----------------------------------------------------------------

// Best-effort removal. On Windows a just-killed FFmpeg can still hold files
// (ENOTEMPTY/EBUSY); throwing from a timer would crash the whole server.
function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.warn(`[HLS] Could not remove ${dir}: ${err.code || err.message}`);
  }
}

removeDir(ROOT);
fs.mkdirSync(ROOT, { recursive: true });

const sessions = new Map(); // id -> HlsSession

class HlsSession {
  // `sourceUrl` is the upstream stream for static sources (IPTV). For dynamic
  // sources (Stremio addons) pass `resolveSource` instead: an async function
  // returning `{ url, headers }`, called at every FFmpeg spawn because those
  // URLs are signed and expiring.
  constructor(id, sourceUrl, profile, opts = {}) {
    this.id = id;
    this.key = opts.key || null;               // registry key (for isKeyActive)
    this.sourceUrl = sourceUrl;
    this.sourceHeaders = null;                 // extra HTTP headers for the source
    this.resolveSource = opts.resolveSource || null;
    this.dynamic = !!opts.resolveSource;
    this.profile = PROFILES.has(profile) ? profile : DEFAULT_PROFILE;
    this.dir = path.join(ROOT, id);
    this.lastAccess = Date.now();
    this.restarts = 0;
    this.failures = 0;
    this.resolveFailures = 0;
    this.sourceIndex = 0;                      // which addon stream alternative to use
    this.needFreshSource = false;
    this.lastProbe = null;                     // last successful source probe
    this.failed = new Set();  // attempt ids that failed fast for encoder/GPU reasons
    this.layout = null;        // 'abr' | 'single' - what's currently on disk
    this.mode = 'starting';
    this.stopped = false;
    this.lastLog = [];
    fs.mkdirSync(this.dir, { recursive: true });
    this.spawn();
  }

  // Ordered list of ways to serve this channel; the first that hasn't failed wins.
  async candidates() {
    const hw = await detectHardware();
    const transcodes = (kind) => [
      ...(hw ? [{ kind, hw: 'vaapi' }, { kind, hw: 'vaapi-swdec' }] : []),
      ...(kind === 'single' || ABR_SOFTWARE ? [{ kind, hw: null }] : []),
    ];
    if (this.profile === 'source') return [{ kind: 'copy', copyAudio: true }];
    if (this.profile === '1080p') return transcodes('single');

    // Single rendition, copying the source when it's already browser-ready H.264 <=1080p
    const singleChain = async () => {
      // A probe can fail on a transient upstream error (addon proxies 502 a
      // lot). Don't let that demote a copy-able source to a CPU transcode:
      // retry once, then fall back to the last good probe of this channel.
      // Dynamic sources restart often (signed URLs, flaky proxies): reuse the
      // probe of the same addon stream so a restart doesn't add ~5 s of gap.
      let probe = this.dynamic && this.lastProbe ? this.lastProbe : null;
      if (!probe) probe = await probeSource(this.sourceUrl, 12000, this.sourceHeaders);
      if (!probe && !this.stopped) probe = await probeSource(this.sourceUrl, 12000, this.sourceHeaders);
      if (probe) this.lastProbe = probe;
      else probe = this.lastProbe || null;
      if (probe?.fps) this.sourceFps = probe.fps;
      const canCopy = probe && BROWSER_VIDEO.has(probe.vcodec) && probe.height > 0 && probe.height <= 1088;
      const note = probe ? `(src ${probe.vcodec} ${probe.height}p)` : '';
      return [
        ...(canCopy ? [{ kind: 'copy', copyAudio: BROWSER_AUDIO.has(probe.acodec), note }] : []),
        ...transcodes('single').map(a => ({ ...a, note })),
      ];
    };
    if (this.profile === 'auto') return singleChain();
    return [...transcodes('abr'), ...await singleChain()]; // 'abr'
  }

  async nextAttempt() {
    const list = await this.candidates();
    const id = (a) => `${a.kind}:${a.hw}`;
    const attempt = list.find(a => !this.failed.has(id(a))) || list[list.length - 1];
    attempt.id = id(attempt);
    return attempt;
  }

  async spawn() {
    // Spawn awaits both the addon round-trip and the source probe, so
    // close/stall handlers can trigger another spawn meanwhile. Each call
    // bumps a generation that supersedes older in-flight ones at their next
    // checkpoint - two FFmpeg processes must never share one session directory.
    const gen = (this.gen = (this.gen || 0) + 1);
    if (this.stopped) return;

    // Dynamic source (Stremio addon): resolve a fresh stream URL for every
    // spawn. If the addon has nothing playable right now (live channels come
    // and go with the schedule), back off and try again.
    if (this.resolveSource) {
      // After repeated failures on one stream, ask for freshly signed URLs and
      // move on to the addon's next alternative (wraps around).
      const fresh = this.needFreshSource;
      this.needFreshSource = false;
      const src = await this.resolveSource({ index: this.sourceIndex, fresh });
      if (this.stopped || gen !== this.gen) return;
      if (!src?.url) {
        this.resolveFailures++;
        this.restarts++;
        const delay = Math.min(1000 * 2 ** this.resolveFailures, 15000);
        console.warn(`[HLS ${this.id}] Addon has no playable stream right now, retrying in ${delay}ms`);
        this.retryTimer = setTimeout(() => this.spawn(), delay);
        return;
      }
      this.resolveFailures = 0;
      if ((src.index || 0) !== this.sourceIndex) this.lastProbe = null; // different stream: re-probe
      this.sourceIndex = src.index || 0;
      if (src.count > 1) console.log(`[HLS ${this.id}] Using addon stream ${this.sourceIndex + 1}/${src.count}`);
      if (src.url !== this.sourceUrl) this.failed.clear(); // new source: all pipelines are fair game again
      this.sourceUrl = src.url;
      this.sourceHeaders = src.headers || null;
    }

    const attempt = await this.nextAttempt();
    if (this.stopped || gen !== this.gen) return;
    // Stall detection counts from this spawn, not from the previous run's
    // last playlist write (resolve + probe can take longer than the stall
    // timeout, which used to get every fresh FFmpeg killed immediately).
    this.spawnedAt = Date.now();

    // Switching between the ABR layout (master + variant dirs) and a single
    // playlist: start from a clean directory so stale files can't be served.
    const layout = attempt.kind === 'abr' ? 'abr' : 'single';
    if (this.layout && this.layout !== layout) {
      removeDir(this.dir);
      fs.mkdirSync(this.dir, { recursive: true });
    }
    this.layout = layout;
    this.watchFile = path.join(this.dir, layout === 'abr' ? path.join('v0', 'stream.m3u8') : 'index.m3u8');

    const args = buildArgs(attempt, this);
    this.mode = attemptLabel(attempt);
    const startedAt = Date.now();
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc = proc;
    this.lastLog = [];
    console.log(`[HLS ${this.id}] FFmpeg started: ${this.mode} (restart #${this.restarts})`);

    proc.stderr.on('data', (d) => {
      const lines = d.toString().split('\n').filter(Boolean);
      this.lastLog = [...this.lastLog, ...lines].slice(-20);
    });
    proc.on('error', (err) => console.error(`[HLS ${this.id}] FFmpeg error:`, err.message));
    proc.on('close', (code) => {
      if (this.proc === proc) this.proc = null;
      if (this.stopped) return;
      const ranFor = Date.now() - startedAt;
      const log = this.lastLog.join('\n');
      // Fell over immediately for a non-network reason (codec the GPU can't
      // decode, driver problem, unsupported filter...): try the next, lighter
      // pipeline instead of looping on the broken one.
      if (/matches no streams/.test(log)) {
        console.warn(`[HLS ${this.id}] Source has no video track (audio-only upstream)`);
      }
      if (ranFor < FAST_FAIL_MS && !this.killedForStall && !NETWORK_ERROR.test(log)) {
        this.failed.add(attempt.id);
        console.warn(`[HLS ${this.id}] ${this.mode} failed fast - falling back. ${this.lastLog.slice(-2).join(' | ')}`);
      }
      this.killedForStall = false;
      this.failures = ranFor > 30000 ? 0 : this.failures + 1;
      // Dynamic source keeps dying early: its signed URL may have gone bad or
      // that upstream is down. Re-resolve fresh and try the next alternative.
      if (this.dynamic && this.failures >= 2) {
        this.needFreshSource = true;
        this.sourceIndex++;
      }
      const delay = Math.min(1000 * 2 ** this.failures, 15000);
      console.warn(`[HLS ${this.id}] FFmpeg exited (${code}), restarting in ${delay}ms. ${this.lastLog.slice(-2).join(' | ')}`);
      this.restarts++;
      setTimeout(() => this.spawn(), delay);
    });
  }

  touch() { this.lastAccess = Date.now(); }

  // Source stalled without FFmpeg exiting (e.g. upstream keeps the socket open
  // but stops sending): restart it so the playlist keeps moving.
  checkStall() {
    if (!this.proc || !this.watchFile) return;
    let mtime = 0;
    try { mtime = fs.statSync(this.watchFile).mtimeMs; } catch { mtime = this.createdAt || 0; }
    const since = Date.now() - Math.max(mtime, this.spawnedAt || 0, this.lastSpawnCheck || 0);
    // Addon streams usually carry ~10 s upstream segments (data arrives in
    // bursts) behind proxies that need retries: allow them more slack.
    if (since > (this.dynamic ? DYNAMIC_STALL_TIMEOUT_MS : STALL_TIMEOUT_MS)) {
      console.warn(`[HLS ${this.id}] No new segments for ${Math.round(since / 1000)}s, restarting FFmpeg`);
      this.lastSpawnCheck = Date.now();
      this.killedForStall = true;
      this.proc.kill('SIGKILL');
    }
  }

  // Wait until the top-level playlist and every variant have >=2 segments
  async waitForPlaylist(timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    const segments = (text) => (text.match(/#EXTINF/g) || []).length;
    while (Date.now() < deadline) {
      try {
        const text = await fs.promises.readFile(path.join(this.dir, 'index.m3u8'), 'utf8');
        if (text.includes('#EXT-X-STREAM-INF')) {
          const variants = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
          const ready = await Promise.all(variants.map(v =>
            fs.promises.readFile(path.join(this.dir, v), 'utf8').then(segments).catch(() => 0)));
          if (variants.length && ready.every(c => c >= 2)) return text;
        } else if (segments(text) >= 2) {
          return text;
        }
      } catch { /* not written yet */ }
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.proc?.kill('SIGKILL');
    setTimeout(() => removeDir(this.dir), 1000);
  }

  info() {
    return { id: this.id, key: this.key, dynamic: this.dynamic, profile: this.profile, mode: this.mode, running: !!this.proc, restarts: this.restarts };
  }
}

function sessionId(key) {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function getSession({ server, username, password, channelId, profile, sessionKey, key, resolveSource }) {
  const id = sessionKey
    ? sessionId(`${sessionKey}|${profile}`)
    : sessionId(`${server}|${username}|${channelId}|${profile}`);
  let session = sessions.get(id);
  if (!session) {
    const sourceUrl = resolveSource ? null : `${server}/live/${username}/${password}/${channelId}.ts`;
    session = new HlsSession(id, sourceUrl, profile, { key, resolveSource });
    session.createdAt = Date.now();
    sessions.set(id, session);
  }
  session.touch();
  return session;
}

function isChannelActive(server, username, channelId) {
  for (const s of sessions.values()) {
    if (s.proc && s.sourceUrl && s.sourceUrl.startsWith(`${server}/live/${username}/`) && s.sourceUrl.endsWith(`/${channelId}.ts`)) return true;
  }
  return false;
}

// Is the channel with this registry key currently being restreamed? Works for
// dynamic (addon) sessions whose source URL isn't a stable IPTV address.
function isKeyActive(key) {
  for (const s of sessions.values()) {
    if (s.proc && s.key === key) return true;
  }
  return false;
}

setInterval(() => {
  for (const [id, s] of sessions) {
    if (Date.now() - s.lastAccess > IDLE_TIMEOUT_MS) {
      console.log(`[HLS ${id}] No viewers, stopping`);
      s.stop();
      sessions.delete(id);
    } else {
      s.checkStall();
    }
  }
}, 5000).unref();

// --- Routes -------------------------------------------------------------------

const PLAYLIST_HEADERS = {
  'Content-Type': 'application/vnd.apple.mpegurl',
  'Cache-Control': 'no-cache, no-store',
  'Access-Control-Allow-Origin': '*'
};

function registerRoutes(app, resolveChannel = () => null) {
  // Entry playlist: /hls/:channel/index.m3u8
  //   :channel is either a registry key (credentials resolved server-side, so
  //   they never reach the browser) or, for ad-hoc/validation use, a raw
  //   channelId with ?server=&username=&password= in the query.
  // Returns the ABR master playlist, or a media playlist for single renditions.
  app.get('/hls/:channel/index.m3u8', async (req, res) => {
    const known = resolveChannel(req.params.channel);
    const profile = known?.profile || req.query.profile || DEFAULT_PROFILE;

    let session;
    if (known?.resolveSource) {
      // Dynamic source (Stremio addon): the upstream URL is resolved inside
      // the session at FFmpeg spawn time, so nothing sensitive is needed here.
      session = getSession({ sessionKey: `dynamic:${known.key}`, key: known.key, profile, resolveSource: known.resolveSource });
    } else {
      const server = known ? known.server : req.query.server;
      const username = known ? known.username : req.query.username;
      const password = known ? known.password : req.query.password;
      const channelId = known ? known.channelId : req.params.channel;
      if (!server || !username || !password) return res.status(400).send('Unknown channel, and no server/username/password supplied');
      session = getSession({ server, username, password, channelId, profile });
    }

    // Answer 503 before the player's own manifest timeout; it retries, and the
    // same session keeps warming up (dynamic sources need the addon round-trip).
    const text = await session.waitForPlaylist(MANIFEST_WAIT_MS);
    if (!text) return res.status(503).set('Retry-After', '2').send('Stream is starting, retry shortly');

    // Every URI (variant playlist or segment) is served from the session's
    // directory through an opaque id, so credentials never appear in requests.
    let body = text.replace(/^(?!#)(\S+)$/gm, `s/${session.id}/$1`);
    // FFmpeg doesn't write FRAME-RATE into the master playlist; tag every
    // variant (they're written in ladder order). hls.js orders renditions by
    // height, then frame rate, then bitrate, so with all of them tagged the
    // reduced-fps rungs sort below the full-rate ones - which lets the player
    // cap a device that stutters at 50 fps to the 25 fps renditions only.
    let variant = 0;
    body = body.replace(/^#EXT-X-STREAM-INF:(.*)$/gm, (line) => {
      const rung = LADDER[variant++];
      const fps = rung?.fps || session.sourceFps || 50;
      return line.includes('FRAME-RATE') ? line : `${line},FRAME-RATE=${fps.toFixed(3)}`;
    });
    res.set(PLAYLIST_HEADERS).send(body);
  });

  // Variant playlists and segments: /hls/:channel/s/:id/<path inside session dir>
  app.get(/^\/hls\/[^/]+\/s\/([a-f0-9]{16})\/((?:v\d+\/)?[\w.-]+\.(m3u8|ts))$/, (req, res) => {
    const [id, file, ext] = [req.params[0], req.params[1], req.params[2]];
    const session = sessions.get(id);
    if (!session) return res.status(404).end();
    session.touch();
    const headers = ext === 'm3u8'
      ? PLAYLIST_HEADERS
      : { 'Cache-Control': 'public, max-age=600', 'Access-Control-Allow-Origin': '*', 'Content-Type': 'video/mp2t' };
    res.set(headers).sendFile(path.join(session.dir, file), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  app.get('/api/hls/sessions', async (req, res) => res.json({
    hwaccel: await detectHardware(),
    defaultProfile: DEFAULT_PROFILE,
    ladder: LADDER,
    sessions: [...sessions.values()].map(s => s.info()),
  }));
}

module.exports = { registerRoutes, isChannelActive, isKeyActive };
