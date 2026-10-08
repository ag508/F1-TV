// Data layer: every external source the UI reads, cached at module level so
// views can unmount (e.g. while the player is open) and come back instantly.
import { useEffect, useState } from 'react';
import { apiBase } from './schedule';
import { teamColour } from './circuits';

// --- Generic cached resource ---

const resources = new Map(); // key -> { status, value, error, promise }

export function useResource(key, loader) {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!key) return;
    let entry = resources.get(key);
    if (!entry) {
      entry = { status: 'pending' };
      entry.promise = loader().then(
        value => { entry.status = 'done'; entry.value = value; },
        error => { entry.status = 'error'; entry.error = error; console.warn(`[Data] ${key}:`, error.message); });
      resources.set(key, entry);
    }
    let alive = true;
    if (entry.status === 'pending') entry.promise.then(() => alive && rerender(n => n + 1));
    return () => { alive = false; };
    // The key identifies the loader's inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const entry = key ? resources.get(key) : null;
  return { data: entry?.value, error: entry?.error, loading: !!key && (!entry || entry.status === 'pending') };
}

// --- Jolpica (Ergast): requests run one at a time, ~4/s is its burst limit ---

const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
let jolpicaQueue = Promise.resolve();
const jolpica = (path) => {
  const request = jolpicaQueue.then(() => fetch(`${JOLPICA}${path}`))
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(`Jolpica returned ${res.status} for ${path}`))));
  jolpicaQueue = request.catch(() => { }).then(() => new Promise(r => setTimeout(r, 280)));
  return request;
};

async function allPages(path, key) {
  const byRound = new Map();
  let offset = 0, total = Infinity;
  while (offset < total) {
    const data = await jolpica(`${path}?limit=100&offset=${offset}`);
    total = Number(data.MRData.total);
    offset += 100;
    for (const race of data.MRData.RaceTable.Races) {
      const entry = byRound.get(race.round) || { ...race, [key]: [] };
      entry[key].push(...race[key]);
      byRound.set(race.round, entry);
    }
  }
  return byRound;
}

export const useDriverStandings = () => useResource('driver-standings', async () => {
  const table = (await jolpica('/current/driverStandings.json')).MRData.StandingsTable.StandingsLists[0];
  return { round: table?.round, list: table?.DriverStandings || [] };
});

export const useConstructorStandings = () => useResource('constructor-standings', async () => {
  const table = (await jolpica('/current/constructorStandings.json')).MRData.StandingsTable.StandingsLists[0];
  return { round: table?.round, list: table?.ConstructorStandings || [] };
});

// Every race and sprint result of the season: podiums, recaps and the points
// progression all come from these few paginated requests.
export const useSeasonResults = (season) => useResource(season && `season-results-${season}`, async () => {
  const races = await allPages(`/${season}/results.json`, 'Results');
  const sprints = await allPages(`/${season}/sprint.json`, 'SprintResults');
  const rounds = [...races.values()]
    .map(r => ({ ...r, Results: [...r.Results].sort((a, b) => a.position - b.position), sprint: sprints.get(r.round)?.SprintResults || [] }))
    .sort((a, b) => a.round - b.round);

  // Cumulative points per driver after each round (race + sprint)
  const drivers = new Map();
  rounds.forEach((round, i) => {
    for (const r of [...round.Results, ...round.sprint]) {
      if (!drivers.has(r.Driver.driverId)) {
        drivers.set(r.Driver.driverId, { id: r.Driver.driverId, code: r.Driver.code, name: `${r.Driver.givenName} ${r.Driver.familyName}`, constructorId: r.Constructor.constructorId, perRound: Array(rounds.length).fill(0) });
      }
      drivers.get(r.Driver.driverId).perRound[i] += Number(r.points) || 0;
    }
  });
  for (const d of drivers.values()) {
    let sum = 0;
    d.cumulative = d.perRound.map(p => (sum += p));
  }
  return { rounds, drivers: [...drivers.values()] };
});

// Last five winners at this circuit
export const useCircuitWinners = (circuitId) => useResource(circuitId && `winners-${circuitId}`, async () => {
  const data = await jolpica(`/circuits/${circuitId}/results/1.json?limit=100`);
  return data.MRData.RaceTable.Races.slice(-5).reverse().map(r => ({
    year: r.season, driver: r.Results[0].Driver, constructor: r.Results[0].Constructor, time: r.Results[0].Time?.time,
  }));
});

// --- OpenF1: headshots + official team colours of the current grid ---

export const useGrid = () => useResource('openf1-grid', async () => {
  const res = await fetch('https://api.openf1.org/v1/drivers?session_key=latest');
  if (!res.ok) throw new Error(`OpenF1 returned ${res.status}`);
  const list = await res.json();
  return Object.fromEntries(list.map(d => [d.name_acronym, {
    headshot: d.headshot_url, colour: d.team_colour ? `#${d.team_colour}` : null, number: d.driver_number, team: d.team_name,
  }]));
});

// Team colour for a driver: OpenF1's official colour, else our table
export const colourFor = (grid, code, constructorId) => grid?.[code]?.colour || teamColour(constructorId);

// --- Open-Meteo: race weekend forecast at the circuit (up to 16 days ahead) ---

