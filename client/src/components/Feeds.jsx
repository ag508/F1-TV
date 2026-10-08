import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { Monitor, Play, RefreshCw, X, Zap } from 'lucide-react';
import { ARCHIVE_STREAMS, useFeedHealth } from '../lib/feeds';
import ChannelLogo from './ChannelLogo';
import { streamForChannel } from '../lib/streams';
import { ease, spring } from '../lib/motion';

const HEALTH = {
  ONLINE: { bars: 4, colour: 'bg-pb', text: 'text-pb', label: 'Online' },
  READY: { bars: 4, colour: 'bg-pb', text: 'text-pb', label: 'Ready' },
  DEGRADED: { bars: 2, colour: 'bg-caution', text: 'text-caution', label: 'Degraded' },
  OFFLINE: { bars: 0, colour: 'bg-dim', text: 'text-steel', label: 'Offline' },
  CHECKING: { bars: 0, colour: 'bg-chalk', text: 'text-steel', label: 'Checking' },
  UNKNOWN: { bars: 0, colour: 'bg-dim', text: 'text-steel', label: 'Not checked' },
};

const SignalBars = ({ status }) => {
  const h = HEALTH[status] || HEALTH.UNKNOWN;
  return (
    <span className="flex items-end gap-[3px] h-4" aria-hidden="true">
      {[0, 1, 2, 3].map(i => (
        <span key={i} style={{ height: `${(i + 1) * 25}%`, animationDelay: `${i * 120}ms` }}
          className={`w-[3px] rounded-sm ${status === 'CHECKING' ? 'bg-steel animate-pulse' : i < h.bars ? h.colour : 'bg-graphite'}`} />
      ))}
    </span>
  );
};

export const FeedList = ({ streams, health, isArchive, onPlay }) => (
  <ul className="space-y-2">
    {streams.length === 0 && (
      <li className="p-6 text-center text-sm text-steel">
        No feeds configured. Add channels to <code className="text-chalk">server/channels.json</code> and restart the server.
      </li>
    )}
    {streams.map((s, i) => {
      const h = isArchive ? { status: 'READY' } : (health[s.key] || { status: 'UNKNOWN' });
      const meta = HEALTH[h.status] || HEALTH.UNKNOWN;
      const src = h.source;
      return (
        <motion.li key={s.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease, delay: 0.08 + i * 0.04 }}>
          <motion.button onClick={() => onPlay(s)} whileTap={{ scale: 0.985 }}
            className="group w-full text-left rounded-card border border-graphite/60 bg-raised/50 p-4 transition-colors duration-200 hover:border-f1/60 hover:bg-raised">
            <div className="flex items-center gap-3">
              {/* Logo, with a play button sliding over it on hover */}
              <span className="relative shrink-0">
                <ChannelLogo stream={s} archive={isArchive} />
                <span className="absolute inset-0 grid place-items-center rounded-[12px] bg-f1 text-white opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-focus-visible:opacity-100 transition-[opacity,transform] duration-200">
                  <Play className="w-4 h-4 fill-current" />
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block font-bold truncate ${h.status === 'OFFLINE' ? 'text-steel' : ''}`}>{s.title}</span>
                <span className="block text-xs text-steel truncate">{s.source}, {s.quality}</span>
              </span>
              <span className="flex flex-col items-end gap-1 shrink-0">
                <SignalBars status={h.status} />
                <span className={`text-[11px] font-semibold ${meta.text}`}>{meta.label}</span>
              </span>
            </div>
            {(src?.height || h.latencyMs != null || h.reason || h.account) && (
              <div className="mt-3 pt-3 border-t border-graphite/40 flex flex-wrap gap-x-4 gap-y-1 text-xs text-steel tnum">
                {src?.height && (
                  <span className="flex items-center gap-1.5" title="Resolution the provider is sending right now">
                    <Monitor className="w-3.5 h-3.5" /> {src.width}×{src.height}{src.fps ? ` at ${src.fps} fps` : ''} {src.codec?.toUpperCase()}
                  </span>
                )}
                {h.latencyMs != null && <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> {h.latencyMs} ms</span>}
                {h.account?.maxConnections && <span>{h.account.activeConnections} of {h.account.maxConnections} connections</span>}
                {h.account?.expiry && <span>Expires {h.account.expiry}</span>}
                {h.reason && <span className={`basis-full ${h.status === 'ONLINE' ? '' : 'text-caution/90'}`}>{h.reason}</span>}
              </div>
            )}
            {h.status === 'OFFLINE' && <div className="mt-2 text-xs text-steel">The check failed, but you can still try to play it.</div>}
          </motion.button>
        </motion.li>
      );
    })}
  </ul>
);

const useIsMobile = () => {
  const query = '(max-width: 639px)';
  const [mobile, setMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
};

// Drawer on desktop, bottom sheet (drag down to dismiss) on mobile
export const FeedSheet = ({ isOpen, onClose, race, isArchive, channels, onPlay }) => {
  const mobile = useIsMobile();
  const drag = useDragControls();
  const { health, checking, checkAll } = useFeedHealth(channels, isOpen && !isArchive);
  const closeBtn = useRef(null);
  const streams = isArchive ? ARCHIVE_STREAMS : channels.map(streamForChannel);

  useEffect(() => {
    if (!isOpen) return;
    closeBtn.current?.focus({ preventScroll: true });
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const panel = mobile
    ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }
    : { initial: { x: '100%' }, animate: { x: 0 }, exit: { x: '100%' } };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div key="feeds" exit={{ opacity: 1 }} className="fixed inset-0 z-[60] flex sm:justify-end items-end sm:items-stretch" role="dialog" aria-modal="true" aria-labelledby="feeds-title">
          <motion.div className="absolute inset-0 bg-black/70" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
          <motion.div {...panel} transition={spring}
            drag={mobile ? 'y' : false} dragListener={false} dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_e, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose(); }}
            className="relative w-full sm:max-w-md max-h-[88vh] sm:max-h-none sm:h-full flex flex-col bg-carbon border-t sm:border-t-0 sm:border-l border-graphite rounded-t-[24px] sm:rounded-none shadow-[0_-30px_100px_-30px_rgba(0,0,0,0.9)]">
            {mobile && (
              <div className="pt-3 pb-1 grid place-items-center cursor-grab touch-none" onPointerDown={(e) => drag.start(e)}>
                <span className="w-10 h-1.5 rounded-full bg-graphite" />
              </div>
            )}
            <header className="flex items-start justify-between gap-4 px-5 sm:px-6 pt-3 sm:pt-6 pb-4 border-b border-graphite/60">
              <div className="min-w-0">
                <h2 id="feeds-title" className="display text-2xl">{isArchive ? 'Race archive' : 'Live feeds'}</h2>
                <p className="text-sm text-steel truncate mt-0.5">{race?.raceName}</p>
              </div>
              <button ref={closeBtn} onClick={onClose} aria-label="Close feeds" className="p-2 -mr-2 rounded-full text-steel hover:text-chalk hover:bg-raised transition-colors">
                <X className="w-5 h-5" />
              </button>
            </header>
            {!isArchive && (
              <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-3 border-b border-graphite/40 text-sm">
                <span className="text-steel">{checking ? 'Checking account, signal and resolution…' : 'English commentary, server-side credentials'}</span>
                <button onClick={checkAll} disabled={checking || !channels.length} className="btn-line !py-1 !px-3 text-xs shrink-0 disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> {checking ? 'Checking' : 'Check again'}
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto overscroll-contain p-4 safe-bottom">
              <FeedList streams={streams} health={health} isArchive={isArchive} onPlay={onPlay} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
