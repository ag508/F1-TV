// Data layer: every external source the UI reads. Caching and refreshing is
// handled by lib/store.js; request pacing and retries by lib/net.js.
//
// Results freshness: Jolpica is the official record, but it can publish a
// session's results hours late. OpenF1 posts the classification and the
// championship table within minutes, so until Jolpica catches up the
// standings, title fight, chart and latest result are laid over with
// OpenF1's numbers (and marked provisional).
import { useEffect, useMemo, useState } from 'react';
import { apiBase } from './schedule';
import { teamColour } from './circuits';
import { getJSON, jolpica, openf1 } from './net';
import { peek, revalidate, useResource } from './store';

export { revalidate };

const MIN = 60e3;
const HOUR = 60 * MIN;

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

// --- Jolpica standings and results ---

async function loadDriverStandings() {
  const table = (await jolpica('/current/driverStandings.json')).MRData.StandingsTable.StandingsLists[0];
  const next = { round: table?.round, list: table?.DriverStandings || [] };
  // A new round in Jolpica: everything derived from its results is out of date too
  const previous = peek('driver-standings');
  if (previous && previous.round !== next.round) setTimeout(() => revalidate(['constructor-standings', 'season-results']), 0);
  return next;
}

async function loadConstructorStandings() {
  const table = (await jolpica('/current/constructorStandings.json')).MRData.StandingsTable.StandingsLists[0];
  return { round: table?.round, list: table?.ConstructorStandings || [] };
}

// Every race and sprint result of the season: podiums, recaps and the points
// progression all come from these few paginated requests.
async function loadSeasonResults(season) {
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
}

const STANDINGS_OPTS = { persist: true, maxAge: 5 * MIN };

export const useDriverStandings = () => useResource('driver-standings', loadDriverStandings, STANDINGS_OPTS);
export const useConstructorStandings = () => useResource('constructor-standings', loadConstructorStandings, STANDINGS_OPTS);
export const useSeasonResults = (season) =>
  useResource(season && `season-results-${season}`, () => loadSeasonResults(season), { persist: true, maxAge: 6 * HOUR });

// Last five winners at this circuit
export const useCircuitWinners = (circuitId) => useResource(circuitId && `winners-${circuitId}`, async () => {
  const data = await jolpica(`/circuits/${circuitId}/results/1.json?limit=100`);
  return data.MRData.RaceTable.Races.slice(-5).reverse().map(r => ({
    year: r.season, driver: r.Results[0].Driver, constructor: r.Results[0].Constructor, time: r.Results[0].Time?.time,
  }));
}, { persist: true, maxAge: 24 * HOUR });

// --- OpenF1: latest scored session (race or sprint) ---

async function loadLatestScored(season) {
  const sessions = await openf1('/sessions', { year: season, session_type: 'Race' });
  const now = Date.now();
  const done = sessions
    .filter(s => Date.parse(s.date_end) < now)
    .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
  // Newest session whose championship table is published (it takes a few minutes)
  for (const s of done.slice(0, 2)) {
    const table = await openf1('/championship_drivers', { session_key: s.session_key });
    if (!Array.isArray(table) || !table.length) continue;
    const [result, drivers] = [await openf1('/session_result', { session_key: s.session_key }), await openf1('/drivers', { session_key: s.session_key })];
    const byNumber = Object.fromEntries(drivers.map(d => [d.driver_number, d]));
    const who = (n) => {
      const d = byNumber[n] || {};
      return { acronym: d.name_acronym, firstName: d.first_name, lastName: d.last_name, team: d.team_name, colour: d.team_colour ? `#${d.team_colour}` : null, headshot: d.headshot_url };
    };
    return {
      session: { key: s.session_key, name: s.session_name, start: s.date_start, country: s.country_name, location: s.location, circuit: s.circuit_short_name },
      table: table.map(t => ({ number: t.driver_number, ...who(t.driver_number), pointsStart: t.points_start, points: t.points_current, position: t.position_current })),
      result: result
        .filter(r => r.position != null || r.dnf || r.dns || r.dsq)
        .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
        .map(r => ({ number: r.driver_number, ...who(r.driver_number), position: r.position, points: r.points, gap: r.gap_to_leader, laps: r.number_of_laps, dnf: r.dnf, dns: r.dns, dsq: r.dsq })),
    };
  }
  return null;
}

export const useLatestScored = (season) =>
  useResource(season && `latest-session-${season}`, () => loadLatestScored(season), STANDINGS_OPTS);

const sum = (list, f) => list.reduce((t, x) => t + (Number(f(x)) || 0), 0);

