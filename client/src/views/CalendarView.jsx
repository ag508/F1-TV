import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Film, Play } from 'lucide-react';
import CircuitTrace from '../components/CircuitTrace';
import { Avatar, Segmented } from '../components/ui';
import { circuitImage } from '../lib/circuits';
import { colourFor, useGrid, useSeasonResults } from '../lib/data';
import { ease, softSpring } from '../lib/motion';

const Podium = ({ results, grid }) => {
  if (results === undefined) return <div className="h-[116px] rounded-[12px] bg-raised/40 animate-pulse" />;
  if (!results.length) return <div className="h-[116px] grid place-items-center text-sm text-steel">Results not published yet</div>;
  return (
    <ol className="space-y-1">
      {results.slice(0, 3).map(r => (
        <li key={r.position} className="flex items-center gap-3 h-9 text-sm">
          <span className="display w-4 text-steel">{r.position}</span>
          <Avatar src={grid?.[r.Driver.code]?.headshot} colour={colourFor(grid, r.Driver.code, r.Constructor.constructorId)} code={r.Driver.code} size={28} />
          <span className="font-bold w-12">{r.Driver.code}</span>
          <span className="text-steel truncate flex-1">{r.Constructor.name}</span>
          <span className="tnum text-xs text-steel">{r.Time?.time || r.status}</span>
        </li>
      ))}
    </ol>
  );
};

// `ref` is forwarded so AnimatePresence popLayout can measure the card
const RaceCard = ({ ref, race, state, phase, circuitKey, podium, grid, now, onWatch, onHighlights }) => {
  const [replay, setReplay] = useState(0);
  const date = new Date(`${race.date}T${race.time || '12:00:00Z'}`);
  const isNext = phase === 'next';
  const sprint = state.sessions.some(s => s.key === 'S');
  const days = Math.ceil((date - now) / 864e5);

  return (
    <motion.article ref={ref} layout transition={softSpring} onMouseEnter={() => setReplay(n => n + 1)}
      initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
      className={`card relative flex flex-col p-5 transition-colors duration-300 ${isNext ? 'border-f1/70 shadow-[0_30px_80px_-40px_rgb(225_6_0/0.6)]' : 'hover:border-steel/50'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="tnum font-semibold text-steel">Round {race.round}</span>
            {isNext && <span className="px-2 py-0.5 rounded-chip bg-f1 text-white font-bold">Up next</span>}
            {sprint && <span className="px-2 py-0.5 rounded-chip bg-raised text-chalk font-semibold">Sprint</span>}
          </div>
          <h3 className="display text-xl leading-tight mt-2 truncate">{race.raceName.replace('Grand Prix', 'GP')}</h3>
          <p className="text-sm text-steel truncate">{[race.Circuit.Location?.locality, race.Circuit.Location?.country].filter(Boolean).join(', ')}</p>
        </div>
        <CircuitTrace circuitKey={circuitKey} year={date.getFullYear()} fallbackSrc={circuitImage(race.Circuit.circuitId)}
          label={race.raceName} replay={replay} lazy className="w-20 h-20 shrink-0 -mt-1 -mr-1" />
      </div>

      <div className="mt-5 flex-1 flex flex-col">
        {phase === 'done' ? (
          <>
            <Podium results={podium} grid={grid} />
            <button onClick={() => onHighlights(race)} className="btn-line mt-4 self-start !py-1.5">
              <Film className="w-4 h-4 text-steel" /> Highlights
            </button>
          </>
        ) : (
          <div className="mt-auto flex items-end justify-between gap-3 pt-4 border-t border-graphite/50">
            <div>
              <div className="display text-2xl leading-none tnum">{date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>
              <div className="text-xs text-steel mt-1.5 tnum">
                {date.toLocaleDateString(undefined, { weekday: 'short' })} {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                {days > 0 && `, in ${days} days`}
              </div>
            </div>
            {isNext && (
              <button onClick={() => onWatch(race)} className="btn-f1 !px-5 !py-2 text-sm">
                <Play className="w-3.5 h-3.5 fill-current" /> Watch
              </button>
            )}
          </div>
        )}
      </div>
    </motion.article>
  );
};

const CalendarView = ({ weekends, heroRace, circuitKeys, now, onWatch, onHighlights }) => {
  const [filter, setFilter] = useState('all');
  const { data: results } = useSeasonResults(heroRace?.season);
  const { data: grid } = useGrid();
  const done = weekends.filter(w => w.state.finished).length;
  const podiumFor = (round) => results ? (results.rounds.find(r => r.round === round)?.Results || []) : undefined;

  const shown = weekends.filter(w => filter === 'all' || (filter === 'done' ? w.state.finished : !w.state.finished));

  return (
    <div className="space-y-5 lg:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl sm:text-4xl leading-none">Calendar</h1>
          <div className="flex items-center gap-3 text-sm text-steel mt-3">
            <span className="tnum">{done} of {weekends.length} raced</span>
            <span className="w-32 h-1.5 rounded-full bg-graphite/60 overflow-hidden">
              <motion.span className="block h-full bg-f1 rounded-full origin-left" style={{ width: `${(done / Math.max(1, weekends.length)) * 100}%` }}
                initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.9, ease }} />
            </span>
          </div>
        </div>
        <Segmented id="calendar" value={filter} onChange={setFilter}
          options={[{ value: 'all', label: 'All' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'done', label: 'Completed' }]} />
      </div>

      <motion.div layout className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map(({ race, state }) => (
            <RaceCard key={race.round} race={race} state={state}
              phase={state.finished ? 'done' : race === heroRace ? 'next' : 'upcoming'}
              circuitKey={circuitKeys[race.round]} podium={state.finished ? podiumFor(race.round) : undefined} grid={grid} now={now}
              onWatch={onWatch} onHighlights={onHighlights} />
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
};

export default CalendarView;