export const useWeekendWeather = (race, sessions, now) => {
  const lat = race?.Circuit?.Location?.lat, long = race?.Circuit?.Location?.long;
  const first = sessions?.[0]?.start, last = sessions?.at(-1)?.start;
  const inRange = first && last && last - now < 15 * 864e5 && last > now - 864e5;
  const day = (d) => d.toISOString().slice(0, 10);
  const key = lat && long && inRange ? `weather-${lat}-${long}-${day(first)}` : null;
  return useResource(key, async () => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${long}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,weather_code&timezone=auto&start_date=${day(first)}&end_date=${day(last)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
    const { daily } = await res.json();
    return daily.time.map((date, i) => ({
      date, max: daily.temperature_2m_max[i], min: daily.temperature_2m_min[i],
      rain: daily.precipitation_probability_max[i], wind: daily.wind_speed_10m_max[i], code: daily.weather_code[i],
    }));
  });
};

// --- Our server ---

export function useChannels() {
  const [channels, setChannels] = useState([]);
  useEffect(() => {
    fetch(`${apiBase()}/api/channels`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => Array.isArray(data) && setChannels(data))
      .catch(() => setChannels([]));
  }, []);
  return channels;
}

// Live session status from the F1 live timing feed (via our server)
export function useLiveStatus() {
  const [feed, setFeed] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const poll = () => fetch(`${apiBase()}/api/live/status`, { signal: AbortSignal.timeout(10000) })
      .then(res => (res.ok ? res.json() : null))
      .then(data => !cancelled && setFeed(data))
      .catch(() => !cancelled && setFeed(null));
    poll();
    const id = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return feed;
}

// Calendar (Jolpica, Sportstimes fallback) + OpenF1 session times
export function useSeason(year) {
  const [races, setRaces] = useState(null);
  const [officialSessions, setOfficialSessions] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await jolpica(`/${year}.json`);
        const list = data.MRData.RaceTable.Races;
        if (list?.length) return list;
      } catch (e) {
        console.warn('Jolpica calendar unavailable, trying Sportstimes', e);
      }
      const res = await fetch(`https://raw.githubusercontent.com/sportstimes/f1/main/_db/f1/${year}.json`);
      if (!res.ok) throw new Error('Sportstimes calendar unavailable');
      const raw = await res.json();
      const list = raw.races || raw;
      if (!Array.isArray(list)) throw new Error('Invalid calendar format');
      const session = (iso) => (iso ? { date: iso.split('T')[0], time: iso.split('T')[1] } : undefined);
      return list.map(r => ({
        round: String(r.round),
        raceName: `${r.name} Grand Prix`,
        date: r.sessions.gp.split('T')[0],
        time: r.sessions.gp.split('T')[1],
        season: String(year),
        FirstPractice: session(r.sessions.fp1),
        SecondPractice: session(r.sessions.fp2),
        ThirdPractice: session(r.sessions.fp3),
        SprintQualifying: session(r.sessions.sprintQualifying),
        Sprint: session(r.sessions.sprint),
        Qualifying: session(r.sessions.qualifying),
        Circuit: { circuitId: r.slug, Location: { locality: r.location, country: r.name } },
      })).sort((a, b) => Number(a.round) - Number(b.round));
    };
    load().then(setRaces).catch(e => { console.error('Calendar failed to load:', e); setRaces([]); });

    // Official session start/end times (incl. practice) and circuit keys
    fetch(`https://api.openf1.org/v1/sessions?year=${year}`)
      .then(res => (res.ok ? res.json() : []))
      .then(data => Array.isArray(data) && setOfficialSessions(data))
      .catch(err => console.warn('OpenF1 sessions unavailable, using default durations', err));
  }, [year]);

  return { races, officialSessions };
}

// Re-render on an interval so session states (upcoming -> live -> done) update
export function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// --- Derived metrics ---

const CLASSIFIED = /^(Finished|Lapped|\+\d+ Laps?)$/;

export function raceRecap(round) {
  if (!round?.Results?.length) return null;
  const results = round.Results;
  const gainer = results
    .filter(r => Number(r.grid) > 0 && CLASSIFIED.test(r.status))
    .map(r => ({ r, gain: Number(r.grid) - Number(r.position) }))
    .sort((a, b) => b.gain - a.gain)[0];
  return {
    round,
    podium: results.slice(0, 3),
    pole: results.find(r => r.grid === '1'),
    fastest: results.find(r => r.FastestLap?.rank === '1'),
    margin: results[1]?.Time?.time,
    laps: results[0].laps,
    classified: results.filter(r => CLASSIFIED.test(r.status)).length,
    starters: results.length,
    retirements: results.filter(r => !CLASSIFIED.test(r.status)),
    gainer: gainer?.gain > 0 ? gainer : null,
  };
}

// Points still on offer: 25 per remaining race, 8 per remaining sprint
export function titleFight(standings, weekends) {
  if (!standings?.length) return null;
  const left = weekends.filter(w => !w.state.finished);
  const races = left.length;
  const sprints = left.filter(w => w.state.sessions.some(s => s.key === 'S' && s.phase !== 'done')).length;
  const available = races * 25 + sprints * 8;
  const leader = Number(standings[0].points);
  const contenders = standings.filter(d => Number(d.points) + available >= leader);
  return { races, sprints, available, leader, gap: leader - Number(standings[1]?.points || 0), contenders };
}

// WMO weather codes -> short description
export function weatherLabel(code) {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67 || (code >= 80 && code <= 82)) return 'Rain';
  if (code <= 77 || code === 85 || code === 86) return 'Snow';
  return 'Thunderstorms';
}