// Jolpica standings with OpenF1's newer championship table laid over when
// Jolpica hasn't caught up yet (its total points are behind OpenF1's).
function mergeStandings(drivers, constructors, latest) {
  if (!drivers) return null;
  const table = latest?.table || [];
  const behind = table.length && sum(table, t => t.points) > sum(drivers.list, d => d.points) + 0.5;
  if (!behind) return { drivers: drivers.list, constructors: constructors?.list || [], round: drivers.round, provisional: null };

  const byCode = Object.fromEntries(table.filter(t => t.acronym).map(t => [t.acronym, t]));
  const winner = latest.session.name === 'Race' ? latest.result.find(r => r.position === 1)?.acronym : null;
  const teamDelta = {};
  const list = drivers.list.map(row => {
    const t = byCode[row.Driver.code];
    if (!t) return row;
    const team = row.Constructors[0]?.constructorId;
    if (team) teamDelta[team] = (teamDelta[team] || 0) + (t.points - Number(row.points));
    return { ...row, points: String(t.points), wins: String(Number(row.wins) + (winner === row.Driver.code ? 1 : 0)), _pos: t.position };
  }).sort((a, b) => (a._pos ?? 99) - (b._pos ?? 99) || b.points - a.points)
    .map((row, i) => ({ ...row, position: String(i + 1), positionText: String(i + 1) }));

  const teams = (constructors?.list || []).map(row => ({ ...row, points: String(Number(row.points) + (teamDelta[row.Constructor.constructorId] || 0)) }))
    .sort((a, b) => b.points - a.points)
    .map((row, i) => ({ ...row, position: String(i + 1), positionText: String(i + 1) }));

  return {
    drivers: list, constructors: teams, round: drivers.round,
    provisional: { session: latest.session, label: `${latest.session.country || latest.session.location} ${latest.session.name}` },
  };
}

// Standings everywhere in the app come from here
export function useStandings(season) {
  const d = useDriverStandings();
  const c = useConstructorStandings();
  const latest = useLatestScored(season);
  const data = useMemo(() => mergeStandings(d.data, c.data, latest.data), [d.data, c.data, latest.data]);
  return { data, latest: latest.data, loading: d.loading, error: d.error };
}

// --- OpenF1: headshots + official team colours of the current grid ---

export const useGrid = () => useResource('openf1-grid', async () => {
  const list = await openf1('/drivers', { session_key: 'latest' });
  return Object.fromEntries(list.map(d => [d.name_acronym, {
    headshot: d.headshot_url, colour: d.team_colour ? `#${d.team_colour}` : null, number: d.driver_number, team: d.team_name,
  }]));
}, { persist: true, maxAge: 6 * HOUR });

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
    const { daily } = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${long}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,weather_code&timezone=auto&start_date=${day(first)}&end_date=${day(last)}`);
    return daily.time.map((date, i) => ({
      date, max: daily.temperature_2m_max[i], min: daily.temperature_2m_min[i],
      rain: daily.precipitation_probability_max[i], wind: daily.wind_speed_10m_max[i], code: daily.weather_code[i],
    }));
  }, { persist: true, maxAge: HOUR });
};

// --- Our server ---

export function useChannels() {
  const [channels, setChannels] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const load = (attempt = 0) => fetch(`${apiBase()}/api/channels`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(res.status))))
      .then(data => !cancelled && Array.isArray(data) && setChannels(data))
      .catch(() => { if (!cancelled && attempt < 5) setTimeout(() => load(attempt + 1), 2000 * (attempt + 1)); });
    load();
    return () => { cancelled = true; };
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

// --- Calendar (Jolpica, Sportstimes fallback) + OpenF1 session times ---

async function loadCalendar(year) {
  try {
    const list = (await jolpica(`/${year}.json`)).MRData.RaceTable.Races;
    if (list?.length) return list;
  } catch (e) {
    console.warn('Jolpica calendar unavailable, trying Sportstimes', e);
  }
  const raw = await getJSON(`https://raw.githubusercontent.com/sportstimes/f1/main/_db/f1/${year}.json`);
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
}

export function useSeason(year) {
  const calendar = useResource(`calendar-${year}`, () => loadCalendar(year), { persist: true, maxAge: 6 * HOUR });
  const sessions = useResource(`openf1-sessions-${year}`, () => openf1('/sessions', { year }), { persist: true, maxAge: 3 * HOUR });
  return {
    races: calendar.data ?? (calendar.error ? [] : null),
    officialSessions: Array.isArray(sessions.data) ? sessions.data : [],
  };
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
