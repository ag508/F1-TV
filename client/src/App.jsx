import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { CalendarDays, Home, Play, Radio, Trophy } from 'lucide-react';
import { weekendState } from './lib/schedule';
import { circuitKeyFor } from './lib/circuits';
import { useChannels, useLiveStatus, useNow, useSeason } from './lib/data';
import { pageVariants, spring } from './lib/motion';
import StartLights from './components/StartLights';
import { FeedSheet } from './components/Feeds';
import { PlayerModal } from './components/Player';
import HomeView from './views/HomeView';
import LiveView from './views/LiveView';
import StandingsView from './views/StandingsView';
import CalendarView from './views/CalendarView';

const SEASON = 2026;
const TABS = [
  { id: 'home', label: 'Weekend', icon: Home },
  { id: 'live', label: 'Live', icon: Radio },
  { id: 'standings', label: 'Standings', icon: Trophy },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
];

// The open tab lives in the URL hash, so links and the back button work
function useHashTab() {
  const read = () => {
    const id = window.location.hash.slice(1);
    return TABS.some(t => t.id === id) ? id : 'home';
  };
  const [tab, setTab] = useState(read);
  useEffect(() => {
    const onHash = () => { setTab(read()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((id) => { window.location.hash = id === 'home' ? '' : id; if (id === 'home') setTab('home'); }, []);
  return [tab, go];
}

const Wordmark = () => (
  <a href="#" className="flex items-center gap-2.5 shrink-0" aria-label="F1 StreamHub, weekend">
    <span aria-hidden="true" className="flex gap-[3px] -skew-x-[20deg]">
      <span className="w-[7px] h-5 bg-f1 rounded-[1px]" />
      <span className="w-[7px] h-5 bg-f1/60 rounded-[1px]" />
    </span>
    <span className="display text-lg leading-none">StreamHub</span>
  </a>
);

const LiveChip = ({ liveName, feed }) => liveName ? (
  <span className="slant flex items-center gap-2 bg-f1 text-white px-4 py-1.5 text-xs font-bold">
    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> {liveName} live
  </span>
) : (
  <span className="flex items-center gap-2 rounded-full border border-graphite/70 px-3 py-1.5 text-xs text-steel" title="Connection to F1 live timing through the StreamHub server">
    <span className={`w-1.5 h-1.5 rounded-full ${feed ? 'bg-pb' : 'bg-dim'}`} />
    <span className="hidden lg:inline">{feed ? 'Live timing connected' : 'Live timing offline'}</span>
  </span>
);

const TopBar = ({ tab, go, liveName, feed, onWatch }) => {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className={`fixed top-0 inset-x-0 z-50 border-b transition-colors duration-300 ${scrolled ? 'bg-night/95 border-graphite/60' : 'bg-transparent border-transparent'}`}>
      <div className="h-14 sm:h-16 max-w-[1400px] mx-auto px-4 sm:px-6 flex items-center gap-6">
        <Wordmark />
        <nav className="hidden sm:flex items-center gap-1 h-full" aria-label="Sections">
          {TABS.map(t => (
            <button key={t.id} onClick={() => go(t.id)} aria-current={tab === t.id ? 'page' : undefined}
              className={`relative h-full px-3 text-sm font-semibold transition-colors ${tab === t.id ? 'text-chalk' : 'text-steel hover:text-chalk'}`}>
              {t.label}
              {t.id === 'live' && liveName && <span className="absolute top-4 right-0.5 w-1.5 h-1.5 rounded-full bg-f1" />}
              {tab === t.id && <motion.span layoutId="tab-underline" transition={spring} className="absolute left-3 right-3 bottom-0 h-[3px] rounded-t-full bg-f1" />}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LiveChip liveName={liveName} feed={feed} />
          <button onClick={onWatch} className="btn-f1 !px-5 !py-2 text-sm" aria-label="Watch">
            <Play className="w-3.5 h-3.5 fill-current" /> <span className="hidden sm:inline">Watch</span>
          </button>
        </div>
      </div>
    </header>
  );
};

const BottomNav = ({ tab, go, liveName }) => (
  <nav className="sm:hidden fixed bottom-0 inset-x-0 z-50 bg-carbon border-t border-graphite/70 safe-bottom" aria-label="Sections">
    <div className="grid grid-cols-4 pt-1.5">
      {TABS.map(t => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button key={t.id} onClick={() => go(t.id)} aria-current={active ? 'page' : undefined}
            className={`relative flex flex-col items-center gap-1 py-1.5 text-[11px] font-semibold ${active ? 'text-chalk' : 'text-steel'}`}>
            {active && <motion.span layoutId="bottom-pill" transition={spring} className="absolute top-0.5 w-12 h-8 rounded-full bg-f1/20" />}
            <span className="relative">
              <Icon className={`w-5 h-5 ${active ? 'text-f1' : ''}`} />
              {t.id === 'live' && liveName && <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-f1 ring-2 ring-carbon" />}
            </span>
            <span className="relative">{t.label}</span>
          </button>
        );
      })}
    </div>
  </nav>
);

// Chequered flag band, the season as a row of rounds, and a giant outlined
// wordmark running off the bottom edge. Purely graphic: no small print.
const CHEQUER = {
  backgroundImage: 'conic-gradient(rgb(247 244 241) 25%, rgb(11 11 16) 0 50%, rgb(247 244 241) 0 75%, rgb(11 11 16) 0)',
  backgroundSize: '22px 22px',
  maskImage: 'linear-gradient(90deg, transparent, black 25%, black 75%, transparent)',
  WebkitMaskImage: 'linear-gradient(90deg, transparent, black 25%, black 75%, transparent)',
};

const Footer = ({ go, weekends, heroRace }) => {
  const done = weekends.filter(w => w.state.finished).length;
  return (
    <footer className="relative mt-24 overflow-hidden bg-carbon border-t border-graphite/60 pb-16 sm:pb-0">
      <div aria-hidden="true" className="h-[22px] opacity-90" style={CHEQUER} />
      <div aria-hidden="true" className="absolute -top-10 right-0 w-[40rem] h-[24rem] bg-[radial-gradient(closest-side,rgb(225_6_0/0.18),transparent)]" />

      <div className="relative max-w-[1400px] mx-auto px-4 sm:px-6 pt-10 flex flex-col-reverse sm:flex-row sm:items-end justify-between gap-8">
        {/* The season, one slanted bar per round */}
        <ol className="flex flex-wrap gap-[5px] max-w-xl" aria-label={`${done} of ${weekends.length} rounds raced`}>
          {weekends.map(({ race, state }, i) => (
            <motion.li key={race.round} title={`Round ${race.round}: ${race.raceName}`}
              initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.025, ease: [0.22, 1, 0.36, 1] }}
              className={`w-2.5 h-7 rounded-[2px] -skew-x-[20deg] ${state.finished ? 'bg-chalk/80' : race === heroRace ? 'bg-f1 shadow-[0_0_14px_rgb(225_6_0/0.7)]' : 'bg-graphite'}`} />
          ))}
        </ol>
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
          {TABS.map(t => (
            <button key={t.id} onClick={() => { go(t.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              className="display text-sm text-steel hover:text-chalk transition-colors">{t.label}</button>
          ))}
        </nav>
      </div>

      <motion.div aria-hidden="true" className="relative max-w-[1400px] mx-auto px-4 sm:px-6 mt-8 flex items-end gap-[0.06em] select-none leading-[0.78] h-[clamp(2.5rem,11.6vw,12.4rem)] overflow-hidden"
        initial={{ y: 40, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}>
        <span className="flex gap-[0.05em] -skew-x-[20deg] self-stretch pt-[0.12em] text-[clamp(3rem,14vw,15rem)]">
          <span className="w-[0.12em] bg-f1" /><span className="w-[0.12em] bg-f1/60" />
        </span>
        <span className="display text-[clamp(3rem,14vw,15rem)] text-transparent [-webkit-text-stroke:1.5px_rgb(98_98_106)] whitespace-nowrap">StreamHub</span>
      </motion.div>
    </footer>
  );
};

const App = () => {
  const [tab, go] = useHashTab();
  const { races, officialSessions } = useSeason(SEASON);
  const feed = useLiveStatus();
  const channels = useChannels();
  const now = useNow(5000);
  const [activeStream, setActiveStream] = useState(null);
  const [sheetRace, setSheetRace] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const scrollY = useRef(0);

  const weekends = useMemo(
    () => (races || []).map(race => ({ race, state: weekendState(race, officialSessions, now, feed) })),
    [races, officialSessions, now, feed]
  );

  // Hero = the first weekend that isn't fully finished. A race whose start
  // time has passed stays here (LIVE) until the feed says it has ended.
  const hero = useMemo(() => weekends.find(w => !w.state.finished) || weekends.at(-1), [weekends]);

  // OpenF1 circuit key per round, so outlines can be drawn from real data
  const circuitKeys = useMemo(
    () => Object.fromEntries((races || []).map(r => [r.round, circuitKeyFor(r, officialSessions)])),
    [races, officialSessions]
  );

  // Session shown next to the video (a live session, or a server-side replay)
  const liveName = hero?.state.live?.name;
  const replayName = feed?.source === 'replay' ? feed.session?.name : null;
  const liveSession = useMemo(
    () => (liveName ? { name: liveName } : replayName ? { name: replayName, replay: true } : null),
    [liveName, replayName]
  );

  const openFeeds = useCallback((race) => { setSheetRace(race || hero?.race); setSheetOpen(true); }, [hero]);
  const closeFeeds = useCallback(() => setSheetOpen(false), []);
  const play = useCallback((stream) => {
    scrollY.current = window.scrollY;
    setSheetOpen(false);
    setActiveStream(stream);
  }, []);
  const closePlayer = useCallback(() => setActiveStream(null), []);

  // The page underneath is unmounted while the player is open, so the video
  // gets the whole main thread; scroll position comes back afterwards.
  useEffect(() => {
    if (activeStream) return;
    const y = scrollY.current;
    if (y) requestAnimationFrame(() => window.scrollTo({ top: y }));
  }, [activeStream]);

  const playHighlights = useCallback((race) => {
    const query = `F1 ${race.season} ${race.raceName} Highlights`;
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, '_blank', 'noopener');
  }, []);

  const sheetWeekend = weekends.find(w => w.race === sheetRace);

  if (races === null) return (
    <>
      <div className="backdrop" />
      <div className="min-h-screen grid place-items-center" role="status">
        <div className="flex flex-col items-center gap-6">
          <StartLights loop />
          <div className="text-steel text-sm">Loading the {SEASON} season</div>
        </div>
      </div>
    </>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="backdrop" />
      {!activeStream && (
        <>
          <TopBar tab={tab} go={go} liveName={hero?.state.live?.short} feed={feed} onWatch={() => openFeeds()} />
          <main className="pt-20 sm:pt-24 px-4 sm:px-6 max-w-[1400px] mx-auto">
            {!races.length ? (
              <section className="card p-10 text-center">
                <h1 className="display text-3xl">The calendar didn't load</h1>
                <p className="text-steel mt-3">Jolpica and the Sportstimes fallback are both unreachable. Check your connection, then reload the page.</p>
                <button onClick={() => window.location.reload()} className="btn-f1 mt-6">Reload</button>
              </section>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={tab} variants={pageVariants} initial="initial" animate="animate" exit="exit">
                  {tab === 'home' && <HomeView hero={hero} weekends={weekends} feed={feed} circuitKeys={circuitKeys} now={now} onWatch={openFeeds} goTo={go} />}
                  {tab === 'live' && <LiveView hero={hero} liveSession={liveSession} channels={channels} onPlay={play} />}
                  {tab === 'standings' && <StandingsView season={hero?.race.season || String(SEASON)} />}
                  {tab === 'calendar' && <CalendarView weekends={weekends} heroRace={hero?.race} circuitKeys={circuitKeys} now={now} onWatch={openFeeds} onHighlights={playHighlights} />}
                </motion.div>
              </AnimatePresence>
            )}
          </main>
          <Footer go={go} weekends={weekends} heroRace={hero?.race} />
          <BottomNav tab={tab} go={go} liveName={hero?.state.live?.short} />
        </>
      )}

      <FeedSheet isOpen={sheetOpen} onClose={closeFeeds} race={sheetRace} isArchive={sheetWeekend?.state.finished}
        channels={channels} onPlay={play} />

      <AnimatePresence>
        {activeStream && (
          <PlayerModal key="player" stream={activeStream} channels={channels} liveSession={liveSession}
            onSwitch={setActiveStream} onClose={closePlayer} />
        )}
      </AnimatePresence>
    </MotionConfig>
  );
};

export default App;
