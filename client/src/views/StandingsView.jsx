import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import PointsChart from '../components/PointsChart';
import { AnimatedNumber, Avatar, ProvisionalBadge, Segmented, Skeleton } from '../components/ui';
import { colourFor, useGrid, useSeasonResults, useStandings } from '../lib/data';
import { ease, pageVariants } from '../lib/motion';

const CLASSIFIED = /^(Finished|Lapped|\+\d+ Laps?)$/;

// Per-driver season facts from the race results: podiums and recent form
function useDriverFacts(rounds) {
  return useMemo(() => {
    const facts = {};
    for (const round of rounds || []) {
      for (const r of round.Results) {
        const f = (facts[r.Driver.driverId] ||= { podiums: 0, poles: 0, form: [] });
        if (Number(r.position) <= 3) f.podiums++;
        if (r.grid === '1') f.poles++;
        f.form.push({ round: round.round, pos: CLASSIFIED.test(r.status) ? Number(r.position) : null, status: r.status });
      }
    }
    return facts;
  }, [rounds]);
}

const FormChip = ({ f }) => (
  <span title={`Round ${f.round}: ${f.pos ? `P${f.pos}` : f.status}`}
    className={`tnum grid place-items-center w-6 h-6 rounded-[6px] text-[10px] font-bold ${
      !f.pos ? 'bg-graphite/40 text-steel'
        : f.pos === 1 ? 'bg-chalk text-night'
          : f.pos <= 3 ? 'bg-chalk/25 text-chalk'
            : f.pos <= 10 ? 'bg-raised text-chalk border border-graphite/70'
              : 'bg-transparent text-steel border border-graphite/50'}`}>
    {f.pos ?? 'R'}
  </span>
);

const DriversTable = ({ list, grid, facts, leader }) => (
  <div className="card overflow-hidden">
    <div className="hidden md:grid grid-cols-[3rem_minmax(0,1.6fr)_minmax(0,1fr)_3rem_4rem_9.5rem_5rem] items-center gap-x-4 px-5 h-11 border-b border-graphite/60 text-xs text-steel font-semibold">
      <span>Pos</span><span>Driver</span><span>Team</span><span className="text-right">Wins</span><span className="text-right">Podiums</span><span>Last 5</span><span className="text-right">Points</span>
    </div>
    <ol>
      {list.map((row, i) => {
        const code = row.Driver.code;
        const team = row.Constructors[0];
        const colour = colourFor(grid, code, team?.constructorId);
        const f = facts[row.Driver.driverId];
        const gap = leader - Number(row.points);
        return (
          <motion.li key={row.Driver.driverId}
            initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.35, ease, delay: Math.min(i, 10) * 0.025 }}
            className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] md:grid-cols-[3rem_minmax(0,1.6fr)_minmax(0,1fr)_3rem_4rem_9.5rem_5rem] items-center gap-x-3 md:gap-x-4 px-4 md:px-5 py-2.5 border-b border-graphite/40 last:border-0 hover:bg-raised/50 transition-colors">
            <span className={`display text-lg ${i < 3 ? '' : 'text-steel'}`}>{row.position || row.positionText}</span>
            <span className="flex items-center gap-3 min-w-0">
              <Avatar src={grid?.[code]?.headshot} colour={colour} code={code} size={40} />
              <span className="min-w-0 leading-tight">
                <span className="block text-xs text-steel truncate">{row.Driver.givenName}</span>
                <span className="block font-bold truncate">{row.Driver.familyName}</span>
                <span className="md:hidden block text-xs text-steel truncate">{team?.name}</span>
              </span>
            </span>
            <span className="hidden md:flex items-center gap-2 min-w-0 text-sm text-steel">
              <span className="w-1 h-4 rounded-full shrink-0" style={{ backgroundColor: colour }} /><span className="truncate">{team?.name}</span>
            </span>
            <span className="hidden md:block tnum text-right">{row.wins}</span>
            <span className="hidden md:block tnum text-right">{f?.podiums ?? '—'}</span>
            <span className="hidden md:flex gap-1">{f?.form.slice(-5).map(x => <FormChip key={x.round} f={x} />)}</span>
            <span className="text-right">
              <span className="block display text-lg leading-none tnum">{row.points}</span>
              <span className="block text-[11px] text-steel tnum mt-0.5">{gap ? `-${gap}` : 'Leader'}</span>
            </span>
          </motion.li>
        );
      })}
    </ol>
  </div>
);

