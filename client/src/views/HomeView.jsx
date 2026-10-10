import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Activity, ArrowUpRight, MapPin, Play, TrendingUp, Trophy } from 'lucide-react';
import StartLights from '../components/StartLights';
import CircuitTrace from '../components/CircuitTrace';
import { useCircuit } from '../lib/circuitData';
import { Countdown, SessionTimeline, WeatherStrip } from '../components/Weekend';
import { AnimatedNumber, Avatar, ProvisionalBadge, Skeleton, Stat } from '../components/ui';
import { circuitImage } from '../lib/circuits';
import { colourFor, raceRecap, titleFight, useCircuitWinners, useGrid, useSeasonResults, useStandings, useWeekendWeather } from '../lib/data';
import { feedStatusLabel } from '../lib/schedule';
import { ease } from '../lib/motion';

// The lights-out intro plays once per visit, not every time Home remounts
let introPlayed = false;

const placeOf = (race) => [race.Circuit.Location?.locality, race.Circuit.Location?.country].filter(Boolean).join(', ');

// --- Hero: this weekend ---

const WeekendHero = ({ race, weekend, feed, circuitKey, total, now, onWatch, onLive }) => {
  const reduce = useReducedMotion();
  const [launched, setLaunched] = useState(introPlayed || reduce);
  const { live, next, sessions } = weekend;
  const year = Number(race.season) || new Date(race.date).getFullYear();
  const circuit = useCircuit(circuitKey, year);
  const { data: forecast } = useWeekendWeather(race, sessions, now);
  const liveFeed = feed?.session && live && feed.session.name === live.name ? feed.session : null;
  const isSprint = sessions.some(s => s.key === 'S');
  const words = race.raceName.split(' ');

  const launch = () => { introPlayed = true; setLaunched(true); };
  const reveal = (i = 0) => ({
    initial: launched && introPlayed ? false : { opacity: 0, y: 14 },
    animate: launched ? { opacity: 1, y: 0 } : undefined,
    transition: { duration: 0.6, ease, delay: 0.25 + i * 0.07 },
  });

  return (
    <section className="relative overflow-hidden rounded-stage border border-graphite/60 bg-carbon" aria-labelledby="race-title">
      {/* Red speed lines across the top corner: static, no filters */}
      <div aria-hidden="true" className="absolute -right-24 -top-24 w-[34rem] h-[34rem] opacity-70 bg-[repeating-linear-gradient(115deg,transparent_0_22px,rgb(225_6_0/0.08)_22px_24px)] [mask-image:radial-gradient(closest-side,black,transparent)]" />

      <div className="relative grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-6 lg:gap-10 p-5 sm:p-8 lg:p-10">
        <div className="min-w-0 flex flex-col">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <StartLights play={!introPlayed} onDone={launch} />
            {live ? (
              <span className="flex items-center gap-2 text-sm font-bold text-f1">
                <span className="live-dot" /> {live.name} is live
                {liveFeed && <span className="text-steel font-medium">{feedStatusLabel(liveFeed.status)}</span>}
              </span>
            ) : (
              <span className="text-sm text-steel">
                <span className="text-chalk font-bold">Round {race.round}</span> of {total}
                {isSprint && <span className="ml-2 px-2 py-0.5 rounded-chip bg-raised text-chalk text-xs font-semibold">Sprint weekend</span>}
              </span>
            )}
          </div>

          <h1 id="race-title" className="display mt-6 text-[clamp(2.3rem,6vw,5rem)] leading-[0.92] [text-wrap:balance]">
            {words.map((w, i) => (
              <span key={i} className="inline-block overflow-hidden align-bottom pb-[0.06em] -mb-[0.06em]">
                <motion.span className="inline-block"
                  initial={launched && introPlayed ? false : { y: '105%' }}
                  animate={launched ? { y: 0 } : undefined}
                  transition={{ duration: 0.7, ease, delay: i * 0.06 }}>
                  {w}
                </motion.span>
                {i < words.length - 1 && ' '}
              </span>
            ))}
          </h1>

          <motion.p {...reveal(0)} className="mt-4 flex items-start gap-2 text-steel">
            <MapPin className="w-4 h-4 mt-1 shrink-0" />
            <span><span className="text-chalk font-semibold">{race.Circuit.circuitName || race.Circuit.Location?.locality}</span>, {placeOf(race)}</span>
          </motion.p>

          <motion.div {...reveal(1)} className="mt-6 flex flex-wrap items-center gap-3">
            <button onClick={() => onWatch(race)} className="btn-f1">
              <Play className="w-4 h-4 fill-current" /> {live ? 'Watch live' : 'Open feeds'}
            </button>
            <button onClick={onLive} className="btn-line">
              <Activity className="w-4 h-4" /> {live ? 'Live timing' : 'Live centre'}
            </button>
          </motion.div>

          <motion.div {...reveal(2)} className="mt-auto pt-8">
            {live ? (
              <div className="flex items-baseline gap-3">
                <span className="text-sm text-steel">Now running</span>
                <span className="display text-3xl text-f1">{live.short}</span>
              </div>
            ) : next ? (
              <>
                <div className="text-sm text-steel mb-2">{next.key === 'R' ? 'Lights out in' : `${next.name} starts in`}</div>
                <Countdown key={next.start.toISOString()} date={next.start.toISOString()} />
              </>
            ) : (
              <div className="display text-2xl">Weekend complete</div>
            )}
          </motion.div>
        </div>

        <motion.div {...reveal(1)} className="flex flex-col">
          <CircuitTrace circuitKey={circuitKey} year={year} fallbackSrc={circuitImage(race.Circuit.circuitId)}
            label={race.raceName} detail delay={introPlayed ? 0 : 1.2} className="w-full max-w-[400px] aspect-square mx-auto" />
          <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-[12px] bg-raised/60 py-2.5">
              <dt className="text-[11px] text-steel">Corners</dt>
              <dd className="tnum font-bold text-lg">{circuit?.corners?.length || '—'}</dd>
            </div>
            <div className="rounded-[12px] bg-raised/60 py-2.5">
              <dt className="text-[11px] text-steel">Sessions</dt>
              <dd className="tnum font-bold text-lg">{sessions.length}</dd>
            </div>
            <div className="rounded-[12px] bg-raised/60 py-2.5">
              <dt className="text-[11px] text-steel">Race day</dt>
              <dd className="font-bold text-lg">{new Date(`${race.date}T${race.time || '12:00:00Z'}`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</dd>
            </div>
          </dl>
        </motion.div>
      </div>

      <div className="relative grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-6 lg:gap-10 border-t border-graphite/60 bg-night/40 px-5 sm:px-8 lg:px-10 py-6">
        <div className="min-w-0 overflow-x-auto -mx-1 px-1">
          <div className="min-w-[420px]"><SessionTimeline sessions={sessions} /></div>
        </div>
        {forecast?.length ? <WeatherStrip days={forecast} /> : (
          <p className="text-sm text-steel self-center">The circuit forecast appears about two weeks before the race.</p>
        )}
      </div>
    </section>
  );
};

// --- Last race recap ---

const PodiumStep = ({ r, grid, place }) => {
  const colour = colourFor(grid, r.Driver.code, r.Constructor.constructorId);
  return (
    <li className={`relative flex flex-col items-center text-center rounded-card bg-raised/60 border border-graphite/50 px-2 pt-4 pb-3 ${place === 1 ? 'sm:-mt-3' : ''}`}>
      <span className="absolute top-2 left-3 display text-lg text-steel">{place}</span>
      <Avatar src={grid?.[r.Driver.code]?.headshot} colour={colour} code={r.Driver.code} size={place === 1 ? 72 : 60} />
      <div className="mt-2 font-bold leading-tight truncate max-w-full">{r.Driver.familyName}</div>
      <div className="text-xs text-steel truncate max-w-full">{r.Constructor.name}</div>
      <div className="tnum text-xs mt-1.5 text-chalk/80">{r.Time?.time || r.status}</div>
    </li>
  );
};

// A session only OpenF1 has published so far (often a sprint, or a race just finished)
const OpenF1Result = ({ latest }) => {
  const { session, result } = latest;
  const finished = result.filter(r => !r.dnf && !r.dns && !r.dsq);
  const out = result.filter(r => r.dnf || r.dns || r.dsq);
  const p2 = result.find(r => r.position === 2);
  return (
    <article className="card p-5 sm:p-6 h-full" aria-labelledby="last-race">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-steel">Latest result <ProvisionalBadge /></div>
          <h2 id="last-race" className="display text-xl sm:text-2xl leading-tight mt-1">{session.country || session.location} {session.name}</h2>
        </div>
        <Trophy className="w-5 h-5 text-steel shrink-0" />
      </div>
      <ol className="grid grid-cols-3 gap-2 sm:gap-3 items-end">
        {[1, 0, 2].map(i => {
          const r = result.find(x => x.position === i + 1);
          return r && (
            <li key={i} className={`relative flex flex-col items-center text-center rounded-card bg-raised/60 border border-graphite/50 px-2 pt-4 pb-3 ${i === 0 ? 'sm:-mt-3' : ''}`}>
              <span className="absolute top-2 left-3 display text-lg text-steel">{i + 1}</span>
              <Avatar src={r.headshot} colour={r.colour || undefined} code={r.acronym} size={i === 0 ? 72 : 60} />
              <div className="mt-2 font-bold leading-tight truncate max-w-full">{r.lastName}</div>
              <div className="text-xs text-steel truncate max-w-full">{r.team}</div>
              <div className="tnum text-xs mt-1.5 text-chalk/80">{i === 0 ? `${r.laps} laps` : typeof r.gap === 'number' ? `+${r.gap.toFixed(3)}` : r.gap}</div>
            </li>
          );
        })}
      </ol>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4 mt-6 pt-5 border-t border-graphite/50">
        <Stat label="Winning margin">{typeof p2?.gap === 'number' ? <span className="tnum">+{p2.gap.toFixed(3)} s</span> : '—'}</Stat>
        <Stat label="Points to the winner"><span className="tnum">{result[0]?.points ?? '—'}</span></Stat>
        <Stat label="Laps"><span className="tnum">{result[0]?.laps ?? '—'}</span></Stat>
        <Stat label="Finishers"><span className="tnum">{finished.length} of {result.length}</span></Stat>
        <Stat label="Retirements" sub={out.slice(0, 3).map(r => r.acronym).join(', ') || 'None'}><span className="tnum">{out.length}</span></Stat>
      </div>
    </article>
  );
};

const LastRace = ({ season }) => {
  const { data, loading } = useSeasonResults(season);
  const { latest } = useStandings(season);
  const { data: grid } = useGrid();
  const lastRound = data?.rounds?.at(-1);
  const lastRaceAt = lastRound ? Date.parse(`${lastRound.date}T${lastRound.time || '12:00:00Z'}`) : 0;
  if (latest?.result?.length && Date.parse(latest.session.start) > lastRaceAt + 3600e3) return <OpenF1Result latest={latest} />;
  if (loading) return <Skeleton className="h-[360px]" />;
  const recap = raceRecap(lastRound);
  if (!recap) return null;
  const { round } = recap;
  return (
    <article className="card p-5 sm:p-6 h-full" aria-labelledby="last-race">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="text-xs text-steel">Last race, round {round.round}</div>
          <h2 id="last-race" className="display text-xl sm:text-2xl leading-tight mt-1">{round.raceName}</h2>
        </div>
        <Trophy className="w-5 h-5 text-steel shrink-0" />
      </div>

      <ol className="grid grid-cols-3 gap-2 sm:gap-3 items-end">
        {[1, 0, 2].map(i => recap.podium[i] && <PodiumStep key={i} r={recap.podium[i]} grid={grid} place={i + 1} />)}
      </ol>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-4 mt-6 pt-5 border-t border-graphite/50">
        <Stat label="Pole position" sub={recap.pole?.Constructor.name}>{recap.pole?.Driver.familyName || '—'}</Stat>
        <Stat label="Fastest lap" sub={recap.fastest && `${recap.fastest.Driver.familyName}, lap ${recap.fastest.FastestLap.lap}`}>
          <span className="tnum text-fastest">{recap.fastest?.FastestLap.Time.time || '—'}</span>
        </Stat>
        <Stat label="Winning margin">{recap.margin ? <span className="tnum">{recap.margin} s</span> : '—'}</Stat>
        <Stat label="Biggest gain" sub={recap.gainer && `P${recap.gainer.r.grid} to P${recap.gainer.r.position}`}>
          {recap.gainer ? <span><span className="text-pb">+{recap.gainer.gain}</span> {recap.gainer.r.Driver.code}</span> : '—'}
        </Stat>
        <Stat label="Finishers"><span className="tnum">{recap.classified} of {recap.starters}</span></Stat>
        <Stat label="Retirements" sub={recap.retirements.slice(0, 3).map(r => r.Driver.code).join(', ') || 'None'}>
          <span className="tnum">{recap.retirements.length}</span>
        </Stat>
      </div>
    </article>
  );
};

// --- Title fight: who can still catch the leader ---

const TitleFight = ({ weekends, season }) => {
  const { data, loading } = useStandings(season);
  const { data: grid } = useGrid();
  if (loading || !data) return <Skeleton className="h-[360px]" />;
  const fight = titleFight(data.drivers, weekends);
  if (!fight) return null;
  const top = data.drivers.slice(0, 5);
  const scale = fight.leader + fight.available || 1;
  const leader = data.drivers[0];

  return (
    <article className="card p-5 sm:p-6 h-full flex flex-col" aria-labelledby="title-fight">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-steel">
            {data.provisional ? <>After {data.provisional.label} <ProvisionalBadge /></> : `Drivers' title, after round ${data.round}`}
          </div>
          <h2 id="title-fight" className="display text-xl sm:text-2xl leading-tight mt-1">Title fight</h2>
        </div>
        <TrendingUp className="w-5 h-5 text-steel shrink-0" />
      </div>

      <div className="grid grid-cols-3 gap-3 mt-5">
        <Stat label="Leader gap"><span className="text-f1">+<AnimatedNumber value={fight.gap} /></span></Stat>
        <Stat label="Points left"><AnimatedNumber value={fight.available} /></Stat>
        <Stat label="Still in it"><AnimatedNumber value={fight.contenders.length} /></Stat>
      </div>
      <p className="text-xs text-steel mt-2">{fight.races} {fight.races === 1 ? 'race' : 'races'} and {fight.sprints} {fight.sprints === 1 ? 'sprint' : 'sprints'} to go. {leader.Driver.familyName} leads on {leader.points}.</p>

      {/* Solid bar: points now. Light extension: the most they can still reach.
          A driver whose extension passes the line can still win the title. */}
      <ul className="mt-5 space-y-3 flex-1">
        {top.map((d, i) => {
          const pts = Number(d.points);
          const colour = colourFor(grid, d.Driver.code, d.Constructors[0]?.constructorId);
          const alive = pts + fight.available >= fight.leader;
          return (
            <li key={d.Driver.driverId} className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-3 text-sm">
              <span className="font-bold">{d.Driver.code}</span>
              <span className="relative h-2.5 rounded-full bg-raised overflow-hidden">
                <motion.span className="absolute inset-y-0 left-0 rounded-full opacity-25" style={{ backgroundColor: colour, width: `${Math.min(100, ((pts + fight.available) / scale) * 100)}%`, transformOrigin: 'left' }}
                  initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.9, ease, delay: 0.1 + i * 0.05 }} />
                <motion.span className="absolute inset-y-0 left-0 rounded-full" style={{ backgroundColor: colour, width: `${(pts / scale) * 100}%`, transformOrigin: 'left' }}
                  initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.8, ease, delay: i * 0.05 }} />
                <span className="absolute inset-y-[-2px] w-0.5 bg-chalk" style={{ left: `${(fight.leader / scale) * 100}%` }} />
              </span>
              <span className={`tnum text-right font-bold ${alive ? '' : 'text-steel'}`}>{pts}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-steel mt-4 flex items-center gap-2">
        <span className="inline-block w-0.5 h-3 bg-chalk" /> leader's points. Faded bar: the most each driver can still reach.
      </p>
    </article>
  );
};

// --- Previous winners at this circuit ---

const PastWinners = ({ race }) => {
  const { data, loading } = useCircuitWinners(race.Circuit.circuitId);
  const { data: grid } = useGrid();
  if (loading) return <Skeleton className="h-[300px]" />;
  if (!data?.length) return null;
  return (
    <article className="card p-5 sm:p-6 h-full">
      <div className="text-xs text-steel">At {race.Circuit.circuitName || race.Circuit.Location?.locality}</div>
      <h2 className="display text-xl leading-tight mt-1 mb-4">Previous winners</h2>
      <ol className="divide-y divide-graphite/50">
        {data.map(w => (
          <li key={w.year} className="flex items-center gap-3 py-2.5">
            <span className="tnum text-sm text-steel w-10">{w.year}</span>
            <span className="w-1 h-6 rounded-full" style={{ backgroundColor: colourFor(grid, w.driver.code, w.constructor.constructorId) }} />
            <span className="min-w-0 flex-1">
              <span className="block font-bold truncate">{w.driver.givenName} {w.driver.familyName}</span>
              <span className="block text-xs text-steel truncate">{w.constructor.name}</span>
            </span>
            {w.time && <span className="tnum text-xs text-steel">{w.time}</span>}
          </li>
        ))}
      </ol>
    </article>
  );
};

// --- The rounds after this one ---

const UpNext = ({ weekends, heroRace, circuitKeys, now, onCalendar }) => {
  const start = weekends.findIndex(w => w.race === heroRace);
  const upcoming = weekends.slice(start + 1, start + 4);
  if (!upcoming.length) return null;
  return (
    <article className="card p-5 sm:p-6 h-full">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-xs text-steel">Coming up</div>
          <h2 className="display text-xl leading-tight mt-1">Next rounds</h2>
        </div>
        <button onClick={onCalendar} className="text-sm text-steel hover:text-chalk flex items-center gap-1">Full calendar <ArrowUpRight className="w-4 h-4" /></button>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {upcoming.map(({ race }) => {
          const date = new Date(`${race.date}T${race.time || '12:00:00Z'}`);
          const days = Math.ceil((date - now) / 864e5);
          return (
            <li key={race.round} className="rounded-card bg-raised/50 border border-graphite/50 p-4 flex sm:flex-col gap-4 items-center sm:items-start">
              <CircuitTrace circuitKey={circuitKeys[race.round]} year={date.getFullYear()} fallbackSrc={circuitImage(race.Circuit.circuitId)}
                label={race.raceName} lazy className="w-14 h-14 sm:w-16 sm:h-16 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs text-steel tnum">Round {race.round}</div>
                <div className="font-bold leading-tight truncate">{race.raceName.replace('Grand Prix', 'GP')}</div>
                <div className="text-xs text-steel tnum mt-1">{date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, in {days} days</div>
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
};

const HomeView = ({ hero, weekends, feed, circuitKeys, now, onWatch, goTo }) => {
  if (!hero) return null;
  const season = hero.race.season;
  return (
    <div className="space-y-5 lg:space-y-6">
      <WeekendHero race={hero.race} weekend={hero.state} feed={feed} circuitKey={circuitKeys[hero.race.round]}
        total={weekends.length} now={now} onWatch={onWatch} onLive={() => goTo('live')} />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6">
        <div className="lg:col-span-7"><LastRace season={season} /></div>
        <div className="lg:col-span-5"><TitleFight weekends={weekends} season={season} /></div>
        <div className="lg:col-span-5"><PastWinners race={hero.race} /></div>
        <div className="lg:col-span-7"><UpNext weekends={weekends} heroRace={hero.race} circuitKeys={circuitKeys} now={now} onCalendar={() => goTo('calendar')} /></div>
      </div>
    </div>
  );
};

export default HomeView;
