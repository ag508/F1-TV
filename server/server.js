/**
 * F1-TV Proxy Server
 * * Responsibilities:
 * 1. Proxy requests to sports streaming sites (DLHD, Streamed.pk)
 * 2. Inject necessary Referer/User-Agent headers
 * 3. Cache results to prevent rate limiting
 * 4. Serve the React frontend in production
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const { spawn } = require('child_process');
const hls = require('./hls');
const channels = require('./channels');
const { LiveTiming } = require('./livetiming');
const app = express();

// F1 live timing feed (session status, timing, telemetry)
// Runs on free/anonymous F1 API data by default. F1TV_TOKEN is optional and
// only unlocks car GPS + telemetry; leave it unset to run on free data only.
const liveTiming = new LiveTiming({
  token: process.env.F1TV_TOKEN || null,
  replayPath: process.env.LIVE_REPLAY,
  replaySpeed: process.env.LIVE_REPLAY_SPEED,
  replayStart: process.env.LIVE_REPLAY_START,
  disabled: process.env.LIVE_TIMING_DISABLED === '1'
});
liveTiming.start();

// Session storage for cookies (to maintain Xstream authentication)
const cookieJar = new Map();

// Active FFmpeg processes for restreaming
const activeStreams = new Map();

// --- CONFIG ---
const PORT = process.env.PORT || 3001;
const SOURCES = {
  DLHD: "https://dlhd.dad/api/stream", // Hypothetical endpoint
  STREAMED: "https://streamed.pk/api/f1" // Hypothetical endpoint
};

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- CACHE ---
const cache = {
  streams: null,
  lastUpdate: 0,
  TTL: 60 * 1000 * 5 // 5 minutes
};

// --- ROUTES ---

// 1. Health Check
app.get('/health', (req, res) => res.status(200).json({ status: 'OK', system: 'F1-Hub' }));

// 2. Stream Health Check - Test if Xtream streams are accessible
const IPTV_UA = 'VLC/3.0.18 LibVLC/3.0.18';

// Read the first ~64KB of a live MPEG-TS stream and verify it really is TS
// (0x47 sync byte every 188 bytes). Live streams never end, so the request is
// aborted once enough data arrived instead of waiting for completion.
function sampleTransportStream(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const started = Date.now();
    let firstByteMs = null;
    let chunks = [];
    let size = 0;
    const finish = (result) => {
      clearTimeout(timer);
      controller.abort();
      resolve({ ...result, firstByteMs, elapsedMs: Date.now() - started });
    };
    const timer = setTimeout(() => finish({ ok: size > 0 && isTransportStream(Buffer.concat(chunks)), bytes: size, timedOut: true }), timeoutMs);

    axios.get(url, { responseType: 'stream', signal: controller.signal, headers: { 'User-Agent': IPTV_UA }, timeout: timeoutMs, maxRedirects: 5 })
      .then((response) => {
        const type = response.headers['content-type'] || '';
        if (type.includes('text/html')) return finish({ ok: false, reason: 'Provider returned an error page' });
        response.data.on('data', (chunk) => {
          if (firstByteMs === null) firstByteMs = Date.now() - started;
          chunks.push(chunk);
          size += chunk.length;
          if (size >= 64 * 1024) finish({ ok: isTransportStream(Buffer.concat(chunks)), bytes: size });
        });
        response.data.on('end', () => finish({ ok: isTransportStream(Buffer.concat(chunks)), bytes: size }));
        response.data.on('error', () => {});
      })
      .catch((err) => {
        if (!controller.signal.aborted) finish({ ok: false, reason: err.response ? `HTTP ${err.response.status}` : err.code || err.message });
      });
  });
}

function isTransportStream(buf) {
  for (let offset = 0; offset < 188 && offset + 188 * 3 < buf.length; offset++) {
    if (buf[offset] === 0x47 && buf[offset + 188] === 0x47 && buf[offset + 376] === 0x47) return true;
  }
  return false;
}

// ffprobe the source to report its real codec/resolution
function probeStream(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-user_agent', IPTV_UA, '-rw_timeout', '10000000',
      '-analyzeduration', '3000000', '-probesize', '3000000',
      '-show_entries', 'stream=codec_type,codec_name,profile,width,height,r_frame_rate',
      '-of', 'json', url
    ]);
    let out = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', d => (out += d));
    proc.on('error', () => { clearTimeout(timer); resolve(null); });
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const streams = JSON.parse(out).streams || [];
        const v = streams.find(s => s.codec_type === 'video');
        if (!v) return resolve(null);
        const [num, den] = String(v.r_frame_rate || '0/1').split('/').map(Number);
        resolve({ codec: v.codec_name, profile: v.profile, width: v.width, height: v.height, fps: den ? Math.round(num / den) : null });
      } catch {
        resolve(null);
      }
    });
  });
}

app.get('/api/stream-health', async (req, res) => {
  const { probe } = req.query;
  // Credentials come from the server-side registry by channel key; raw
  // server/username/password in the query are still accepted for ad-hoc checks.
  const known = req.query.key ? channels.resolve(req.query.key) : null;
  const server = known ? known.server : req.query.server;
  const username = known ? known.username : req.query.username;
  const password = known ? known.password : req.query.password;
  const channelId = known ? known.channelId : req.query.channelId;

  if (!server || !username || !password) {
    return res.status(400).json({ error: 'Unknown channel key, and no server/username/password supplied' });
  }

  const checkedAt = new Date().toISOString();
  let userInfo;
  try {
    const response = await axios.get(`${server}/player_api.php`, {
      params: { username, password },
      timeout: 8000,
      headers: { 'User-Agent': IPTV_UA }
    });
    userInfo = response.data?.user_info;
  } catch (error) {
    return res.json({ status: 'OFFLINE', reason: 'Provider unreachable', error: error.message, checkedAt });
  }

  if (!userInfo || userInfo.auth === 0 || userInfo.status !== 'Active') {
    return res.json({ status: 'OFFLINE', reason: `Account ${userInfo?.status || 'rejected'}`, checkedAt });
  }

  const account = {
    expiry: userInfo.exp_date ? new Date(userInfo.exp_date * 1000).toISOString().split('T')[0] : null,
    activeConnections: Number(userInfo.active_cons) || 0,
    maxConnections: Number(userInfo.max_connections) || null
  };

  if (!channelId) return res.json({ status: 'ONLINE', account, checkedAt });

  // Already being restreamed by this server: it is up, and opening another
  // upstream connection could kick the running one on single-connection accounts.
  const restreamKeys = [...activeStreams.keys()];
  if (restreamKeys.some(k => k === `${username}-${channelId}` || k === `${username}-${channelId}-sd`) || hls.isChannelActive(server, username, channelId)) {
    return res.json({ status: 'ONLINE', reason: 'Currently streaming', account, checkedAt });
  }

  if (account.maxConnections && account.activeConnections >= account.maxConnections) {
    return res.json({ status: 'DEGRADED', reason: `All ${account.maxConnections} connection(s) in use`, account, checkedAt });
  }

  const streamUrl = `${server}/live/${username}/${password}/${channelId}.ts`;
  const sample = await sampleTransportStream(streamUrl);
  if (!sample.ok) {
    return res.json({ status: 'DEGRADED', reason: sample.reason || 'Account active but channel not sending video', account, sample, checkedAt });
  }

  const source = probe === '1' ? await probeStream(streamUrl) : null;
  const kbps = sample.elapsedMs ? Math.round((sample.bytes * 8) / sample.elapsedMs) : null;
  res.json({ status: 'ONLINE', account, latencyMs: sample.firstByteMs, kbps, source, checkedAt });
});


// 2. Get Streams (Aggregator)
app.get('/api/streams', async (req, res) => {
  const raceName = req.query.race;

  // Serve Cache if valid
  const now = Date.now();
  if (cache.streams && (now - cache.lastUpdate < cache.TTL)) {
    return res.json({ source: 'cache', data: cache.streams });
  }

  try {
    // In a real production environment, you would use Puppeteer here
    // to scrape the actual tokens/m3u8 links from the sites if they don't have public APIs.
    // For safety/legal reasons, we are mocking the "Success" response of that scrape.

    const mockStreams = [
      { id: "dlhd-1", title: "Sky Sports F1", source: "DLHD", quality: "1080p", url: "https://fake-stream-url.m3u8" },
      { id: "sm-1", title: "F1 TV Pro", source: "Streamed.pk", quality: "720p", url: "https://fake-stream-url-2.m3u8" }
    ];

    cache.streams = mockStreams;
    cache.lastUpdate = now;

    res.json({ source: 'live', data: mockStreams });
  } catch (error) {
    console.error("Scraping error:", error);
    res.status(500).json({ error: "Failed to fetch streams" });
  }
});

// 3. FFmpeg Restream Endpoint (for MPEG-TS with mpegts.js)
// Fetches the source stream with FFmpeg and restreams it as MPEG-TS.
// One FFmpeg process per channel is shared by all viewers. Output is fanned out
// manually so one slow viewer can't stall the stream for everybody, and when
// FFmpeg exits every viewer's response is ended so the player reconnects
// instead of hanging on a dead connection.
const MAX_CLIENT_BACKLOG = 16 * 1024 * 1024; // drop viewers more than ~16MB behind

function buildRestreamArgs(sourceUrl, isSD) {
  const input = [
    '-y',
    '-fflags', '+genpts+discardcorrupt',
    '-analyzeduration', '10000000', // Analyze more data to detect format
    '-probesize', '10000000',
    '-re',                 // Read input at native frame rate
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_on_network_error', '1',
    '-reconnect_delay_max', '5',
    '-rw_timeout', '15000000',
    '-user_agent', IPTV_UA,
    '-i', sourceUrl
  ];
  const codecs = isSD
    ? [
      // SD: Transcode video to lower resolution and bitrate
      '-c:v', 'libx264', '-preset', 'veryfast',
      '-s', '854x480', '-b:v', '800k', '-maxrate', '1M', '-bufsize', '2M',
      '-c:a', 'aac', '-ac', '2', '-b:a', '128k'
    ]
    : [
      // HD/UHD: Copy video, only transcode audio (browser-compatible stereo AAC)
      '-c:v', 'copy',
      '-c:a', 'aac', '-ac', '2', '-b:a', '192k'
    ];
  return [...input, ...codecs, '-f', 'mpegts', 'pipe:1'];
}

function startRestream(streamKey, channelId, sourceUrl, isSD) {
  console.log(`[Restream] Starting new FFmpeg process for ${streamKey}`);
  const ffmpeg = spawn('ffmpeg', buildRestreamArgs(sourceUrl, isSD));
  const streamData = { ffmpeg, clients: new Set(), startTime: Date.now(), idleTimer: null };
  activeStreams.set(streamKey, streamData);

  ffmpeg.stdout.on('data', (chunk) => {
    for (const res of streamData.clients) {
      if (res.writableLength > MAX_CLIENT_BACKLOG) {
        console.warn(`[Restream] Viewer too far behind on ${streamKey}, disconnecting it so it can resync`);
        res.end();
        streamData.clients.delete(res);
        continue;
      }
      res.write(chunk);
    }
  });

  // Only log important FFmpeg messages
  ffmpeg.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output.includes('Input #') || output.includes('Output #') ||
      output.includes('Stream #') || output.includes('error') ||
      output.includes('Error')) {
      console.log(`[FFmpeg ${channelId}]`, output);
    }
  });

  const shutdown = () => {
    if (activeStreams.get(streamKey) === streamData) activeStreams.delete(streamKey);
    clearTimeout(streamData.idleTimer);
    for (const res of streamData.clients) res.end();
    streamData.clients.clear();
  };
  ffmpeg.on('error', (err) => {
    console.error(`[FFmpeg Error ${channelId}]:`, err);
    shutdown();
  });
  ffmpeg.on('close', (code) => {
    console.log(`[FFmpeg ${channelId}] Process closed with code ${code}`);
    shutdown();
  });

  return streamData;
}

app.get('/restream/:channelId', (req, res) => {
  const { channelId } = req.params;
  const { server, username, password } = req.query;

  if (!server || !username || !password) {
    return res.status(400).send('Missing required parameters: server, username, password');
  }

  // Check if this is an SD transcode request
  const isSD = channelId.endsWith('-sd');
  const actualChannelId = isSD ? channelId.replace('-sd', '') : channelId;

  // Use .ts (MPEG-TS) endpoint which is more reliable for direct streaming/restreaming than .m3u8 HLS playlists
  const sourceUrl = `${server}/live/${username}/${password}/${actualChannelId}.ts`;
  const streamKey = `${username}-${channelId}`;

  console.log(`[Restream] Request for channel ${channelId}${isSD ? ' (SD transcode)' : ''}`);

  const streamData = activeStreams.get(streamKey) || startRestream(streamKey, channelId, sourceUrl, isSD);
  clearTimeout(streamData.idleTimer);

  // Set headers for streaming
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  streamData.clients.add(res);
  console.log(`[Restream] Client connected to ${streamKey} (${streamData.clients.size} total clients)`);

  // Clean up on client disconnect
  req.on('close', () => {
    streamData.clients.delete(res);
    console.log(`[Restream] Client disconnected from ${streamKey} (${streamData.clients.size} clients remaining)`);

    // Kill FFmpeg after 30 seconds if no clients (keeps it warm for quick reconnects)
    if (streamData.clients.size === 0) {
      streamData.idleTimer = setTimeout(() => {
        if (activeStreams.get(streamKey) === streamData && streamData.clients.size === 0) {
          console.log(`[Restream] Killing idle stream: ${streamKey}`);
          streamData.ffmpeg.kill('SIGTERM');
        }
      }, 30000);
    }
  });
});

// 3b. HLS restream with DVR buffer (resilient, 1080p H.264)
hls.registerRoutes(app, channels.resolve);

// Live channel list (metadata only - credentials stay server-side)
app.get('/api/channels', (req, res) => res.json(channels.publicList()));

// 3c. Live timing (session status + telemetry for the hero section)
app.get('/api/live/status', (req, res) => res.json(liveTiming.status()));

app.get('/api/live/state', (req, res) => res.json({ ...liveTiming.snapshot(), positions: liveTiming.positionSnapshot() }));

// Server-Sent Events: full timing snapshot every second, car positions 4x/sec
app.get('/api/live/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('state', liveTiming.snapshot());

  let lastPositionAt = null;
  const stateTimer = setInterval(() => send('state', liveTiming.snapshot()), 1000);
  const positionTimer = setInterval(() => {
    const positions = liveTiming.positionSnapshot();
    if (positions.at && positions.at !== lastPositionAt) {
      lastPositionAt = positions.at;
      send('positions', positions);
    }
  }, 250);

  req.on('close', () => {
    clearInterval(stateTimer);
    clearInterval(positionTimer);
  });
});

// Circuit outline in F1 live timing coordinates (same system as Position.z).
// MultiViewer publishes outlines + mini-sector indexes per circuit/season; for
// brand-new circuits fall back to tracing a lap from OpenF1 location data.
const circuitCache = new Map();   // key -> { circuit, expires } (circuit null = not available)
const circuitPending = new Map(); // key -> Promise, so parallel requests share one lookup

// Found outlines are also kept on disk: a venue's layout rarely changes, so a
// restart doesn't need MultiViewer/OpenF1 again. Entries older than 30 days
// are refetched.
const CIRCUIT_DISK_TTL = 30 * 24 * 60 * 60 * 1000;
const circuitCacheFile = path.join(process.env.CACHE_DIR || path.join(__dirname, 'cache'), 'circuits.json');
try {
  const saved = JSON.parse(require('fs').readFileSync(circuitCacheFile, 'utf8'));
  for (const [key, { circuit, savedAt }] of Object.entries(saved)) {
    if (circuit && Date.now() - savedAt < CIRCUIT_DISK_TTL) circuitCache.set(key, { circuit, expires: savedAt + CIRCUIT_DISK_TTL, savedAt });
  }
  console.log(`[Circuit] ${circuitCache.size} outlines loaded from ${circuitCacheFile}`);
} catch { /* no cache yet */ }
let circuitSaveTimer = null;
function saveCircuitCache() {
  clearTimeout(circuitSaveTimer);
  circuitSaveTimer = setTimeout(() => {
    const out = {};
    for (const [key, entry] of circuitCache) if (entry.circuit) out[key] = { circuit: entry.circuit, savedAt: entry.savedAt };
    const fsp = require('fs');
    fsp.promises.mkdir(path.dirname(circuitCacheFile), { recursive: true })
      .then(() => fsp.promises.writeFile(circuitCacheFile, JSON.stringify(out)))
      .catch(err => console.warn('[Circuit] Could not save outline cache:', err.message));
  }, 2000);
}
const CIRCUIT_MISS_TTL = 6 * 60 * 60 * 1000;  // no outline anywhere: ask again in 6 h
const CIRCUIT_ERROR_TTL = 5 * 60 * 1000;      // lookup failed (network, rate limit): retry in 5 min

