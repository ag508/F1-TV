/**
 * Live channel registry (server-side only).
 *
 * Provider credentials are NEVER sent to the browser and NEVER committed to the
 * repo. The client references a channel by its opaque `key`; the HLS and
 * health-check routes resolve the credentials here. Real credentials live in a
 * local, git-ignored file so they stay out of both the public client bundle and
 * the public repository.
 *
 * Load order:
 *   1. CHANNELS_FILE=/path/to/channels.json   (explicit override)
 *   2. server/channels.local.json              (git-ignored local override)
 *   3. server/channels.json                    (committed; ships in the image)
 *   4. the built-in placeholder below          (no real credentials)
 *
 * Copy server/channels.example.json to server/channels.json and fill in your
 * own provider lines to run the app. Two kinds of entries:
 *
 * IPTV (Xstream):
 *   { key, title, quality, english, channelId, server, username, password,
 *     profile? }
 * Use one account per entry, each with a free connection slot, so the parallel
 * status check never hits a provider's per-account limit.
 *
 * Stremio addon (live TV addons):
 *   { key, title, quality, english, type: 'stremio', addon, channelId,
 *     profile? }
 * `addon` is the addon base URL (manifest.json sits at `<addon>/manifest.json`;
 * configuration the addon needs must be part of that URL, e.g. PenguPlay's
 * URL-encoded JSON path). `channelId` is the addon's meta id. The stream URL
 * is resolved from the addon at FFmpeg spawn time (Stremio stream URLs are
 * signed and expiring), so nothing is stored here. See server/stremio.js.
 * Optional `fallbacks`: other addon channel ids carrying the same broadcast,
 * either strings (same addon) or { addon, channelId } (another addon). Their
 * streams join one pool that playback rotates through when a stream fails -
 * live addons list one channel under many ids and single ids go dark often.
 *
 * `profile` is optional: 'auto' (default) copies the source when it is already
 * browser-playable H.264 <=1080p and transcodes to 1080p H.264 otherwise;
 * 'source' always copies untouched (e.g. to keep a 4K feed native); '1080p'
 * always transcodes.
 */

const fs = require('fs');
const path = require('path');

// Placeholder shown when no channels.json is present - no real credentials.
const PLACEHOLDER = [
  { key: 'example', title: 'Example Channel (configure server/channels.json)', quality: '1080p', english: true,
    server: 'http://your-provider.example:8080', username: 'YOUR_USERNAME', password: 'YOUR_PASSWORD', channelId: 0 },
];

function loadChannels() {
  const candidates = [
    process.env.CHANNELS_FILE,
    path.join(__dirname, 'channels.local.json'),
    path.join(__dirname, 'channels.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(loaded) && loaded.length) {
        console.log(`[Channels] Loaded ${loaded.length} channels from ${file}`);
        return loaded;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[Channels] Could not read ${file}: ${err.message}`);
    }
  }
  console.warn('[Channels] No channels.json found - using placeholder. Copy channels.example.json to channels.json.');
  return PLACEHOLDER;
}

const channels = loadChannels();
const byKey = new Map(channels.map(c => [c.key, c]));

// Credentials for a channel key (server-side use only)
const resolve = (key) => byKey.get(key) || null;

// Public metadata only - safe to send to the browser (no credentials)
// `logo` (optional): an image URL shown for the channel in the feed menus
const publicList = () => channels.map(c => ({ key: c.key, title: c.title, quality: c.quality, english: !!c.english, ...(c.logo ? { logo: c.logo } : {}) }));

module.exports = { resolve, publicList };
