import { apiBase } from './schedule';
import { useResource } from './store';

// Circuit outlines (MultiViewer, or traced from OpenF1 by our server). A venue's
// layout rarely changes, so outlines are kept in localStorage for 30 days and
// load instantly after the first visit, even if the server is slow.
const DAY = 864e5;

async function loadCircuit(circuitKey, year) {
  const res = await fetch(`${apiBase()}/api/live/circuit?key=${circuitKey}&year=${year}`);
  if (res.status === 404) throw new Error(`No outline published for circuit ${circuitKey}`);
  if (!res.ok) throw new Error(`Circuit ${circuitKey}: server returned ${res.status}`);
  const circuit = await res.json();
  if (!Array.isArray(circuit?.x) || !circuit.x.length) throw new Error(`Circuit ${circuitKey}: empty outline`);
  return circuit;
}

// undefined = loading, null = unavailable (show the fallback image)
export function useCircuit(circuitKey, year, enabled = true) {
  const key = enabled && circuitKey ? `circuit-${circuitKey}-${year}` : null;
  const { data, error } = useResource(key, () => loadCircuit(circuitKey, year), { persist: true, maxAge: 30 * DAY });
  if (!circuitKey) return null;
  if (data) return data;
  return error ? null : undefined;
}