// OpenF1 allows 3 requests/second per client. Every OpenF1 call goes through
// one queue spaced under that, and a 429 is retried after its Retry-After.
let openf1Queue = Promise.resolve();
const OPENF1_SPACING_MS = 400;
function openf1Get(url, config = {}) {
  const run = async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await axios.get(url, { timeout: 15000, ...config });
      } catch (err) {
        if (err.response?.status !== 429 || attempt >= 4) throw err;
        const wait = (Number(err.response.headers?.['retry-after']) || 1) * 1000 * attempt;
        await new Promise(r => setTimeout(r, wait));
      }
    }
  };
  const request = openf1Queue.then(run);
  openf1Queue = request.catch(() => { }).then(() => new Promise(r => setTimeout(r, OPENF1_SPACING_MS)));
  return request;
}

async function circuitFromOpenF1(circuitKey) {
  const { data: sessions } = await openf1Get('https://api.openf1.org/v1/sessions', { params: { circuit_key: circuitKey } });
  const finished = sessions.filter(s => Date.parse(s.date_end) < Date.now()).sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
  for (const session of finished.slice(0, 3)) {
    const { data: laps } = await openf1Get('https://api.openf1.org/v1/laps', { params: { session_key: session.session_key, lap_number: 3 } });
    const lap = laps.find(l => l.lap_duration && !l.is_pit_out_lap && l.date_start);
    if (!lap) continue;
    const start = new Date(lap.date_start);
    const end = new Date(start.getTime() + lap.lap_duration * 1000);
    const { data: points } = await openf1Get(
      `https://api.openf1.org/v1/location?session_key=${session.session_key}&driver_number=${lap.driver_number}&date>=${start.toISOString()}&date<${end.toISOString()}`,
      { timeout: 20000 }
    );
    if (points.length > 50) {
      return { source: 'openf1', circuitKey: Number(circuitKey), rotation: 0, x: points.map(p => p.x), y: points.map(p => p.y), corners: [], miniSectorsIndexes: null };
    }
  }
  return null;
}

