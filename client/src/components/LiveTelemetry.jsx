import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, CloudRain, Flag, Gauge, Radio, Satellite, Thermometer, Timer, Tag } from 'lucide-react';
import { apiBase, feedStatusLabel } from '../lib/schedule';

// Live session visualisation inspired by f1-race-replay: cars on a rendered
// track, leaderboard with tyres, and telemetry for the selected driver - fed by
// the official F1 live timing stream through our server.

const TRACK_STATUS = {
  '1': { label: 'Track Clear', color: '#22c55e', track: '#4b5563' },
  '2': { label: 'Yellow Flag', color: '#facc15', track: '#a16207' },
  '4': { label: 'Safety Car', color: '#f59e0b', track: '#b45309' },
  '5': { label: 'Red Flag', color: '#ef4444', track: '#991b1b' },
  '6': { label: 'Virtual Safety Car', color: '#f59e0b', track: '#b45309' },
  '7': { label: 'VSC Ending', color: '#f59e0b', track: '#b45309' },
};

const TYRES = {
  SOFT: { letter: 'S', color: '#ef4444' },
  MEDIUM: { letter: 'M', color: '#facc15' },
  HARD: { letter: 'H', color: '#f3f4f6' },
  INTERMEDIATE: { letter: 'I', color: '#22c55e' },
  WET: { letter: 'W', color: '#3b82f6' },
};

const ROTATION_FIX = 90;

const lapSeconds = (str) => {
  if (!str) return null;
  const parts = str.split(':').map(Number);
  const s = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  return Number.isFinite(s) && s > 20 ? s : null;
};

const formatClock = (ms) => {
  if (ms == null) return '--:--:--';
  const t = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60].map(n => String(n).padStart(2, '0')).join(':');
};

// --- Data hooks ---

function useLiveStream() {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const positionsRef = useRef({ at: null, cars: {} });
  const receivedAtRef = useRef(0);

  useEffect(() => {
    const es = new EventSource(`${apiBase()}/api/live/stream`);
    es.addEventListener('state', (e) => {
      const receivedAt = Date.now();
      receivedAtRef.current = receivedAt;
      setState({ ...JSON.parse(e.data), receivedAt });
      setConnected(true);
    });
    es.addEventListener('positions', (e) => { positionsRef.current = JSON.parse(e.data); });
    es.onerror = () => setConnected(false); // EventSource reconnects by itself
    return () => es.close();
  }, []);

  return { state, connected, positionsRef, receivedAtRef };
}

