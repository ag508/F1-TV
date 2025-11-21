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
const app = express();

// Session storage for cookies (to maintain Xstream authentication)
const cookieJar = new Map();

// Active FFmpeg processes for restreaming
const activeStreams = new Map();

// --- CONFIG ---
const PORT = process.env.PORT || 3000;
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
// Fetches the source stream with FFmpeg and restreams it as MPEG-TS
app.get('/restream/:channelId', (req, res) => {
  const { channelId } = req.params;
  const { server, username, password } = req.query;

  if (!server || !username || !password) {
    return res.status(400).send('Missing required parameters: server, username, password');
  }

  // Build source URL
  const sourceUrl = `${server}/live/${username}/${password}/${channelId}.m3u8`;
  const streamKey = `${username}-${channelId}`;

  console.log(`[Restream] Request for channel ${channelId}`);

  // Check if stream is already running
  if (activeStreams.has(streamKey)) {
    console.log(`[Restream] Using existing stream for ${streamKey}`);
    const streamData = activeStreams.get(streamKey);
    streamData.clientCount++;

    // Set headers for streaming
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log(`[Restream] Client connected to ${streamKey} (${streamData.clientCount} total clients)`);

    // Pipe FFmpeg output to this new client
    streamData.ffmpeg.stdout.pipe(res, { end: false });

    // Clean up on client disconnect
    req.on('close', () => {
      streamData.clientCount--;
      console.log(`[Restream] Client disconnected from ${streamKey} (${streamData.clientCount} clients remaining)`);

      // Kill FFmpeg after 30 seconds if no clients
      if (streamData.clientCount === 0) {
        setTimeout(() => {
          if (activeStreams.has(streamKey) && activeStreams.get(streamKey).clientCount === 0) {
            console.log(`[Restream] Killing idle stream: ${streamKey}`);
            activeStreams.get(streamKey).ffmpeg.kill('SIGTERM');
            activeStreams.delete(streamKey);
          }
        }, 30000);
      }
    });
  } else {
    console.log(`[Restream] Starting new FFmpeg process for ${streamKey}`);

    // Start FFmpeg process to restream
    const ffmpeg = spawn('ffmpeg', [
      '-re',                 // Read input at native frame rate
      '-user_agent', 'VLC/3.0.18 LibVLC/3.0.18',
      '-i', sourceUrl,
      '-c:v', 'copy',        // Copy video codec (no transcoding)
      '-c:a', 'aac',         // Transcode audio to AAC (browser-compatible)
      '-ac', '2',            // Downmix to stereo (more compatible)
      '-b:a', '192k',        // Audio bitrate
      '-f', 'mpegts',        // Output as MPEG-TS
      'pipe:1'               // Output to stdout
    ]);

    const streamData = {
      ffmpeg: ffmpeg,
      clientCount: 1,
      startTime: Date.now()
    };

    activeStreams.set(streamKey, streamData);

    // Only log important FFmpeg messages
    ffmpeg.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output.includes('Input #') || output.includes('Output #') ||
          output.includes('Stream #') || output.includes('error') ||
          output.includes('Error')) {
        console.log(`[FFmpeg ${channelId}]`, output);
      }
    });

    ffmpeg.on('error', (err) => {
      console.error(`[FFmpeg Error ${channelId}]:`, err);
      activeStreams.delete(streamKey);
    });

    ffmpeg.on('close', (code) => {
      console.log(`[FFmpeg ${channelId}] Process closed with code ${code}`);
      activeStreams.delete(streamKey);
    });

    // Set headers for streaming
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log(`[Restream] Client connected to ${streamKey} (1 client)`);

    // Pipe FFmpeg output to response
    ffmpeg.stdout.pipe(res, { end: false });

    // Clean up on client disconnect
    req.on('close', () => {
      streamData.clientCount--;
      console.log(`[Restream] Client disconnected from ${streamKey} (${streamData.clientCount} clients remaining)`);

      // Kill FFmpeg after 30 seconds if no clients
      if (streamData.clientCount === 0) {
        setTimeout(() => {
          if (activeStreams.has(streamKey) && activeStreams.get(streamKey).clientCount === 0) {
            console.log(`[Restream] Killing idle stream: ${streamKey}`);
            activeStreams.get(streamKey).ffmpeg.kill('SIGTERM');
            activeStreams.delete(streamKey);
          }
        }, 30000);
      }
    });
  }
});

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
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
}

app.listen(PORT, () => {
  console.log(`🏎️  F1-TV Server running on port ${PORT}`);
});