app.get('/api/live/circuit', async (req, res) => {
  const circuitKey = Number(req.query.key);
  const year = Number(req.query.year) || new Date().getFullYear();
  if (!circuitKey) return res.status(400).json({ error: 'Missing circuit key' });

  const cacheKey = `${circuitKey}-${year}`;
  const cached = circuitCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    if (!cached.circuit) return res.status(404).json({ error: 'Circuit layout not available' });
    res.set('Cache-Control', 'public, max-age=86400');
    return res.json(cached.circuit);
  }

  if (!circuitPending.has(cacheKey)) {
    circuitPending.set(cacheKey, loadCircuit(circuitKey, year)
      .then(({ circuit, failed }) => {
        const now = Date.now();
        circuitCache.set(cacheKey, { circuit, savedAt: now, expires: circuit ? now + CIRCUIT_DISK_TTL : now + (failed ? CIRCUIT_ERROR_TTL : CIRCUIT_MISS_TTL) });
        if (circuit) saveCircuitCache();
        return circuit;
      })
      .finally(() => circuitPending.delete(cacheKey)));
  }
  const circuit = await circuitPending.get(cacheKey);
  if (!circuit) return res.status(404).json({ error: 'Circuit layout not available' });
  res.set('Cache-Control', 'public, max-age=86400');
  res.json(circuit);
});

