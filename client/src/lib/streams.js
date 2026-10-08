import { apiBase } from './schedule';

// Channels come from the server's /api/channels endpoint - the client only ever
// sees an opaque `key` plus display metadata, never provider hosts or
// credentials (those stay server-side in server/channels.js so they don't leak
// into this public client bundle). The server resolves the key to credentials
// for the HLS and health routes, and picks the profile (adaptive bitrate
// ladder by default). The 10-minute DVR buffer lets playback resume in place
// after buffering or a dropped connection.
export const streamUrlForKey = (key) => `${apiBase()}/hls/${encodeURIComponent(key)}/index.m3u8`;

// A playable stream object for a live channel from /api/channels
export const streamForChannel = (c) => ({
  key: c.key,
  title: c.title,
  source: c.english ? 'English commentary' : 'Live feed',
  quality: c.quality,
  logo: c.logo,
  url: streamUrlForKey(c.key),
  type: 'hls-live',
});
