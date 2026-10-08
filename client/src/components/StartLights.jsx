import React, { useEffect, useRef } from 'react';
import { useAnimate, useReducedMotion } from 'motion/react';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// The F1 start gantry: five pods of red lamps. `loop` cycles the start
// sequence (loading states); otherwise it runs once - five lights on, lights
// out - and calls onDone, which the hero uses to launch the race name.
const StartLights = ({ loop = false, play = true, size = 'md', onDone, className = '' }) => {
  const [scope, animate] = useAnimate();
  const reduce = useReducedMotion();
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });

  useEffect(() => {
    if (!play) return;
    if (reduce) { done.current?.(); return; }
    let cancelled = false;
    const run = async () => {
      do {
        for (let i = 0; i < 5 && !cancelled; i++) {
          await animate(`[data-pod="${i}"] .glow`, { opacity: 1 }, { duration: 0.08 });
          await sleep(loop ? 230 : 170);
        }
        await sleep(loop ? 420 : 300);
        if (cancelled) return;
        await animate('.glow', { opacity: 0 }, { duration: 0.05 });
        if (!loop) { done.current?.(); return; }
        await sleep(350);
      } while (!cancelled);
    };
    run().catch(() => { });
    return () => { cancelled = true; };
  }, [animate, loop, play, reduce]);

  const dims = size === 'sm'
    ? { lamp: 'w-2 h-2', pod: 'gap-[3px] p-[3px] rounded-[4px]', row: 'gap-[3px]' }
    : { lamp: 'w-3.5 h-3.5', pod: 'gap-1 p-1 rounded-[7px]', row: 'gap-1.5' };

  return (
    <div ref={scope} className={`flex ${dims.row} ${className}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} data-pod={i} className={`flex flex-col bg-black border border-graphite/80 ${dims.pod}`}>
          {[0, 1].map(j => (
            <span key={j} className={`relative block rounded-full bg-[#2b0d0c] ${dims.lamp}`}>
              <span className="glow absolute inset-0 rounded-full bg-f1 opacity-0 shadow-[0_0_8px_2px_rgb(225_6_0/0.8),0_0_22px_5px_rgb(225_6_0/0.35)]" />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};

export default StartLights;