async function loadCircuit(circuitKey, year) {
  let circuit = null;
  for (let y = year; y >= year - 4 && !circuit; y--) {
    try {
      const { data } = await axios.get(`https://api.multiviewer.app/api/v1/circuits/${circuitKey}/${y}`, {
        timeout: 10000, headers: { 'User-Agent': 'F1-TV/1.0' }
      });
      if (Array.isArray(data?.x) && data.x.length) {
        circuit = {
          source: 'multiviewer', circuitKey, year: y, name: data.circuitName, rotation: data.rotation || 0,
          x: data.x, y: data.y,
          corners: (data.corners || []).map(c => ({ number: c.number, x: c.trackPosition.x, y: c.trackPosition.y })),
          miniSectorsIndexes: data.miniSectorsIndexes || null
        };
      }
    } catch { /* not published for this season, try the previous one */ }
  }
  if (circuit) return { circuit };
  try {
    circuit = await circuitFromOpenF1(circuitKey);
    if (circuit) console.log(`[Circuit] ${circuitKey}: traced from OpenF1 location data`);
    return { circuit };
  } catch (err) {
    console.warn(`[Circuit] ${circuitKey}: OpenF1 fallback failed (${err.message}), retrying in ${CIRCUIT_ERROR_TTL / 60000} min`);
    return { circuit: null, failed: true };
  }
}


