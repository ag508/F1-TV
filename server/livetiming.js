/**
 * F1 Live Timing client
 *
 * Connects to the official F1 live timing SignalR Core hub (the same feed the
 * F1 app / FastF1 use), keeps a merged in-memory state of every topic and
 * exposes compact snapshots for the frontend.
 *
 * - Anonymous connections receive timing, tyres, track status, race control,
 *   weather, session status etc. Since mid-2025 F1 only sends car GPS
 *   (Position.z) and car telemetry (CarData.z) to F1TV-authenticated clients,
 *   so set F1TV_TOKEN to get them. Without it the frontend estimates car
 *   positions from the mini-sector timing data.
 * - LIVE_REPLAY=<static path> replays an archived session from
 *   livetiming.formula1.com/static through the exact same pipeline (useful to
 *   test the live UI outside of a race weekend).
 */

const { EventEmitter } = require('events');
const zlib = require('zlib');
const axios = require('axios');
const WebSocket = require('ws');

const BASE = 'https://livetiming.formula1.com';
const RS = '\x1e'; // SignalR record separator
const TOPICS = [
  'Heartbeat', 'SessionInfo', 'SessionStatus', 'TrackStatus', 'LapCount',
  'ExtrapolatedClock', 'DriverList', 'TimingData', 'TimingAppData', 'TimingStats',
  'RaceControlMessages', 'WeatherData', 'TopThree', 'Position.z', 'CarData.z'
];

// --- helpers ---

const inflate = (b64) => JSON.parse(zlib.inflateRawSync(Buffer.from(b64, 'base64')).toString('utf8'));

// Deep-merge a SignalR diff into the current state. Arrays are patched with
// index-keyed objects ({"2": {...}}), "_deleted" lists keys to remove.
function merge(target, patch) {
  if (patch === null || typeof patch !== 'object') return patch;
  if (Array.isArray(patch)) return patch.map(v => merge(undefined, v));
  const out = (target && typeof target === 'object') ? target : {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === '_kf') continue;
    if (k === '_deleted') {
      for (const d of v) Array.isArray(out) ? (out[Number(d)] = undefined) : delete out[d];
      continue;
    }
    const key = Array.isArray(out) ? Number(k) : k;
    out[key] = merge(out[key], v);
  }
  return out;
}

const values = (o) => (o ? (Array.isArray(o) ? o : Object.values(o)).filter(Boolean) : []);

// "01:23:45.678" -> ms
function hmsToMs(s) {
  if (!s) return 0;
  const [h, m, sec] = s.split(':');
  return ((Number(h) * 60 + Number(m)) * 60 + Number(sec)) * 1000;
}

