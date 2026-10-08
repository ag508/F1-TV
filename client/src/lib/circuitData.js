import { useEffect, useState } from 'react';
import { apiBase } from './schedule';

// Circuit outlines (MultiViewer / OpenF1 via our server), fetched once each
const cache = new Map(); // `${key}-${year}` -> Promise<circuit | null>
const loadCircuit = (key, year) => {
  const id = `${key}-${year}`;
  if (!cache.has(id)) {
    cache.set(id, fetch(`${apiBase()}/api/live/circuit?key=${key}&year=${year}`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return cache.get(id);
};

// Loads a circuit when `enabled`; undefined = loading, null = unavailable
export function useCircuit(circuitKey, year, enabled = true) {
  const [loaded, setLoaded] = useState({ id: null, data: null });
  const id = `${circuitKey}-${year}`;
  useEffect(() => {
    if (!enabled || !circuitKey) return;
    let cancelled = false;
    loadCircuit(circuitKey, year).then(c => !cancelled && setLoaded({ id: `${circuitKey}-${year}`, data: c }));
    return () => { cancelled = true; };
  }, [circuitKey, year, enabled]);
  return !circuitKey ? null : loaded.id === id ? loaded.data : undefined;
}