// 4. Proxy Video (CORS Bypass & HLS Rewriter)
// Enhanced proxy with better CORS handling and HLS support
app.get('/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing URL parameter");

  console.log(`[Proxy] Fetching: ${url}`);

  try {
    // Extract domain for cookie jar
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // Build headers with cookies from jar
    const headers = {
      'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',  // Mimic VLC since it works
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive',
      // Don't send Referer/Origin for Xstream - they might be rejecting browser requests
    };

    // Add cookies from jar if we have any for this domain
    if (cookieJar.has(domain)) {
      headers['Cookie'] = cookieJar.get(domain);
      console.log(`[Proxy] Using stored cookies for ${domain}`);
    }

    // Use axios with arraybuffer to handle binary data correctly
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'arraybuffer',
      timeout: 30000, // 30 second timeout
      headers: headers,
      maxRedirects: 10, // Increase for token-based redirects
      validateStatus: function (status) {
        return status >= 200 && status < 500; // Accept wider range for debugging
      }
    });

    // Store any Set-Cookie headers for future requests
    if (response.headers['set-cookie']) {
      const cookies = response.headers['set-cookie'].join('; ');
      cookieJar.set(domain, cookies);
      console.log(`[Proxy] Stored cookies for ${domain}`);
    }

    const contentType = response.headers['content-type'] || '';

    // Set comprehensive CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    res.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

    // Cache control for HLS segments
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    if (contentType) {
      res.set('Content-Type', contentType);
    }

    // Handle HLS Playlists (Rewrite relative paths)
    const isM3U8 = contentType.includes('application/vnd.apple.mpegurl') ||
      contentType.includes('application/x-mpegurl') ||
      contentType.includes('mpegurl') ||
      url.endsWith('.m3u8');

    if (isM3U8) {
      console.log('[Proxy] Processing M3U8 playlist');
      let m3u8 = response.data.toString('utf8');

      // Check if we got HTML instead of M3U8 (authentication error)
      if (m3u8.includes('<!DOCTYPE') || m3u8.includes('<html')) {
        console.error('[Proxy] ❌ Received HTML instead of M3U8 - Authentication failed!');
        console.error('[Proxy] First 500 chars:', m3u8.substring(0, 500));
        res.status(403).send('Authentication failed - Xstream returned error page');
        return;
      }

      // Determine base URL for relative paths
      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

      const lines = m3u8.split('\n');
      const rewritten = lines.map(line => {
        const l = line.trim();

        // Skip comments and empty lines
        if (!l || l.startsWith('#')) return line;

        // It's a URL (segment or playlist)
        let absoluteUrl = l;
        if (!l.startsWith('http')) {
          // Handle relative URLs
          if (l.startsWith('/')) {
            // Absolute path - use origin
            const origin = url.substring(0, url.indexOf('/', 8));
            absoluteUrl = origin + l;
          } else {
            // Relative path - use base URL
            absoluteUrl = baseUrl + l;
          }
        }

        // IMPORTANT: We MUST proxy ALL URLs including token-based hlsr URLs
        // The browser can't access them directly due to CORS restrictions
        // The tokens are valid for 30-60 seconds which is enough for our proxy to fetch them
        return `http://localhost:${PORT}/proxy?url=${encodeURIComponent(absoluteUrl)}`;
      }).join('\n');

      console.log('[Proxy] ✅ Rewritten M3U8 playlist successfully');
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(rewritten);
    } else {
      // Check if binary data is actually HTML error
      if (contentType.includes('text/html')) {
        const htmlContent = response.data.toString('utf8');
        console.error('[Proxy] ❌ Received HTML error page instead of video segment!');
        console.error('[Proxy] Status:', response.status);
        console.error('[Proxy] Content:', htmlContent);
        res.status(403).send('Authentication failed - Cannot fetch video segments');
        return;
      }

      // Also check if response is empty or too small for a video segment
      if (response.data.length < 100) {
        const textContent = response.data.toString('utf8');
        console.error('[Proxy] ❌ Response too small for video segment!');
        console.error('[Proxy] Status:', response.status);
        console.error('[Proxy] Size:', response.data.length, 'bytes');
        console.error('[Proxy] Content:', textContent);
        res.status(502).send('Invalid segment data received');
        return;
      }

      // Binary data (TS segments, images, etc.)
      console.log(`[Proxy] ✅ Serving binary data: ${contentType}`);
      res.send(response.data);
    }

  } catch (error) {
    console.error(`[Proxy Error] URL: ${url}`);
    console.error(`[Proxy Error] Message: ${error.message}`);

    if (error.response) {
      console.error(`[Proxy Error] Status: ${error.response.status}`);
      console.error(`[Proxy Error] Headers:`, error.response.headers);
      res.status(error.response.status).send(`Proxy Error: ${error.response.statusText}`);
    } else if (error.code === 'ECONNABORTED') {
      res.status(504).send("Proxy Timeout - Stream server not responding");
    } else if (error.code === 'ENOTFOUND') {
      res.status(502).send("Proxy Error - Stream server not found");
    } else {
      res.status(502).send(`Proxy Error: ${error.message}`);
    }
  }
});

// Handle OPTIONS preflight requests for CORS
app.options('/proxy', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
  res.status(204).send();
});

// Serve Frontend in Production
// Serve Frontend in Production
if (process.env.NODE_ENV === 'production') {
  // Mount static files at both root and the base path to ensure assets load correctly
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/F1-TV', express.static(path.join(__dirname, 'public')));

  // Redirect root to the app base path
  app.get('/', (req, res) => {
    res.redirect('/F1-TV/');
  });

  // Handle SPA routing for both paths - send index.html
  app.get('/F1-TV/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏎️  F1-TV Server running on port ${PORT}`);
});