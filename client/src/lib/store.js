// Stale-while-revalidate cache for API data.
//
// - A view gets cached data immediately (from memory, or from localStorage
//   for `persist` resources, so even a fresh page load paints at once).
// - Data older than `maxAge` is refetched in the background; the old data
//   stays on screen until the new data arrives.
// - `revalidate(prefixes)` forces a refetch (used when a session ends and on
//   the race-weekend poll), and coming back to the tab refetches stale data.
// - If a refetch returns identical data nothing re-renders; if it differs,
//   every view using it updates at once.
import { useEffect, useReducer } from 'react';

const STORAGE_PREFIX = 'f1hub:v2:';
const RETRY_AFTER_ERROR_MS = 15000;
const entries = new Map();

function entryFor(key, persist) {
  let e = entries.get(key);
  if (!e) {
    e = { key, value: undefined, json: null, error: null, fetchedAt: 0, failedAt: 0, promise: null, loader: null, listeners: new Set(), persist };
    if (persist) {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + key));
        if (saved && saved.v !== undefined) {
          e.value = saved.v;
          e.json = JSON.stringify(saved.v);
          e.fetchedAt = saved.t || 0;
        }
      } catch { /* storage unavailable or corrupt: fetch fresh */ }
    }
    entries.set(key, e);
  }
  return e;
}

const notify = (e) => e.listeners.forEach(fn => fn());

function load(e) {
  if (e.promise || !e.loader) return;
  if (Date.now() - e.failedAt < RETRY_AFTER_ERROR_MS) return;
  e.promise = e.loader()
    .then(value => {
      e.fetchedAt = Date.now();
      e.error = null;
      const json = JSON.stringify(value);
      if (json !== e.json) {
        e.value = value;
        e.json = json;
      }
      if (e.persist) {
        try { localStorage.setItem(STORAGE_PREFIX + e.key, JSON.stringify({ v: e.value, t: e.fetchedAt })); } catch { /* quota: memory only */ }
      }
    }, error => {
      e.error = error;
      e.failedAt = Date.now();
      console.warn(`[Data] ${e.key}: ${error.message}`);
    })
    .finally(() => { e.promise = null; notify(e); });
  notify(e);
}

// Current value without subscribing (used by loaders to compare with the last result)
export const peek = (key) => entries.get(key)?.value;

// Force a refetch of every resource whose key starts with one of `prefixes`
export function revalidate(prefixes) {
  for (const e of entries.values()) {
    if (!prefixes.some(p => e.key.startsWith(p))) continue;
    e.fetchedAt = 0;
    e.failedAt = 0;
    if (e.listeners.size) load(e);
  }
}

export function useResource(key, loader, { maxAge = 10 * 60e3, persist = false } = {}) {
  const [, rerender] = useReducer(n => n + 1, 0);
  const e = key ? entryFor(key, persist) : null;

  useEffect(() => {
    if (!e) return;
    // The key identifies the loader's inputs, so the newest loader is safe to keep
    e.loader = loader;
    e.listeners.add(rerender);
    const stale = () => !e.fetchedAt || Date.now() - e.fetchedAt > maxAge;
    if (stale()) load(e);
    const onVisible = () => document.visibilityState === 'visible' && stale() && load(e);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      e.listeners.delete(rerender);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, maxAge]);

  return {
    data: e?.value,
    error: e && e.value === undefined ? e.error : null,
    loading: !!e && e.value === undefined && !e.error,
    refreshing: !!e?.promise,
  };
}

// Debugging aid in `vite dev` only: window.__f1hub.revalidate(['driver-standings'])
if (import.meta.env.DEV && typeof window !== 'undefined') window.__f1hub = { revalidate, peek };
