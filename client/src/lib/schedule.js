// Weekend schedule + live session state.
//
// Start times come from Jolpica (every session: FP1-3, Sprint Qualifying,
// Sprint, Qualifying, Race). Scheduled end times come from OpenF1. Whether a
// session is actually running comes from the F1 live timing feed proxied by
// our server, so a delayed or red-flagged session stays LIVE until F1 marks it
// finalised, instead of flipping to the next race when the countdown hits 0.

export const apiBase = () =>
  import.meta.env.VITE_API_URL ||
  (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'http://localhost:3001' : window.location.origin);

const SESSION_DEFS = [
  { key: 'FP1', fields: ['FirstPractice'], name: 'Practice 1', short: 'FP1', minutes: 60 },
  { key: 'FP2', fields: ['SecondPractice'], name: 'Practice 2', short: 'FP2', minutes: 60 },
  { key: 'FP3', fields: ['ThirdPractice'], name: 'Practice 3', short: 'FP3', minutes: 60 },
  { key: 'SQ', fields: ['SprintQualifying', 'SprintShootout'], name: 'Sprint Qualifying', short: 'Sprint Quali', minutes: 45 },
  { key: 'S', fields: ['Sprint'], name: 'Sprint', short: 'Sprint', minutes: 60 },
  { key: 'Q', fields: ['Qualifying'], name: 'Qualifying', short: 'Qualifying', minutes: 60 },
  { key: 'R', fields: [], name: 'Race', short: 'Race', minutes: 120 },
];

// Feed statuses: Inactive -> Started -> (Aborted = red flag) -> Finished ->
// Finalised -> Ends. Qualifying goes Started/Finished/Inactive for each of
// Q1-Q3, so only Finalised/Ends mean the session is really over.
const FEED_ENDED = new Set(['Finalised', 'Ends']);
// Safety net if the feed gets stuck on a session that never finalises
const MAX_OVERRUN_MS = 5 * 60 * 60 * 1000;
const FEED_MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;

const toDate = (date, time) => {
  if (!date) return null;
  const d = new Date(`${date}T${time || '00:00:00Z'}`.replace(/Z?$/, 'Z'));
  return Number.isNaN(d.getTime()) ? null : d;
};

export function buildSessions(race, openf1Sessions = []) {
  if (!race) return [];
  return SESSION_DEFS.map(def => {
    const src = def.key === 'R' ? race : def.fields.map(f => race[f]).find(Boolean);
    const start = src && toDate(src.date, src.time);
    if (!start) return null;

    const official = openf1Sessions.find(s =>
      s.session_name === def.name && Math.abs(new Date(s.date_start) - start) < FEED_MATCH_WINDOW_MS);
    return {
      ...def,
      start: official ? new Date(official.date_start) : start,
      end: official?.date_end ? new Date(official.date_end) : new Date(start.getTime() + def.minutes * 60000),
    };
  }).filter(Boolean).sort((a, b) => a.start - b.start);
}

function feedSessionFor(session, feed) {
  const fs = feed?.session;
  if (!fs?.startUtc) return null;
  if (feed.source === 'replay') return null;
  const sameName = fs.name === session.name;
  return sameName && Math.abs(new Date(fs.startUtc) - session.start) < FEED_MATCH_WINDOW_MS ? fs : null;
}

export function sessionPhase(session, now, feed) {
  const fs = feedSessionFor(session, feed);
  const overrunLimit = session.end.getTime() + MAX_OVERRUN_MS;
  if (fs) {
    if (FEED_ENDED.has(fs.status)) return 'done';
    if (fs.status === 'Started' || fs.status === 'Aborted' || fs.status === 'Finished') {
      return now < overrunLimit ? 'live' : 'done';
    }
    // Inactive: before the start, or the start is delayed
    if (now >= session.start) return now < overrunLimit ? 'live' : 'done';
    return 'upcoming';
  }
  // No live feed for this session: fall back to the official schedule window
  if (now < session.start) return 'upcoming';
  if (now < session.end) return 'live';
  return 'done';
}

export function weekendState(race, openf1Sessions, now, feed) {
  const sessions = buildSessions(race, openf1Sessions).map(s => ({ ...s, phase: sessionPhase(s, now, feed) }));
  return {
    sessions,
    live: sessions.find(s => s.phase === 'live') || null,
    next: sessions.find(s => s.phase === 'upcoming') || null,
    finished: sessions.length > 0 && sessions.every(s => s.phase === 'done'),
  };
}

export function feedStatusLabel(status) {
  return {
    Started: 'Session running',
    Aborted: 'Red flag',
    Finished: 'Chequered flag',
    Inactive: 'Starting soon',
  }[status] || status || '';
}