// SessionInfo.StartDate is local track time; GmtOffset converts it to UTC.
function localToUtc(local, offset) {
  if (!local) return null;
  const sign = offset && offset.startsWith('-') ? -1 : 1;
  const ms = Date.parse(`${local}Z`) - sign * hmsToMs((offset || '00:00:00').replace('-', ''));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

class LiveTiming extends EventEmitter {
  constructor({ token, replayPath, replaySpeed, replayStart, disabled } = {}) {
    super();
    this.setMaxListeners(200);
    this.token = token || null;
    this.replayPath = replayPath || null;
    this.replaySpeed = Number(replaySpeed) || 1;
    this.replayStart = replayStart || null;
    this.disabled = !!disabled;

    this.state = {};
    this.positions = {};   // racingNumber -> { x, y, z, status }
    this.carData = {};     // racingNumber -> { rpm, speed, gear, throttle, brake, drs }
    this.segments = {};    // racingNumber -> { index, at }
    this.lastMessageAt = 0;
    this.connected = false;
    this.ws = null;
    this.retry = 0;
    this.virtualNow = null; // replay clock (ms, UTC)
  }

  now() { return this.virtualNow ?? Date.now(); }

  start() {
    if (this.disabled) return;
    if (this.replayPath) return this.startReplay().catch(err => console.error('[LiveTiming] Replay failed:', err.message));
    this.connect();
    this.pollStatic();
    setInterval(() => this.pollStatic(), 60 * 1000).unref();
    // Watchdog: F1 sends a Heartbeat every few seconds while a session is on;
    // outside sessions the hub is quiet, so only force a reconnect after 3 minutes.
    setInterval(() => {
      if (this.connected && Date.now() - this.lastMessageAt > 3 * 60 * 1000) {
        console.warn('[LiveTiming] Feed silent, reconnecting');
        this.ws?.terminate();
      }
    }, 30 * 1000).unref();
  }

  // --- Live SignalR Core connection ---

  async connect() {
    const headers = { 'User-Agent': 'BestHTTP', 'Accept-Encoding': 'gzip, identity' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    try {
      const neg = await axios.post(`${BASE}/signalrcore/negotiate?negotiateVersion=1`, '', { headers, timeout: 15000 });
      const cookie = (neg.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
      const id = encodeURIComponent(neg.data.connectionToken || neg.data.connectionId);
      const ws = new WebSocket(`wss://livetiming.formula1.com/signalrcore?id=${id}`, { headers: { ...headers, Cookie: cookie } });
      this.ws = ws;
      let ping;

      ws.on('open', () => {
        ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS);
        ws.send(JSON.stringify({ type: 1, invocationId: '0', target: 'Subscribe', arguments: [TOPICS] }) + RS);
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 6 }) + RS), 15000);
        this.connected = true;
        this.retry = 0;
        this.lastMessageAt = Date.now();
        console.log(`[LiveTiming] Connected to F1 live timing${this.token ? ' (F1TV authenticated)' : ''}`);
      });

      ws.on('message', (raw) => {
        this.lastMessageAt = Date.now();
        for (const part of raw.toString().split(RS)) {
          if (!part) continue;
          let msg;
          try { msg = JSON.parse(part); } catch { continue; }
          if (msg.type === 3 && msg.result) {
            // Subscribe completion carries the full current state of every topic
            this.reset();
            for (const [topic, data] of Object.entries(msg.result)) this.apply(topic, data);
            this.emit('update', 'init');
          } else if (msg.type === 1 && msg.target === 'feed') {
            const [topic, data] = msg.arguments;
            this.apply(topic, data);
            this.emit('update', topic);
          } else if (msg.type === 7) {
            ws.close();
          }
        }
      });

      ws.on('close', () => {
        clearInterval(ping);
        this.connected = false;
        this.scheduleReconnect();
      });
      ws.on('error', (err) => console.warn('[LiveTiming] Socket error:', err.message));
    } catch (err) {
      console.warn('[LiveTiming] Negotiate failed:', err.message);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    const delay = Math.min(2000 * 2 ** this.retry++, 60000);
    setTimeout(() => this.connect(), delay).unref();
  }

  // Fallback status source when the socket is down: the static SessionInfo
  // document is refreshed by F1 throughout each session.
  async pollStatic() {
    if (this.connected) return;
    try {
      const { data } = await axios.get(`${BASE}/static/SessionInfo.json`, { timeout: 10000, responseType: 'text' });
      const info = JSON.parse(String(data).replace(/^﻿/, ''));
      if (info?.Key && info.Key !== this.state.SessionInfo?.Key) this.reset();
      this.state.SessionInfo = info;
      if (info?.SessionStatus) this.state.SessionStatus = { Status: info.SessionStatus };
      this.emit('update', 'SessionInfo');
    } catch (err) {
      console.warn('[LiveTiming] Static SessionInfo poll failed:', err.message);
    }
  }

  reset() {
    this.state = {};
    this.positions = {};
    this.carData = {};
    this.segments = {};
  }

  // --- State handling ---

  apply(topic, data) {
    if (topic === 'Position.z') return this.applyPosition(typeof data === 'string' ? inflate(data) : data);
    if (topic === 'CarData.z') return this.applyCarData(typeof data === 'string' ? inflate(data) : data);

    if (topic === 'SessionInfo' && data?.Key && this.state.SessionInfo?.Key && data.Key !== this.state.SessionInfo.Key) {
      // New session on the same connection: drop the previous session's timing
      const info = this.state.SessionInfo;
      this.reset();
      this.state.SessionInfo = info;
    }
    this.state[topic] = merge(this.state[topic], data);
    if (topic === 'TimingData') this.trackSegments(data);
  }

  applyPosition(data) {
    const latest = values(data?.Position).at(-1);
    if (!latest) return;
    for (const [num, p] of Object.entries(latest.Entries || {})) {
      this.positions[num] = { x: p.X, y: p.Y, z: p.Z, status: p.Status };
    }
    this.positionsAt = this.now();
  }

  applyCarData(data) {
    const latest = values(data?.Entries).at(-1);
    if (!latest) return;
    for (const [num, car] of Object.entries(latest.Cars || {})) {
      const c = car.Channels || {};
      this.carData[num] = { rpm: c['0'], speed: c['2'], gear: c['3'], throttle: c['4'], brake: c['5'], drs: c['45'] };
    }
  }

  // Remember the most recently completed mini-sector of every car. This is the
  // basis of the position estimate when GPS (Position.z) is not available.
  // Called after the patch is merged, so sector segment counts are complete.
  trackSegments(patch) {
    const current = this.state.TimingData?.Lines || {};
    for (const [num, line] of Object.entries(patch?.Lines || {})) {
      if (!line?.Sectors) continue;
      const sectorsNow = values(current[num]?.Sectors);
      for (const [sKey, sector] of Object.entries(line.Sectors)) {
        if (!sector?.Segments) continue;
        for (const [gKey, seg] of Object.entries(sector.Segments)) {
          if (!seg?.Status) continue;
          const s = Number(sKey);
          let index = Number(gKey);
          for (let i = 0; i < s; i++) index += values(sectorsNow[i]?.Segments).length;
          this.segments[num] = { index, at: this.now(), pit: seg.Status === 2064 };
        }
      }
    }
  }

  // --- Snapshots for the frontend ---

  sessionSummary() {
    const info = this.state.SessionInfo;
    if (!info) return null;
    return {
      key: info.Key,
      name: info.Name,
      type: info.Type,
      status: this.state.SessionStatus?.Status || info.SessionStatus || 'Unknown',
      startUtc: localToUtc(info.StartDate, info.GmtOffset),
      endUtc: localToUtc(info.EndDate, info.GmtOffset),
      path: info.Path,
      meeting: {
        key: info.Meeting?.Key,
        name: info.Meeting?.Name,
        officialName: info.Meeting?.OfficialName,
        location: info.Meeting?.Location,
        country: info.Meeting?.Country?.Name,
        circuitKey: info.Meeting?.Circuit?.Key,
        circuitName: info.Meeting?.Circuit?.ShortName
      }
    };
  }

  status() {
    return {
      source: this.replayPath ? 'replay' : 'live',
      connected: this.connected,
      authenticated: !!this.token,
      hasPositions: Object.keys(this.positions).length > 0,
      session: this.sessionSummary(),
      serverTime: new Date(this.now()).toISOString()
    };
  }

  snapshot() {
    const s = this.state;
    const now = this.now();
    const timing = s.TimingData?.Lines || {};
    const app = s.TimingAppData?.Lines || {};
    const stats = s.TimingStats?.Lines || {};
    const list = s.DriverList || {};

    const drivers = Object.keys(list).filter(n => list[n]?.Tla).map(num => {
      const d = list[num];
      const t = timing[num] || {};
      const stints = values(app[num]?.Stints);
      const stint = stints.at(-1);
      const seg = this.segments[num];
      const totalSegments = values(t.Sectors).reduce((acc, sec) => acc + values(sec?.Segments).length, 0);
      return {
        num,
        tla: d.Tla,
        name: d.FullName || d.BroadcastName,
        team: d.TeamName,
        colour: d.TeamColour ? `#${d.TeamColour}` : '#888888',
        headshot: d.HeadshotUrl,
        position: Number(t.Position || d.Line || 99),
        gap: t.GapToLeader ?? t.TimeDiffToFastest ?? '',
        interval: t.IntervalToPositionAhead?.Value ?? t.TimeDiffToPositionAhead ?? '',
        lastLap: t.LastLapTime?.Value || '',
        lastLapPersonalBest: !!t.LastLapTime?.PersonalFastest,
        lastLapOverallBest: !!t.LastLapTime?.OverallFastest,
        bestLap: t.BestLapTime?.Value || stats[num]?.PersonalBestLapTime?.Value || '',
        laps: t.NumberOfLaps ?? null,
        pitStops: t.NumberOfPitStops ?? Math.max(stints.length - 1, 0),
        inPit: !!t.InPit,
        pitOut: !!t.PitOut,
        retired: !!t.Retired,
        stopped: !!t.Stopped,
        knockedOut: !!t.KnockedOut,
        sectors: values(t.Sectors).map(sec => ({
          value: sec.Value || sec.PreviousValue || '',
          personalBest: !!sec.PersonalFastest,
          overallBest: !!sec.OverallFastest
        })),
        speeds: Object.fromEntries(Object.entries(t.Speeds || {}).map(([k, v]) => [k, v?.Value || ''])),
        tyre: stint ? { compound: stint.Compound, isNew: stint.New === 'true', age: stint.TotalLaps ?? 0 } : null,
        segment: seg ? { index: seg.index, total: totalSegments, ageMs: now - seg.at, pit: seg.pit } : null,
        car: this.carData[num] || null
      };
    }).sort((a, b) => a.position - b.position);

    const clock = s.ExtrapolatedClock;
    let remainingMs = clock ? hmsToMs(clock.Remaining) : null;
    if (clock?.Extrapolating && clock.Utc) remainingMs = Math.max(0, remainingMs - (now - Date.parse(clock.Utc)));

    return {
      ...this.status(),
      trackStatus: s.TrackStatus ? { code: s.TrackStatus.Status, message: s.TrackStatus.Message } : null,
      lapCount: s.LapCount ? { current: s.LapCount.CurrentLap, total: s.LapCount.TotalLaps } : null,
      clock: clock ? { remainingMs, running: !!clock.Extrapolating } : null,
      sessionPart: s.TimingData?.SessionPart ?? null,
      weather: s.WeatherData ? {
        air: Number(s.WeatherData.AirTemp), track: Number(s.WeatherData.TrackTemp),
        humidity: Number(s.WeatherData.Humidity), rain: s.WeatherData.Rainfall === '1',
        wind: Number(s.WeatherData.WindSpeed)
      } : null,
      raceControl: values(s.RaceControlMessages?.Messages).slice(-6).reverse(),
      drivers
    };
  }

  positionSnapshot() {
    return { at: this.positionsAt || null, cars: this.positions };
  }

  // --- Replay of archived sessions (testing / demo) ---

  async startReplay() {
    const path = this.replayPath.replace(/^\/+|\/+$/g, '') + '/';
    console.log(`[LiveTiming] Replaying ${path} at ${this.replaySpeed}x`);
    const info = await axios.get(`${BASE}/static/${path}SessionInfo.json`, { responseType: 'text', timeout: 20000 });
    const sessionInfo = JSON.parse(String(info.data).replace(/^﻿/, ''));

    const events = [];
    await Promise.all(TOPICS.filter(t => t !== 'SessionInfo').map(async (topic) => {
      try {
        const res = await axios.get(`${BASE}/static/${path}${topic}.jsonStream`, { responseType: 'text', timeout: 120000 });
        for (const line of String(res.data).replace(/^﻿/, '').split(/\r?\n/)) {
          if (line.length < 13) continue;
          events.push({ t: hmsToMs(line.slice(0, 12)), topic, raw: line.slice(12) });
        }
      } catch (err) {
        console.warn(`[LiveTiming] Replay topic ${topic} unavailable: ${err.message}`);
      }
    }));
    events.sort((a, b) => a.t - b.t);
    if (!events.length) throw new Error('No replay data found');

    // Map stream offsets to wall clock using the ExtrapolatedClock topic, which
    // carries both the stream offset and the UTC time.
    const clockEvent = events.find(e => e.topic === 'ExtrapolatedClock');
    const clockUtc = clockEvent ? Date.parse(JSON.parse(clockEvent.raw).Utc) : Date.parse(localToUtc(sessionInfo.StartDate, sessionInfo.GmtOffset));
    const utcAt = (t) => clockUtc + (t - (clockEvent?.t || 0));

    const started = events.find(e => e.topic === 'SessionStatus' && e.raw.includes('"Started"'));
    const startAt = this.replayStart ? hmsToMs(this.replayStart) : Math.max(0, (started?.t || 0) - 30000);

    this.reset();
    this.state.SessionInfo = sessionInfo;
    this.connected = true;

    let i = 0;
    // Fast-forward everything before the start point (skip heavy .z frames)
    for (; i < events.length && events[i].t < startAt; i++) {
      const e = events[i];
      this.virtualNow = utcAt(e.t);
      if (!e.topic.endsWith('.z')) this.apply(e.topic, JSON.parse(e.raw));
    }

    const wallStart = Date.now();
    const tick = () => {
      const streamT = startAt + (Date.now() - wallStart) * this.replaySpeed;
      this.virtualNow = utcAt(streamT);
      for (; i < events.length && events[i].t <= streamT; i++) {
        const e = events[i];
        // LIVE_REPLAY_GPS=0 previews what anonymous live viewers get (no GPS/car data)
        if (process.env.LIVE_REPLAY_GPS === '0' && e.topic.endsWith('.z')) continue;
        try { this.apply(e.topic, JSON.parse(e.raw)); } catch { /* skip malformed line */ }
      }
      this.emit('update', 'replay');
      if (i < events.length) setTimeout(tick, 200);
      else console.log('[LiveTiming] Replay finished');
    };
    tick();
  }
}

module.exports = { LiveTiming };