const ConstructorsTable = ({ list, grid, standings }) => {
  const max = Number(list[0]?.points) || 1;
  return (
    <div className="card overflow-hidden">
      <ol>
        {list.map((row, i) => {
          const id = row.Constructor.constructorId;
          const pair = standings.filter(s => s.Constructors[0]?.constructorId === id)
            .map(s => ({ id: s.Driver.driverId, code: s.Driver.code, name: `${s.Driver.givenName} ${s.Driver.familyName}`, points: Number(s.points) }))
            .sort((a, b) => b.points - a.points);
          const someDriver = standings.find(s => s.Constructors[0]?.constructorId === id);
          const colour = colourFor(grid, someDriver?.Driver.code, id);
          return (
            <li key={id} className="grid grid-cols-[2.25rem_minmax(0,1fr)_4.5rem] sm:grid-cols-[3rem_minmax(0,14rem)_minmax(0,1fr)_5rem] items-center gap-x-3 sm:gap-x-5 px-4 sm:px-5 py-4 border-b border-graphite/40 last:border-0">
              <span className={`display text-lg ${i < 3 ? '' : 'text-steel'}`}>{row.position}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-2"><span className="w-1 h-5 rounded-full" style={{ backgroundColor: colour }} /><span className="font-bold truncate">{row.Constructor.name}</span></span>
                <span className="block text-xs text-steel mt-0.5 tnum">{row.wins} {row.wins === '1' ? 'win' : 'wins'}</span>
              </span>
              {/* Each driver's share of the team's points */}
              <span className="col-span-3 sm:col-span-1 row-start-2 sm:row-start-auto mt-3 sm:mt-0">
                <span className="flex h-2.5 rounded-full bg-raised overflow-hidden" style={{ width: `${(Number(row.points) / max) * 100}%` }}>
                  {pair.map((d, j) => (
                    <motion.span key={d.id} className="h-full first:rounded-l-full last:rounded-r-full" title={`${d.name}: ${d.points}`}
                      style={{ width: `${(d.points / Math.max(1, Number(row.points))) * 100}%`, backgroundColor: colour, opacity: j ? 0.5 : 1, marginLeft: j ? 2 : 0, transformOrigin: 'left' }}
                      initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.8, ease, delay: i * 0.04 }} />
                  ))}
                </span>
                <span className="flex gap-4 mt-1.5 text-[11px] text-steel tnum">
                  {pair.map((d, j) => <span key={d.id} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: colour, opacity: j ? 0.5 : 1 }} />{d.code} {d.points}</span>)}
                </span>
              </span>
              <span className="display text-xl text-right tnum row-start-1 col-start-3 sm:col-start-auto"><AnimatedNumber value={row.points} /></span>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

const StandingsView = ({ season }) => {
  const [tab, setTab] = useState('drivers');
  const [chartCount, setChartCount] = useState(5);
  const standings = useStandings(season);
  const results = useSeasonResults(season);
  const merged = standings.data;
  const provisional = merged?.provisional;
  const { data: grid } = useGrid();
  const facts = useDriverFacts(results.data?.rounds);

  const series = useMemo(() => {
    const list = merged?.drivers || [];
    const all = results.data?.drivers || [];
    const seenTeams = new Set();
    return list.slice(0, chartCount).map(row => {
      const d = all.find(x => x.id === row.Driver.driverId);
      if (!d) return null;
      const dashed = seenTeams.has(d.constructorId);
      seenTeams.add(d.constructorId);
      // A provisional session (in OpenF1, not yet in Jolpica) adds one column at the end
      const values = provisional ? [...d.cumulative, Number(row.points)] : d.cumulative;
      return { id: d.id, code: d.code, values, dashed, colour: colourFor(grid, d.code, d.constructorId) };
    }).filter(Boolean);
  }, [merged, provisional, results.data, grid, chartCount]);

  const chartRounds = useMemo(() => {
    const list = (results.data?.rounds || []).map(r => ({ axis: `R${r.round}`, title: `round ${r.round}, ${r.raceName}` }));
    if (provisional) list.push({ axis: provisional.session.name === 'Sprint' ? 'Sprint' : 'Latest', title: `${provisional.label} (provisional)`, provisional: true });
    return list;
  }, [results.data, provisional]);

  const round = merged?.round;
  return (
    <div className="space-y-5 lg:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl sm:text-4xl leading-none">Standings</h1>
          {round && (
            <p className="flex flex-wrap items-center gap-2 text-steel text-sm mt-2">
              {season} season, after {provisional ? provisional.label : `round ${round}`}
              {provisional && <ProvisionalBadge />}
            </p>
          )}
        </div>
        <Segmented id="standings" value={tab} onChange={setTab}
          options={[{ value: 'drivers', label: 'Drivers' }, { value: 'constructors', label: 'Constructors' }]} />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {tab === 'drivers' ? (
          <motion.div key="drivers" variants={pageVariants} initial="initial" animate="animate" exit="exit" className="space-y-5 lg:space-y-6">
            <section className="card p-4 sm:p-6" aria-labelledby="progress-title">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <h2 id="progress-title" className="display text-xl leading-none">Points progression</h2>
                  <p className="text-xs text-steel mt-1.5">Dashed line: a team's second driver</p>
                </div>
                <Segmented id="chart-count" size="sm" value={chartCount} onChange={setChartCount}
                  options={[{ value: 3, label: 'Top 3' }, { value: 5, label: 'Top 5' }, { value: 8, label: 'Top 8' }]} />
              </div>
              {series.length && results.data ? (
                <>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs" aria-label="Legend">
                    {series.map(s => (
                      <li key={s.id} className="flex items-center gap-1.5">
                        <svg width="18" height="6" aria-hidden="true"><line x1="0" x2="18" y1="3" y2="3" stroke={s.colour} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} /></svg>
                        {s.code}
                      </li>
                    ))}
                  </ul>
                  <div className="overflow-hidden"><PointsChart series={series} rounds={chartRounds} /></div>
                </>
              ) : <Skeleton className="h-[300px]" />}
            </section>
            {merged ? <DriversTable list={merged.drivers} grid={grid} facts={facts} leader={Number(merged.drivers[0]?.points)} />
              : <Skeleton className="h-[600px]" />}
          </motion.div>
        ) : (
          <motion.div key="constructors" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            {merged?.constructors.length
              ? <ConstructorsTable list={merged.constructors} grid={grid} standings={merged.drivers} />
              : <Skeleton className="h-[600px]" />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default StandingsView;
