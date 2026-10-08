import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useCircuit } from '../lib/circuitData';

// Real circuit outline (MultiViewer / OpenF1 via our server) drawn as SVG, so
// it can be traced on like a lap. Falls back to the Wikimedia layout image.

const VIEW = 1000;

function buildOutline(circuit) {
  if (!circuit?.x?.length) return null;
  const angle = ((circuit.rotation || 0) + 90) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const cx = (Math.min(...circuit.x) + Math.max(...circuit.x)) / 2;
  const cy = (Math.min(...circuit.y) + Math.max(...circuit.y)) / 2;
  const rotate = (x, y) => {
    const dx = x - cx, dy = y - cy;
    return [dx * cos - dy * sin + cx, dy * cos + dx * sin + cy];
  };
  const step = Math.max(1, Math.floor(circuit.x.length / 500));
  const raw = circuit.x.filter((_, i) => i % step === 0).map((x, i) => rotate(x, circuit.y[i * step]));
  const xs = raw.map(p => p[0]), ys = raw.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const bw = Math.max(...xs) - minX, bh = Math.max(...ys) - minY;
  const pad = 70;
  const scale = (VIEW - pad * 2) / Math.max(bw, bh);
  const ox = (VIEW - bw * scale) / 2, oy = (VIEW - bh * scale) / 2;
  const map = ([x, y]) => [ox + (x - minX) * scale, oy + (y - minY) * scale];
  const points = raw.map(map);
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z';

  // Start/finish: a short line across the track at the first point
  const [x0, y0] = points[0], [x1, y1] = points[Math.min(2, points.length - 1)];
  const a = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2;
  const finish = { x1: x0 - Math.cos(a) * 22, y1: y0 - Math.sin(a) * 22, x2: x0 + Math.cos(a) * 22, y2: y0 + Math.sin(a) * 22 };

  const corners = (circuit.corners || []).map(c => {
    const [x, y] = map(rotate(c.x, c.y));
    const dx = x - VIEW / 2, dy = y - VIEW / 2, dist = Math.hypot(dx, dy) || 1;
    return { n: c.number, x: x + (dx / dist) * 34, y: y + (dy / dist) * 34 };
  });
  return { d, finish, corners };
}

// Stroke widths in viewBox units (the SVG scales with its box)
const STROKES = {
  detail: { tarmac: 34, line: 6, finish: 8, font: 24 },
  thumb: { tarmac: 70, line: 22, finish: 26, font: 0 },
};

const CircuitTrace = ({ circuitKey, year, fallbackSrc, delay = 0, replay = 0, detail = false, lazy = false, label, className = '' }) => {
  const root = useRef(null);
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(!lazy);

  useEffect(() => {
    if (visible || !root.current) return;
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true), { rootMargin: '200px' });
    io.observe(root.current);
    return () => io.disconnect();
  }, [visible]);

  const circuit = useCircuit(circuitKey, year, visible);
  const outline = useMemo(() => buildOutline(circuit), [circuit]);
  const s = detail ? STROKES.detail : STROKES.thumb;
  const draw = (extraDelay = 0) => reduce ? {} : {
    initial: { pathLength: 0 },
    animate: { pathLength: 1 },
    transition: { duration: detail ? 1.8 : 1.1, delay: delay + extraDelay, ease: [0.65, 0, 0.35, 1] },
  };

  return (
    <div ref={root} className={`relative ${className}`} role="img" aria-label={label ? `${label} track layout` : 'Track layout'}>
      {outline ? (
        // Re-keyed on `replay` so hovering a card traces the lap again
        <svg key={replay} viewBox={`0 0 ${VIEW} ${VIEW}`} className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id={`trace-${circuitKey}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgb(247 244 241)" />
              <stop offset="100%" stopColor="rgb(225 6 0)" />
            </linearGradient>
          </defs>
          <motion.path d={outline.d} fill="none" stroke="rgb(56 56 63 / 0.85)" strokeWidth={s.tarmac}
            strokeLinejoin="round" strokeLinecap="round" {...draw()} />
          <motion.path d={outline.d} fill="none" stroke={`url(#trace-${circuitKey})`} strokeWidth={s.line}
            strokeLinejoin="round" strokeLinecap="round" {...draw(0.08)} />
          <motion.line {...outline.finish} stroke="rgb(247 244 241)" strokeWidth={s.finish}
            initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + (detail ? 1.6 : 0.9) }} />
          {detail && outline.corners.map((c, i) => (
            <motion.text key={c.n} className="tnum" x={c.x} y={c.y} textAnchor="middle" dominantBaseline="middle"
              fill="rgb(148 148 152)" fontSize={s.font} fontWeight="600"
              initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + 1 + i * 0.03 }}>{c.n}</motion.text>
          ))}
        </svg>
      ) : circuit === null && fallbackSrc ? (
        <img src={fallbackSrc} alt="" loading="lazy" className="w-full h-full object-contain invert opacity-60" />
      ) : (
        <div className="w-full h-full grid place-items-center">
          <span className="w-1/2 aspect-square rounded-full border border-dashed border-graphite animate-[spin_12s_linear_infinite]" />
        </div>
      )}
    </div>
  );
};

export default CircuitTrace;
