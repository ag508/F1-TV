import React from 'react';
import { motion } from 'motion/react';
import { Radio, RefreshCw } from 'lucide-react';
import LiveTelemetry from '../components/LiveTelemetry';
import StartLights from '../components/StartLights';
import { Countdown } from '../components/Weekend';
import { FeedList } from '../components/Feeds';
import { useFeedHealth } from '../lib/feeds';
import { streamForChannel } from '../lib/streams';
import { ease } from '../lib/motion';

const Feeds = ({ channels, onPlay }) => {
  // Feeds are only checked on request here: opening the tab shouldn't
  // spend provider connections.
  const { health, checking, checkAll } = useFeedHealth(channels, false);
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="live-feeds">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 id="live-feeds" className="display text-xl leading-none">Feeds</h2>
        <button onClick={checkAll} disabled={checking || !channels.length} className="btn-line !py-1 !px-3 text-xs disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> {checking ? 'Checking' : 'Check feeds'}
        </button>
      </div>
      <FeedList streams={channels.map(streamForChannel)} health={health} onPlay={onPlay} />
    </section>
  );
};

const LiveView = ({ hero, liveSession, channels, onPlay }) => {
  const next = hero?.state.next;
  return (
    <div className="space-y-5 lg:space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl sm:text-4xl leading-none">Live centre</h1>
          <p className="text-steel text-sm mt-2">{hero?.race.raceName}</p>
        </div>
        {liveSession && (
          <span className="slant flex items-center gap-2 bg-f1 text-white px-5 py-1.5 text-sm font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> {liveSession.name} {liveSession.replay ? 'replay' : 'live'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 lg:gap-6 items-start">
        {liveSession ? (
          <section className="card overflow-hidden" aria-label="Live timing">
            <LiveTelemetry />
          </section>
        ) : (
          <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}
            className="card relative overflow-hidden p-6 sm:p-10 min-h-[340px] flex flex-col justify-center">
            <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(40rem_20rem_at_100%_0%,rgb(225_6_0/0.12),transparent_70%)]" />
            <div className="relative">
              <StartLights play={false} />
              <h2 className="display text-2xl sm:text-3xl mt-6">No session running</h2>
              <p className="text-steel mt-2 max-w-md">
                Live timing, the track map and the leaderboard open here on their own when F1 starts the next session.
              </p>
              {next && (
                <div className="mt-8">
                  <div className="text-sm text-steel mb-2 flex items-center gap-2"><Radio className="w-4 h-4" /> {next.name} starts in</div>
                  <Countdown key={next.start.toISOString()} date={next.start.toISOString()} />
                </div>
              )}
            </div>
          </motion.section>
        )}
        <Feeds channels={channels} onPlay={onPlay} />
      </div>
    </div>
  );
};

export default LiveView;
