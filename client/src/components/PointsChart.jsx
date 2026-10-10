import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';

// Cumulative championship points per round. One y-axis, thin 2px lines,
// direct labels at the line ends, and a dashed line for the second driver of
// a team (teammates share a team colour, so colour alone can't tell them apart).
const PAD = { top: 16, right: 64, bottom: 28, left: 40 };

const PointsChart = ({ series, rounds }) => {
  const wrap = useRef(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState(null); // round index
  const height = 300;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = rounds.length;
  const max = Math.max(1, ...series.map(s => s.values.at(-1) || 0));
  const step = max > 300 ? 100 : max > 120 ? 50 : 25;
  const top = Math.ceil(max / step) * step;
  const x = (i) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * (width - PAD.left - PAD.right));
  const y = (v) => PAD.top + (1 - v / top) * (height - PAD.top - PAD.bottom);
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);

  // End labels, nudged apart so they never overlap
  const labels = useMemo(() => {
    const placed = series.map(s => ({ s, y: y(s.values.at(-1) || 0) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i++) {
      if (placed[i].y - placed[i - 1].y < 15) placed[i].y = placed[i - 1].y + 15;
    }
    return placed;
    // y() depends on width/top only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, width, top]);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - PAD.left) / (width - PAD.left - PAD.right)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const hovered = hover != null
    ? series.map(s => ({ s, v: s.values[hover] })).sort((a, b) => b.v - a.v)
    : null;

  return (
    <div ref={wrap} className="relative w-full">
      <svg width={width} height={height} className="block" onPointerMove={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: "pan-y" }}
        role="img" aria-label={`Cumulative points after each round for ${series.map(s => s.code).join(', ')}`}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="rgb(56 56 63 / 0.6)" strokeWidth="1" />
            <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="tnum" fontSize="11" fill="rgb(148 148 152)">{t}</text>
          </g>
        ))}
        {rounds.map((r, i) => (n <= 12 || i % 2 === 0 || i === n - 1) && (
          <text key={r.axis} x={x(i)} y={height - 8} textAnchor={i === n - 1 && n > 1 ? 'end' : 'middle'} className="tnum" fontSize="11" fill={r.provisional ? 'rgb(255 214 10)' : 'rgb(148 148 152)'}>{r.axis}</text>
        ))}

        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={height - PAD.bottom} stroke="rgb(247 244 241 / 0.35)" strokeWidth="1" />}

        {series.map((s, si) => (
          <motion.path key={s.id} d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')}
            fill="none" stroke={s.colour} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
            strokeDasharray={s.dashed ? '6 5' : undefined}
            initial={s.dashed ? { opacity: 0 } : { pathLength: 0 }} whileInView={s.dashed ? { opacity: 1 } : { pathLength: 1 }}
            viewport={{ once: true }} transition={{ duration: 1.2, delay: si * 0.08, ease: [0.65, 0, 0.35, 1] }} />
        ))}
        {hover != null && series.map(s => (
          <circle key={s.id} cx={x(hover)} cy={y(s.values[hover])} r="4.5" fill={s.colour} stroke="rgb(21 21 30)" strokeWidth="2" />
        ))}
        {labels.map(({ s, y: ly }) => (
          <text key={s.id} x={width - PAD.right + 8} y={ly} dominantBaseline="middle" fontSize="12" fontWeight="700" fill="rgb(247 244 241)">
            {s.code} <tspan fill="rgb(148 148 152)" fontWeight="500" className="tnum">{s.values.at(-1)}</tspan>
          </text>
        ))}
      </svg>

      {hovered && (
        <div className="pointer-events-none absolute top-2 z-10 rounded-[10px] bg-night/95 border border-graphite px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(width - 150, Math.max(0, x(hover) + 12)) }}>
          <div className="font-bold mb-1">After {rounds[hover].title}</div>
          {hovered.map(({ s, v }) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="w-3 h-0.5" style={{ backgroundColor: s.colour }} />
              <span className="w-8">{s.code}</span>
              <span className="tnum ml-auto text-steel">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PointsChart;
