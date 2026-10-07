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
// rung; the lightest rung drops to 25 fps, which roughly doubles per-frame
// quality at low bitrate and halves decode load on weak devices.
function parseLadder(spec) {
  return spec.split(',').map(s => s.trim()).filter(Boolean).map(rung => {
    const [height, kbps, fps] = rung.split(':').map(Number);
    return { height: height || 1080, kbps: kbps || 4000, fps: fps || null };
  }).sort((a, b) => b.kbps - a.kbps);
}
const LADDER = parseLadder(process.env.HLS_ABR_LADDER || '1080:6000,1080:3500,1080:2000:25');
const SINGLE_KBPS = parseInt(process.env.HLS_1080P_BITRATE || '6000', 10);

// Codecs a browser can play directly inside an MPEG-TS/HLS stream
const BROWSER_VIDEO = new Set(['h264', 'avc1']);
const BROWSER_AUDIO = new Set(['aac']);
const PROFILES = new Set(['abr', 'auto', '1080p', 'source']);

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

function probeSource(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-user_agent', UA, '-rw_timeout', '10000000',
      '-analyzeduration', '4000000', '-probesize', '5000000',
      '-show_entries', 'stream=codec_type,codec_name,width,height', '-of', 'json', url
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
        resolve({ vcodec: v.codec_name, height: v.height || 0, acodec: a?.codec_name });
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

function inputArgs(attempt, sourceUrl) {
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
    '-reconnect_delay_max', '10',
    '-rw_timeout', '15000000',
    '-user_agent', UA,
    '-i', sourceUrl
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
  const input = inputArgs(attempt, session.sourceUrl);

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

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });

const sessions = new Map(); // id -> HlsSession

class HlsSession {
  constructor(id, sourceUrl, profile) {
    this.id = id;
    this.sourceUrl = sourceUrl;
    this.profile = PROFILES.has(profile) ? profile : DEFAULT_PROFILE;
    this.dir = path.join(ROOT, id);
    this.lastAccess = Date.now();
    this.restarts = 0;
    this.failures = 0;
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
      const probe = await probeSource(this.sourceUrl);
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
    if (this.stopped) return;
    const attempt = await this.nextAttempt();
    if (this.stopped) return;

    // Switching between the ABR layout (master + variant dirs) and a single
    // playlist: start from a clean directory so stale files can't be served.
    const layout = attempt.kind === 'abr' ? 'abr' : 'single';
    if (this.layout && this.layout !== layout) {
      fs.rmSync(this.dir, { recursive: true, force: true });
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
      if (ranFor < FAST_FAIL_MS && !this.killedForStall && !NETWORK_ERROR.test(log)) {
        this.failed.add(attempt.id);
        console.warn(`[HLS ${this.id}] ${this.mode} failed fast - falling back. ${this.lastLog.slice(-2).join(' | ')}`);
      }
      this.killedForStall = false;
      this.failures = ranFor > 30000 ? 0 : this.failures + 1;
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
    const since = Date.now() - Math.max(mtime, this.lastSpawnCheck || 0);
    if (since > STALL_TIMEOUT_MS) {
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
    this.proc?.kill('SIGKILL');
    setTimeout(() => fs.rmSync(this.dir, { recursive: true, force: true }), 1000);
  }

  info() {
    return { id: this.id, profile: this.profile, mode: this.mode, running: !!this.proc, restarts: this.restarts };
  }
}

function sessionId(key) {
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function getSession({ server, username, password, channelId, profile }) {
  const id = sessionId(`${server}|${username}|${channelId}|${profile}`);
  let session = sessions.get(id);
  if (!session) {
    const sourceUrl = `${server}/live/${username}/${password}/${channelId}.ts`;
    session = new HlsSession(id, sourceUrl, profile);
    session.createdAt = Date.now();
    sessions.set(id, session);
  }
  session.touch();
  return session;
}

function isChannelActive(server, username, channelId) {
  for (const s of sessions.values()) {
    if (s.proc && s.sourceUrl.startsWith(`${server}/live/${username}/`) && s.sourceUrl.endsWith(`/${channelId}.ts`)) return true;
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
    const server = known ? known.server : req.query.server;
    const username = known ? known.username : req.query.username;
    const password = known ? known.password : req.query.password;
    const channelId = known ? known.channelId : req.params.channel;
    if (!server || !username || !password) return res.status(400).send('Unknown channel, and no server/username/password supplied');

    const session = getSession({ server, username, password, channelId, profile });
    const text = await session.waitForPlaylist();
    if (!text) return res.status(503).set('Retry-After', '2').send('Stream is starting, retry shortly');

    // Every URI (variant playlist or segment) is served from the session's
    // directory through an opaque id, so credentials never appear in requests.
    const body = text.replace(/^(?!#)(\S+)$/gm, `s/${session.id}/$1`);
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

module.exports = { registerRoutes, isChannelActive };
