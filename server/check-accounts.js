/**
 * One-off account checker for server/channels.json.
 * Queries each provider's player_api.php (same as /api/stream-health) and
 * reports account status + expiry, so expired entries can be pruned.
 *
 * Usage: node check-accounts.js
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const UA = 'VLC/3.0.18 LibVLC/3.0.18';
const channels = JSON.parse(fs.readFileSync(path.join(__dirname, 'channels.json'), 'utf8'));

(async () => {
  const results = [];
  for (const ch of channels) {
    // Stremio addon channels have no IPTV account to check
    if (ch.type === 'stremio') {
      const entry = { key: ch.key, type: 'stremio', addon: ch.addon, status: 'ADDON_CHANNEL' };
      results.push(entry);
      console.log(JSON.stringify(entry));
      continue;
    }
    const entry = { key: ch.key, server: ch.server, username: ch.username, channelId: ch.channelId };
    try {
      const { data } = await axios.get(`${ch.server}/player_api.php`, {
        params: { username: ch.username, password: ch.password },
        timeout: 8000,
        headers: { 'User-Agent': UA },
      });
      const u = data?.user_info;
      if (!u || u.auth === 0) {
        entry.status = 'REJECTED';
      } else {
        entry.status = u.status;
        entry.expiry = u.exp_date ? new Date(u.exp_date * 1000).toISOString().split('T')[0] : null;
        entry.activeConnections = Number(u.active_cons) || 0;
        entry.maxConnections = Number(u.max_connections) || null;
        const expired = u.exp_date && (u.exp_date * 1000) < Date.now();
        entry.expired = !!expired;
        entry.isExpiredOrInactive = expired || u.status !== 'Active';
      }
    } catch (err) {
      entry.status = 'UNREACHABLE';
      entry.error = err.code || err.message;
    }
    results.push(entry);
    console.log(JSON.stringify(entry));
  }
  fs.writeFileSync(path.join(__dirname, 'account-check-report.json'), JSON.stringify(results, null, 2));
  console.log('\nSummary:');
  for (const r of results) {
    if (r.type === 'stremio') { console.log(`  ${r.key.padEnd(14)} stremio addon (checked via /api/stream-health)`); continue; }
    console.log(`  ${r.key.padEnd(14)} ${String(r.status).padEnd(12)} ${r.expiry ? 'exp ' + r.expiry : ''} ${r.isExpiredOrInactive ? '  <-- REMOVE' : ''}`);
  }
})();
