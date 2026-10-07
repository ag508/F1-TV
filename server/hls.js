/**
 * Supervised HLS restreaming with a DVR window.
 *
 * One FFmpeg process per (account, channel, profile) writes rolling HLS
 * segments to a temp directory; every viewer reads the same files. Compared to
 * piping raw MPEG-TS this means:
 *  - a viewer that buffers or drops its connection resumes from the segments
 *    that are still on disk instead of losing that part of the broadcast,
 *  - a slow viewer never back-pressures the encoder for everybody else,
 *  - if the upstream source drops, FFmpeg is restarted automatically and the
 *    playlist continues (marked with a discontinuity) without kicking viewers.
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

// Transcode to Full HD H.264 - used when the source is HEVC/10-bit (which most
// browsers can't decode) or higher than 1080p. UHD is downscaled cleanly.
const VIDEO_TRANSCODE = [
  '-vf', 'scale=-2:1080:flags=lanczos,format=yuv420p',
  '-c:v', 'libx264',
  '-preset', process.env.X264_PRESET || 'veryfast',
  '-profile:v', 'high', '-level:v', '4.2',
  '-b:v', process.env.HLS_1080P_BITRATE || '6000k',
  '-maxrate', process.env.HLS_1080P_MAXRATE || '7500k',
  '-bufsize', '12000k',
  '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
  '-sc_threshold', '0'
];
// Copy the source video untouched - true source quality (e.g. real H.264 1080p)
// at almost no CPU. Only valid when the source is already browser-playable.
const VIDEO_COPY = ['-c:v', 'copy'];
const AUDIO_COPY = ['-c:a', 'copy'];
const AUDIO_TRANSCODE = ['-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k'];

// Codecs a browser can play directly inside an MPEG-TS/HLS stream
const BROWSER_VIDEO = new Set(['h264', 'avc1']);
const BROWSER_AUDIO = new Set(['aac']);

const PROFILES = {
  // Adaptive (default): copy when the source is already H.264 ≤1080p, otherwise
  // transcode. IPTV providers rotate encodes (H.264 1080p one day, HEVC 540p
  // the next), so the choice is re-made from a fresh probe on every (re)start.
  auto: { adaptive: true },
  // Always transcode to 1080p H.264
  '1080p': { video: VIDEO_TRANSCODE, audio: AUDIO_TRANSCODE },
  // Always copy the source through untouched (lowest CPU, source resolution)
  source: { video: VIDEO_COPY, audio: AUDIO_COPY }
};

// Probe the source once to decide copy vs transcode. Returns null on failure
// (caller then falls back to a safe transcode).
function probeSource(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-user_agent', 'VLC/3.0.18 LibVLC/3.0.18', '-rw_timeout', '10000000',
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

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });

const sessions = new Map(); // id -> HlsSession

class HlsSession {
  constructor(id, sourceUrl, profile) {
    this.id = id;
    this.sourceUrl = sourceUrl;
    this.profile = PROFILES[profile] ? profile : 'auto';
    this.dir = path.join(ROOT, id);
    this.playlist = path.join(this.dir, 'index.m3u8');
    this.lastAccess = Date.now();
    this.restarts = 0;
    this.failures = 0;
    this.forceTranscode = false; // set after a copy attempt fails fast
    this.mode = this.profile;    // what the last spawn actually did
    this.stopped = false;
    this.lastLog = [];
    fs.mkdirSync(this.dir, { recursive: true });
    this.spawn();
  }

  // Decide the video/audio codec arguments for this (re)start.
  async resolveCodecs() {
    const p = PROFILES[this.profile];
    if (!p.adaptive) { this.mode = this.profile; return { video: p.video, audio: p.audio }; }

    // Adaptive: a probe failure or an earlier fast copy-failure => safe transcode
    const probe = this.forceTranscode ? null : await probeSource(this.sourceUrl);
    const canCopyVideo = probe && BROWSER_VIDEO.has(probe.vcodec) && probe.height > 0 && probe.height <= 1088;
    const canCopyAudio = probe && BROWSER_AUDIO.has(probe.acodec);
    this.mode = canCopyVideo ? `copy ${probe.vcodec} ${probe.height}p` : `transcode→1080p${probe ? ` (src ${probe.vcodec} ${probe.height}p)` : ''}`;
    return {
      video: canCopyVideo ? VIDEO_COPY : VIDEO_TRANSCODE,
      audio: canCopyAudio ? AUDIO_COPY : AUDIO_TRANSCODE
    };
  }

  async spawn() {
    if (this.stopped) return;
    const { video, audio } = await this.resolveCodecs();
    if (this.stopped) return;
    const copying = video === VIDEO_COPY;
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-fflags', '+genpts+discardcorrupt',
      '-analyzeduration', '5000000', '-probesize', '5000000',
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_on_network_error', '1',
      '-reconnect_delay_max', '10',
      '-rw_timeout', '15000000',
      '-user_agent', 'VLC/3.0.18 LibVLC/3.0.18',
      '-i', this.sourceUrl,
      '-map', '0:v:0', '-map', '0:a:0?',
      ...video,
      ...audio,
      '-max_muxing_queue_size', '2048',
      '-f', 'hls',
      '-hls_time', String(SEGMENT_SECONDS),
      '-hls_list_size', String(Math.ceil(DVR_SECONDS / SEGMENT_SECONDS)),
      '-hls_flags', 'delete_segments+append_list+discont_start+omit_endlist+independent_segments+temp_file',
      '-hls_segment_filename', path.join(this.dir, 'seg_%06d.ts'),
      this.playlist
    ];
    this._lastCopying = copying;

    const startedAt = Date.now();
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc = proc;
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
      // A copy attempt that dies within 15s usually means the source isn't
      // really browser-playable (codec switched, bad probe) - fall back to a
      // guaranteed transcode for the rest of the session.
      if (this._lastCopying && ranFor < 15000 && this.profile === 'auto' && !this.forceTranscode) {
        this.forceTranscode = true;
        console.warn(`[HLS ${this.id}] Copy failed fast, switching to transcode`);
      }
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
    if (!this.proc) return;
    let mtime = 0;
    try { mtime = fs.statSync(this.playlist).mtimeMs; } catch { mtime = this.createdAt || 0; }
    const since = Date.now() - Math.max(mtime, this.lastSpawnCheck || 0);
    if (since > STALL_TIMEOUT_MS) {
      console.warn(`[HLS ${this.id}] No new segments for ${Math.round(since / 1000)}s, restarting FFmpeg`);
      this.lastSpawnCheck = Date.now();
      this.proc.kill('SIGKILL');
    }
  }

  async waitForPlaylist(timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const text = await fs.promises.readFile(this.playlist, 'utf8');
        if ((text.match(/#EXTINF/g) || []).length >= 2) return text;
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

function registerRoutes(app, resolveChannel = () => null) {
  // Playlist: /hls/:channel/index.m3u8
  //   :channel is either a registry key (credentials resolved server-side, so
  //   they never reach the browser) or, for ad-hoc/validation use, a raw
  //   channelId with ?server=&username=&password= in the query.
  app.get('/hls/:channel/index.m3u8', async (req, res) => {
    const known = resolveChannel(req.params.channel);
    // A registry channel may pin its own profile (e.g. 'source' to keep a 4K
    // feed untouched); otherwise fall back to the query, defaulting to 'auto'.
    const profile = known?.profile || req.query.profile || 'auto';
    const server = known ? known.server : req.query.server;
    const username = known ? known.username : req.query.username;
    const password = known ? known.password : req.query.password;
    const channelId = known ? known.channelId : req.params.channel;
    if (!server || !username || !password) return res.status(400).send('Unknown channel, and no server/username/password supplied');

    const session = getSession({ server, username, password, channelId, profile });
    const text = await session.waitForPlaylist();
    if (!text) return res.status(503).set('Retry-After', '2').send('Stream is starting, retry shortly');

    // Segment URIs are relative to the playlist URL; route them through the
    // opaque session id so credentials never appear in segment requests.
    const body = text.replace(/^(seg_\d+\.ts)$/gm, `seg/${session.id}/$1`);
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, no-store',
      'Access-Control-Allow-Origin': '*'
    });
    res.send(body);
  });

  app.get('/hls/:channel/seg/:id/:file', (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session || !/^seg_\d+\.ts$/.test(req.params.file)) return res.status(404).end();
    session.touch();
    res.set({ 'Cache-Control': 'public, max-age=600', 'Access-Control-Allow-Origin': '*' });
    res.sendFile(path.join(session.dir, req.params.file), (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  app.get('/api/hls/sessions', (req, res) => res.json([...sessions.values()].map(s => s.info())));
}

module.exports = { registerRoutes, isChannelActive };
