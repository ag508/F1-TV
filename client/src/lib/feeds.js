import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase } from './schedule';

export const ARCHIVE_STREAMS = [
  { key: 'archive-full', title: 'Full race replay', source: 'Archive', quality: '1080p', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', type: 'hls' },
  { key: 'archive-highlights', title: 'Race highlights', source: 'Archive', quality: '720p', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', type: 'hls' },
];

// Checks every channel in parallel; each row updates as soon as its own
// result arrives instead of waiting for the slowest provider.
export function useFeedHealth(channels, enabled) {
  const [health, setHealth] = useState({});
  const [checking, setChecking] = useState(false);
  const run = useRef(0);

  const checkAll = useCallback(async () => {
    const id = ++run.current;
    setChecking(true);
    setHealth(Object.fromEntries(channels.map(c => [c.key, { status: 'CHECKING' }])));
    await Promise.allSettled(channels.map(async (channel) => {
      let result;
      try {
        const res = await fetch(`${apiBase()}/api/stream-health?key=${encodeURIComponent(channel.key)}&probe=1`, { signal: AbortSignal.timeout(45000) });
        result = res.ok ? await res.json() : { status: 'UNKNOWN', reason: `Health check returned ${res.status}` };
      } catch (err) {
        result = { status: 'UNKNOWN', reason: err.name === 'TimeoutError' ? 'Check timed out after 45 s' : 'Server not reachable' };
      }
      if (run.current === id) setHealth(prev => ({ ...prev, [channel.key]: result }));
    }));
    if (run.current === id) setChecking(false);
  }, [channels]);

  useEffect(() => {
    if (!enabled || !channels.length) return;
    const t = setTimeout(checkAll, 0);
    return () => clearTimeout(t);
  }, [enabled, channels, checkAll]);

  return { health, checking, checkAll };
}