function useCircuit(circuitKey, year) {
  const [circuit, setCircuit] = useState(null);
  useEffect(() => {
    if (!circuitKey) return;
    let cancelled = false;
    fetch(`${apiBase()}/api/live/circuit?key=${circuitKey}&year=${year}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => !cancelled && setCircuit(data))
      .catch(() => !cancelled && setCircuit(null));
    return () => { cancelled = true; };
  }, [circuitKey, year]);
  return circuit;
}

// --- Track geometry ---

function useTrackGeometry(circuit) {
  return useMemo(() => {
    if (!circuit?.x?.length) return null;
    const angle = ((circuit.rotation || 0) + ROTATION_FIX) * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const cx = (Math.min(...circuit.x) + Math.max(...circuit.x)) / 2;
    const cy = (Math.min(...circuit.y) + Math.max(...circuit.y)) / 2;
    const rotate = (x, y) => {
      const dx = x - cx, dy = y - cy;
      return [dx * cos - dy * sin + cx, dy * cos + dx * sin + cy];
    };
    const points = circuit.x.map((x, i) => rotate(x, circuit.y[i]));
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };

    // Cumulative distance along the outline, used to place estimated positions
    const cumulative = [0];
    for (let i = 1; i < points.length; i++) {
      cumulative.push(cumulative[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    const length = cumulative.at(-1);

    const pointAt = (distance) => {
      const d = ((distance % length) + length) % length;
      let lo = 0, hi = cumulative.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid] <= d) lo = mid; else hi = mid;
      }
      const span = cumulative[hi] - cumulative[lo] || 1;
      const t = (d - cumulative[lo]) / span;
      return [points[lo][0] + (points[hi][0] - points[lo][0]) * t, points[lo][1] + (points[hi][1] - points[lo][1]) * t];
    };

    // Distance at which mini-sector i (0-based) is completed
    const segmentEnd = (i, total) => {
      const idx = circuit.miniSectorsIndexes;
      if (idx && idx.length === total) return cumulative[Math.min(idx[i], cumulative.length - 1)];
      return length * ((i + 1) / total);
    };

    const corners = (circuit.corners || []).map(c => ({ number: c.number, point: rotate(c.x, c.y) }));
    return { points, bounds, rotate, length, pointAt, segmentEnd, corners };
  }, [circuit]);
}

// --- Track map canvas ---

const TrackMap = ({ geometry, drivers, trackStatus, positionsRef, receivedAtRef, selected, onSelect, showLabels }) => {
  const canvasRef = useRef(null);
  const latest = useRef({});
  const displayed = useRef({}); // num -> { x, y } (GPS) or { d } (estimated distance)
  const screenPositions = useRef([]);

  // The animation loop reads the newest props through a ref
  useEffect(() => {
    latest.current = { geometry, drivers, trackStatus, selected, showLabels };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let frame;
    let last = performance.now();

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (now) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min(now - last, 100);
      last = now;
      const { geometry: geo, drivers: list, trackStatus: status, selected: sel, showLabels: labels } = latest.current;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      if (!geo) return;

      const pad = 28;
      const bw = geo.bounds.maxX - geo.bounds.minX, bh = geo.bounds.maxY - geo.bounds.minY;
      const scale = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
      const ox = (w - bw * scale) / 2, oy = (h - bh * scale) / 2;
      const toScreen = ([x, y]) => [ox + (x - geo.bounds.minX) * scale, oy + (y - geo.bounds.minY) * scale];

      // Track: dark tarmac with a status-coloured centre line
      const statusStyle = TRACK_STATUS[status?.code] || TRACK_STATUS['1'];
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      geo.points.forEach((p, i) => { const [sx, sy] = toScreen(p); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      ctx.closePath();
      ctx.strokeStyle = '#262626';
      ctx.lineWidth = 14;
      ctx.stroke();
      ctx.strokeStyle = statusStyle.track;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Start / finish line
      const [s0x, s0y] = toScreen(geo.points[0]);
      const [s1x, s1y] = toScreen(geo.points[Math.min(3, geo.points.length - 1)]);
      const ang = Math.atan2(s1y - s0y, s1x - s0x) + Math.PI / 2;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(s0x - Math.cos(ang) * 9, s0y - Math.sin(ang) * 9);
      ctx.lineTo(s0x + Math.cos(ang) * 9, s0y + Math.sin(ang) * 9);
      ctx.stroke();

      // Corner numbers
      ctx.fillStyle = '#525252';
      ctx.font = '600 9px "Titillium Web", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cxs = w / 2, cys = h / 2;
      for (const c of geo.corners) {
        const [x, y] = toScreen(c.point);
        const dx = x - cxs, dy = y - cys, dist = Math.hypot(dx, dy) || 1;
        ctx.fillText(String(c.number), x + (dx / dist) * 16, y + (dy / dist) * 16);
      }

      // Cars
      const gps = positionsRef.current?.cars || {};
      const hasGps = Object.keys(gps).length > 0;
      const smoothing = 1 - Math.exp(-dt / 180);
      const sinceSnapshot = Date.now() - receivedAtRef.current;
      const placed = [];

      for (const d of list || []) {
        if (d.retired || d.stopped) continue;
        let point = null;

        if (hasGps && gps[d.num]) {
          const target = geo.rotate(gps[d.num].x, gps[d.num].y);
          const cur = displayed.current[d.num];
          if (!cur?.xy || Math.hypot(target[0] - cur.xy[0], target[1] - cur.xy[1]) > geo.length / 6) {
            displayed.current[d.num] = { xy: target };
          } else {
            cur.xy = [cur.xy[0] + (target[0] - cur.xy[0]) * smoothing, cur.xy[1] + (target[1] - cur.xy[1]) * smoothing];
          }
          point = displayed.current[d.num].xy;
        } else if (d.segment && d.segment.total > 0 && !d.inPit) {
          // Estimate: last completed mini-sector + time since, at the car's lap pace
          const { index, total, ageMs } = d.segment;
          const lap = lapSeconds(d.lastLap) || lapSeconds(d.bestLap) || 95;
          const speed = geo.length / (lap * 1000);
          const from = geo.segmentEnd(index, total);
          const to = geo.segmentEnd((index + 1) % total, total) + (index + 1 === total ? geo.length : 0);
          const target = Math.min(from + speed * (ageMs + sinceSnapshot), from + (to - from) * 0.97);
          const cur = displayed.current[d.num];
          if (cur?.d == null) {
            displayed.current[d.num] = { d: target };
          } else {
            // Move forward along the lap, wrapping at the finish line
            let delta = ((target - cur.d) % geo.length + geo.length * 1.5) % geo.length - geo.length / 2;
            cur.d += delta * smoothing;
          }
          point = geo.pointAt(displayed.current[d.num].d);
        }
        if (!point) continue;
        placed.push({ d, screen: toScreen(point) });
      }

      // Draw back-to-front so the leader is on top; selected driver last
      placed.sort((a, b) => (a.d.num === sel) - (b.d.num === sel) || b.d.position - a.d.position);
      screenPositions.current = placed.map(p => ({ num: p.d.num, x: p.screen[0], y: p.screen[1] }));
      for (const { d, screen: [x, y] } of placed) {
        const isSel = d.num === sel;
        ctx.globalAlpha = d.inPit ? 0.45 : 1;
        if (isSel) {
          ctx.beginPath();
          ctx.arc(x, y, 11, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x, y, isSel ? 7 : 6, 0, Math.PI * 2);
        ctx.fillStyle = d.colour;
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (labels || isSel) {
          ctx.font = `700 ${isSel ? 12 : 10}px "Titillium Web", sans-serif`;
          ctx.textAlign = 'left';
          ctx.fillStyle = isSel ? '#ffffff' : '#d4d4d4';
          ctx.fillText(d.tla, x + 9, y - 8);
        }
        ctx.globalAlpha = 1;
      }
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [positionsRef, receivedAtRef]);

  const handleClick = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const hit = screenPositions.current
      .map(p => ({ ...p, dist: Math.hypot(p.x - x, p.y - y) }))
      .filter(p => p.dist < 16)
      .sort((a, b) => a.dist - b.dist)[0];
    if (hit) onSelect(hit.num);
  };

  return <canvas ref={canvasRef} onClick={handleClick} className="w-full h-full cursor-crosshair" />;
};

// --- Leaderboard ---

const TyreChip = ({ tyre }) => {
  if (!tyre) return <span className="w-5" />;
  const t = TYRES[tyre.compound] || { letter: '?', color: '#6b7280' };
  return (
    <span className="flex items-center gap-1" title={`${tyre.compound} · ${tyre.age} laps${tyre.isNew ? ' · new' : ''}`}>
      <span className="w-5 h-5 rounded-full border-2 flex items-center justify-center text-[9px] font-black bg-black"
        style={{ borderColor: t.color, color: t.color }}>{t.letter}</span>
      <span className="text-[10px] text-gray-500 font-mono w-4 text-right">{tyre.age}</span>
    </span>
  );
};

const DriverBadge = ({ d }) => {
  const badge = d.retired ? ['OUT', 'bg-red-900 text-red-300']
    : d.knockedOut ? ['KO', 'bg-gray-800 text-gray-400']
      : d.inPit ? ['PIT', 'bg-blue-900 text-blue-300']
        : d.pitOut ? ['OUT LAP', 'bg-blue-950 text-blue-400'] : null;
  return badge ? <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${badge[1]}`}>{badge[0]}</span> : null;
};

const Leaderboard = ({ drivers, selected, onSelect, isRace }) => {
  const [mode, setMode] = useState('gap');
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#333] text-[10px] uppercase tracking-wider text-gray-500 font-bold">
        <span>Leaderboard</span>
        <div className="flex bg-black/40 rounded border border-[#333] overflow-hidden">
          {[['gap', isRace ? 'Leader' : 'Fastest'], ['interval', 'Interval']].map(([key, label]) => (
            <button key={key} onClick={() => setMode(key)}
              className={`px-2 py-0.5 ${mode === key ? 'bg-[#ff1801] text-white' : 'text-gray-400 hover:text-white'}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {drivers.map(d => (
          <button key={d.num} onClick={() => onSelect(d.num)}
            className={`w-full flex items-center gap-2 px-3 h-8 text-xs border-b border-white/5 transition-colors ${d.num === selected ? 'bg-white/10' : 'hover:bg-white/5'} ${d.retired ? 'opacity-50' : ''}`}>
            <span className="w-5 text-right font-mono font-bold text-gray-400">{d.position < 99 ? d.position : '-'}</span>
            <span className="w-1 h-4 rounded-sm" style={{ backgroundColor: d.colour }} />
            <span className="font-bold text-white w-9 text-left">{d.tla}</span>
            <DriverBadge d={d} />
            <span className="ml-auto font-mono text-gray-300 text-[11px] truncate">
              {(mode === 'gap' ? d.gap : d.interval) || (d.position === 1 ? (isRace ? 'Leader' : d.bestLap) : '')}
            </span>
            <TyreChip tyre={d.tyre} />
          </button>
        ))}
      </div>
    </div>
  );
};

// --- Selected driver telemetry ---

const Bar = ({ label, value, color }) => (
  <div>
    <div className="flex justify-between text-[10px] uppercase text-gray-500 font-bold mb-1">
      <span>{label}</span><span className="font-mono text-gray-300">{value ?? 0}%</span>
    </div>
    <div className="h-1.5 bg-[#262626] rounded overflow-hidden">
      <div className="h-full transition-all duration-200" style={{ width: `${Math.min(100, value || 0)}%`, backgroundColor: color }} />
    </div>
  </div>
);

const Stat = ({ label, value, accent }) => (
  <div className="bg-black/40 border border-[#333] rounded px-2 py-1.5 min-w-0">
    <div className="text-[9px] uppercase text-gray-500 font-bold tracking-wider">{label}</div>
    <div className={`font-mono text-xs font-bold whitespace-nowrap ${accent || 'text-white'}`}>{value || '—'}</div>
  </div>
);

const sectorColor = (s) => (s.overallBest ? 'text-purple-400' : s.personalBest ? 'text-green-400' : 'text-yellow-300');

const DriverTelemetry = ({ driver }) => {
  if (!driver) return <div className="text-xs text-gray-500 p-4">Select a driver on the map or leaderboard.</div>;
  const car = driver.car;
  const drsOpen = car?.drs >= 10;
  return (
    <div className="p-3 md:p-4 grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 items-center">
      <div className="md:col-span-3 flex items-center gap-3 min-w-0">
        <div className="w-1 self-stretch rounded" style={{ backgroundColor: driver.colour }} />
        {driver.headshot && <img src={driver.headshot} alt="" className="w-12 h-12 object-contain bg-black/40 rounded" />}
        <div className="min-w-0">
          <div className="text-white font-black text-lg leading-tight italic">{driver.tla} <span className="text-gray-500 text-sm not-italic font-mono">#{driver.num}</span></div>
          <div className="text-[11px] text-gray-400 truncate">{driver.name} · {driver.team}</div>
        </div>
      </div>

      {car ? (
        <div className="md:col-span-4 grid grid-cols-3 gap-2 items-center">
          <div className="text-center">
            <div className="text-3xl font-black text-white font-mono leading-none">{car.speed ?? 0}</div>
            <div className="text-[9px] uppercase text-gray-500 font-bold">km/h</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-black text-[#ff1801] font-mono leading-none">{car.gear || 'N'}</div>
            <div className="text-[9px] uppercase text-gray-500 font-bold">Gear · {car.rpm ?? 0} rpm</div>
          </div>
          <div className="space-y-2">
            <Bar label="Throttle" value={car.throttle} color="#22c55e" />
            <Bar label="Brake" value={car.brake ? 100 : 0} color="#ef4444" />
            <div className={`text-[10px] font-bold text-center rounded py-0.5 ${drsOpen ? 'bg-green-600 text-white' : 'bg-[#262626] text-gray-500'}`}>DRS</div>
          </div>
        </div>
      ) : (
        <div className="md:col-span-4 grid grid-cols-4 gap-2">
          <Stat label="Speed trap" value={driver.speeds?.ST && `${driver.speeds.ST}`} />
          <Stat label="I1" value={driver.speeds?.I1} />
          <Stat label="I2" value={driver.speeds?.I2} />
          <Stat label="Finish" value={driver.speeds?.FL} />
        </div>
      )}

      <div className="md:col-span-5 grid grid-cols-3 sm:grid-cols-6 gap-2">
        <Stat label="Last lap" value={driver.lastLap} accent={driver.lastLapOverallBest ? 'text-purple-400' : driver.lastLapPersonalBest ? 'text-green-400' : undefined} />
        <Stat label="Best lap" value={driver.bestLap} />
        {driver.sectors.slice(0, 3).map((s, i) => (
          <Stat key={i} label={`S${i + 1}`} value={s.value} accent={s.value ? sectorColor(s) : undefined} />
        ))}
        <Stat label="Laps · Pits" value={`${driver.laps ?? 0} · ${driver.pitStops ?? 0}`} />
      </div>
    </div>
  );
};

// --- Main panel ---

const LiveTelemetry = () => {
  const { state, connected, positionsRef, receivedAtRef } = useLiveStream();
  const [picked, setSelected] = useState(null);
  const [showLabels, setShowLabels] = useState(true);
  const [tick, setTick] = useState(0);

  const session = state?.session;
  const year = session?.startUtc ? new Date(session.startUtc).getUTCFullYear() : 2026;
  const circuit = useCircuit(session?.meeting?.circuitKey, year);
  const geometry = useTrackGeometry(circuit);
  const drivers = useMemo(() => state?.drivers || [], [state]);
  const isRace = session?.type === 'Race';
  // Default selection: the leader
  const selected = picked ?? drivers[0]?.num ?? null;

  // Count the session clock down locally between snapshots
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const clockMs = state?.clock
    ? state.clock.running
      ? Math.max(0, state.clock.remainingMs - Math.max(0, tick - state.receivedAt))
      : state.clock.remainingMs
    : null;

  const status = TRACK_STATUS[state?.trackStatus?.code] || null;
  const selectedDriver = drivers.find(d => d.num === selected);
  const latestMessage = state?.raceControl?.[0];

  if (!state) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm gap-2">
        <Activity className="w-4 h-4 animate-pulse text-[#ff1801]" /> Connecting to live timing…
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Session bar */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3 px-4 md:px-6 py-3 border-b border-[#333] bg-black/40 text-xs">
        <span className="flex items-center gap-2 font-bold text-white uppercase tracking-wider">
          <Activity className="w-4 h-4 text-[#ff1801]" /> Live Telemetry
        </span>
        <span className="px-2 py-0.5 rounded bg-[#1a1a1a] border border-[#333] text-gray-300 font-bold">{session?.name}</span>
        <span className="text-gray-400">{feedStatusLabel(session?.status)}</span>
        {status && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded font-bold" style={{ color: status.color, backgroundColor: `${status.color}1a`, border: `1px solid ${status.color}55` }}>
            <Flag className="w-3 h-3" /> {status.label}
          </span>
        )}
        <span className="flex items-center gap-1 font-mono text-white font-bold">
          <Timer className="w-3 h-3 text-[#ff1801]" />
          {isRace && state.lapCount ? `LAP ${state.lapCount.current}/${state.lapCount.total}` : formatClock(clockMs)}
          {state.sessionPart ? <span className="text-gray-400 ml-1">Q{state.sessionPart}</span> : null}
        </span>
        {state.weather && (
          <span className="flex items-center gap-2 text-gray-400">
            <Thermometer className="w-3 h-3" /> Air {state.weather.air}° · Track {state.weather.track}°
            {state.weather.rain && <span className="flex items-center gap-1 text-blue-400"><CloudRain className="w-3 h-3" /> Rain</span>}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {state.source === 'replay' && <span className="px-2 py-0.5 rounded bg-purple-900/60 text-purple-300 font-bold">REPLAY</span>}
          <span className={`flex items-center gap-1 ${connected ? 'text-green-400' : 'text-yellow-400'}`}>
            <Radio className="w-3 h-3" /> {connected ? 'Connected' : 'Reconnecting'}
          </span>
        </span>
      </div>

      {/* Map + leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        <div className="lg:col-span-8 relative h-[340px] md:h-[420px] flex flex-col border-b lg:border-b-0 lg:border-r border-[#333]">
          <div className="flex-1 min-h-0">
            {geometry ? (
              <TrackMap geometry={geometry} drivers={drivers} trackStatus={state.trackStatus} positionsRef={positionsRef}
                receivedAtRef={receivedAtRef} selected={selected} onSelect={setSelected} showLabels={showLabels} />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-600 text-xs">Loading circuit layout…</div>
            )}
          </div>
          {latestMessage && (
            <div className="px-3 py-2 border-t border-[#333] bg-black/60 text-[11px] truncate">
              <span className="text-[#ff1801] font-bold mr-2">RACE CONTROL</span>
              <span className="text-gray-300">{latestMessage.Message}</span>
            </div>
          )}
          <div className="absolute top-3 left-3 flex flex-col gap-1 text-[10px]">
            <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-black/70 border border-[#333] text-gray-400" title={state.hasPositions ? 'Car GPS positions from F1 live timing' : 'GPS needs an F1TV token on the server; positions are interpolated from live mini-sector timing'}>
              {state.hasPositions ? <><Satellite className="w-3 h-3 text-green-400" /> GPS positions</> : <><Gauge className="w-3 h-3 text-yellow-400" /> Positions from mini-sectors</>}
            </span>
            <button onClick={() => setShowLabels(v => !v)} className="flex items-center gap-1 px-2 py-0.5 rounded bg-black/70 border border-[#333] text-gray-400 hover:text-white w-fit">
              <Tag className="w-3 h-3" /> {showLabels ? 'Hide' : 'Show'} names
            </button>
          </div>
        </div>
        <div className="lg:col-span-4 h-[320px] md:h-[420px]">
          <Leaderboard drivers={drivers} selected={selected} onSelect={setSelected} isRace={isRace || session?.name === 'Sprint'} />
        </div>
      </div>

      {/* Selected driver */}
      <div className="border-t border-[#333] bg-black/30">
        <DriverTelemetry driver={selectedDriver} />
      </div>
    </div>
  );
};

export default LiveTelemetry;
