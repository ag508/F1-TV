import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from 'motion/react';
import { spring } from '../lib/motion';

// Segmented control with a sliding pill (shared layoutId per control)
export const Segmented = ({ id, options, value, onChange, size = 'md', className = '' }) => (
  <div role="tablist" className={`inline-flex p-1 rounded-full bg-raised border border-graphite/60 ${className}`}>
    {options.map(o => {
      const active = o.value === value;
      return (
        <button key={o.value} role="tab" aria-selected={active} onClick={() => onChange(o.value)}
          className={`relative rounded-full font-semibold transition-colors duration-200 ${size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm'} ${active ? 'text-white' : 'text-steel hover:text-chalk'}`}>
          {active && <motion.span layoutId={`${id}-pill`} transition={spring} className="absolute inset-0 rounded-full bg-f1" />}
          <span className="relative">{o.label}</span>
        </button>
      );
    })}
  </div>
);

// Counts up to its value the first time it scrolls into view, then tweens
// between values. Writes the text directly, so it never re-renders React.
export const AnimatedNumber = ({ value, decimals = 0, className = '' }) => {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const shown = useRef(0);
  useEffect(() => {
    const el = ref.current;
    const target = Number(value) || 0;
    if (!el || !inView) return;
    if (reduce) { el.textContent = target.toFixed(decimals); shown.current = target; return; }
    const controls = animate(shown.current, target, {
      duration: 1.1, ease: [0.22, 1, 0.36, 1],
      onUpdate: v => { el.textContent = v.toFixed(decimals); shown.current = v; },
    });
    return () => controls.stop();
  }, [value, decimals, inView, reduce]);
  return <span ref={ref} className={`tnum ${className}`}>{(0).toFixed(decimals)}</span>;
};

// A digit that rolls when it changes (countdowns)
export const RollingDigit = ({ value }) => (
  <span className="relative inline-flex h-[1em] w-[0.64em] justify-center overflow-hidden">
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={value} className="block leading-none"
        initial={{ y: '-100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
        {value}
      </motion.span>
    </AnimatePresence>
  </span>
);

// Driver headshot on a team-colour disc; initials when there's no photo
export const Avatar = ({ src, colour = '#62626A', code, size = 40, className = '' }) => {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`relative inline-grid place-items-center shrink-0 overflow-hidden rounded-full ${className}`}
      style={{ width: size, height: size, background: `radial-gradient(circle at 50% 30%, ${colour}, ${colour}55 70%)` }}>
      {src && !failed
        ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-x-0 top-0 w-full h-auto" />
        : <span className="text-[11px] font-bold text-white/90">{code}</span>}
    </span>
  );
};

export const Stat = ({ label, children, sub, className = '' }) => (
  <div className={`min-w-0 ${className}`}>
    <div className="text-xs text-steel">{label}</div>
    <div className="mt-1 font-bold text-lg leading-tight truncate">{children}</div>
    {sub && <div className="text-xs text-steel mt-0.5 truncate">{sub}</div>}
  </div>
);

export const SectionHeading = ({ title, aside, id }) => (
  <div className="flex items-end justify-between gap-4 mb-4">
    <h2 id={id} className="display text-xl sm:text-2xl leading-none">{title}</h2>
    {aside && <div className="text-sm text-steel shrink-0">{aside}</div>}
  </div>
);

export const Skeleton = ({ className = '' }) => <div className={`rounded-card bg-raised/60 animate-pulse ${className}`} />;

// Marks numbers that come from OpenF1 before the official record has them
export const ProvisionalBadge = ({ title = 'From OpenF1 live results; the official record (Jolpica) has not published this session yet' }) => (
  <span title={title} className="px-2 py-0.5 rounded-chip bg-caution/15 text-caution text-[11px] font-bold">Provisional</span>
);
