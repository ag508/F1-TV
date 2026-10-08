import React, { useEffect, useState } from 'react';
import { Check, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSun, Droplets, Snowflake, Sun, Wind } from 'lucide-react';
import { RollingDigit } from './ui';
import { weatherLabel } from '../lib/data';

// --- Countdown ---

const remaining = (date) => {
  const diff = Math.max(0, new Date(date) - Date.now());
  return [
    ['days', Math.floor(diff / 864e5)],
    ['hrs', Math.floor((diff / 36e5) % 24)],
    ['min', Math.floor((diff / 6e4) % 60)],
    ['sec', Math.floor((diff / 1e3) % 60)],
  ];
};

export const Countdown = ({ date, size = 'lg' }) => {
  const [units, setUnits] = useState(() => remaining(date));
  useEffect(() => {
    const id = setInterval(() => setUnits(remaining(date)), 1000);
    return () => clearInterval(id);
  }, [date]);
  const big = size === 'lg';
  return (
    <div className={`flex items-start ${big ? 'gap-4 sm:gap-6' : 'gap-3'}`} role="timer"
      aria-label={units.map(([u, v]) => `${v} ${u}`).join(', ')}>
      {units.map(([unit, val]) => (
        <div key={unit}>
          <div className={`display tnum leading-none flex ${big ? 'text-4xl sm:text-5xl' : 'text-2xl'}`} aria-hidden="true">
            {String(val).padStart(2, '0').split('').map((d, j) => <RollingDigit key={j} value={d} />)}
          </div>
          <div className="mt-1.5 text-[11px] text-steel">{unit}</div>
        </div>
      ))}
    </div>
  );
};

// --- Weekend timeline (a real sequence: FP1 -> Race) ---

export const SessionTimeline = ({ sessions }) => {
  if (!sessions?.length) return null;
  const anyLive = sessions.some(s => s.phase === 'live');
  const nextIndex = anyLive ? -1 : sessions.findIndex(s => s.phase === 'upcoming');
  return (
    <ol className="grid gap-1" style={{ gridTemplateColumns: `repeat(${sessions.length}, minmax(0, 1fr))` }}>
      {sessions.map((s, i) => {
        const passed = s.phase === 'done';
        const isNext = i === nextIndex;
        return (
          <li key={s.key} className="min-w-0" aria-current={s.phase === 'live' ? 'step' : undefined}>
            <div className="flex items-center">
              <span className={`relative grid place-items-center shrink-0 w-5 h-5 rounded-full border-2 ${
                s.phase === 'live' ? 'border-f1 bg-f1/20'
                  : passed ? 'border-steel bg-steel'
                    : isNext ? 'border-chalk bg-chalk/10'
                      : 'border-graphite bg-night'}`}>
                {passed && <Check className="w-3 h-3 text-night" strokeWidth={3.5} />}
                {s.phase === 'live' && <span className="live-dot" />}
              </span>
              {i < sessions.length - 1 && <span className={`h-0.5 flex-1 mx-1 rounded-full ${passed ? 'bg-steel' : 'bg-graphite'}`} />}
            </div>
            <div className={`mt-2 pr-1 text-xs font-bold leading-tight ${s.phase === 'live' ? 'text-f1' : passed ? 'text-steel' : 'text-chalk'}`}>{s.short}</div>
            <div className="tnum text-[11px] leading-tight mt-0.5 text-steel">
              {s.phase === 'live' ? 'Live now' : (
                <>{s.start.toLocaleDateString(undefined, { weekday: 'short' })} {s.start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

// --- Weather forecast at the circuit ---

const WeatherIcon = ({ code, className }) => {
  const Icon = code === 0 ? Sun : code <= 2 ? CloudSun : code === 3 ? Cloud : code <= 48 ? CloudFog
    : code <= 57 ? CloudDrizzle : code <= 67 || (code >= 80 && code <= 82) ? CloudRain
      : code <= 77 || code === 85 || code === 86 ? Snowflake : CloudLightning;
  return <Icon className={className} aria-hidden="true" />;
};

export const WeatherStrip = ({ days }) => {
  if (!days?.length) return null;
  return (
    <ul className="grid gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }} aria-label="Weekend forecast at the circuit">
      {days.map(d => {
        const date = new Date(`${d.date}T12:00:00`);
        return (
          <li key={d.date} className="rounded-[12px] bg-raised/70 border border-graphite/50 px-3 py-2.5 min-w-0" title={weatherLabel(d.code)}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold">{date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <WeatherIcon code={d.code} className="w-4 h-4 text-steel" />
            </div>
            <div className="tnum font-bold text-lg leading-none mt-2">{Math.round(d.max)}°<span className="text-steel text-sm font-semibold"> {Math.round(d.min)}°</span></div>
            <div className="flex flex-wrap gap-x-2 text-[11px] text-steel mt-1.5 tnum">
              <span className={`flex items-center gap-0.5 ${d.rain >= 50 ? 'text-chalk font-semibold' : ''}`}><Droplets className="w-3 h-3" />{d.rain}%</span>
              <span className="flex items-center gap-0.5"><Wind className="w-3 h-3" />{Math.round(d.wind)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
};
