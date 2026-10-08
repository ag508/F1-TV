import React, { useState } from 'react';
import { Film, Tv } from 'lucide-react';
import skySportsF1 from '../assets/logos/sky-sports-f1.svg';
import appleTv from '../assets/logos/apple-tv.svg';

// Broadcaster logo for a feed. A channel's own `logo` (from channels.json)
// wins; otherwise the brand is recognised from its title. Logos are public
// domain files from Wikimedia Commons; F1 TV has no free logo, so it gets a
// plain text mark.
const brandOf = (title = '') => {
  const t = title.toLowerCase();
  if (/sky\s*sports?/.test(t)) return { src: skySportsF1, name: 'Sky Sports F1', light: true }; // blue wordmark needs a light plate
  if (/apple/.test(t)) return { src: appleTv, name: 'Apple TV', white: true };
  if (/\bf1\s*tv\b/.test(t)) return { text: true, name: 'F1 TV' };
  return null;
};

const SIZES = {
  md: { box: 'w-[76px] h-11 rounded-[12px]', pad: 'px-2.5 py-2', widePad: 'px-1.5', text: 'text-sm' },
  sm: { box: 'w-12 h-7 rounded-[7px]', pad: 'px-1.5 py-1', widePad: 'px-1', text: 'text-[10px]' },
};

const ChannelLogo = ({ stream, archive = false, size = 'md', className = '' }) => {
  const [failed, setFailed] = useState(false);
  const s = SIZES[size];
  const custom = stream?.logo && !failed ? { src: stream.logo, name: stream.title } : null;
  const brand = custom || brandOf(stream?.title);
  const Fallback = archive ? Film : Tv;

  return (
    <span className={`relative grid place-items-center shrink-0 overflow-hidden border ${brand?.light ? 'bg-white border-white' : 'bg-night border-graphite/70'} ${s.box} ${className}`}
      title={brand?.name}>
      {brand?.src ? (
        <img src={brand.src} alt={brand.name} loading="lazy" onError={() => setFailed(true)}
          className={`max-w-full max-h-full object-contain ${brand.light ? s.widePad : s.pad} ${brand.white ? 'brightness-0 invert' : ''}`} />
      ) : brand?.text ? (
        <span className={`display leading-none ${s.text}`} aria-label={brand.name}><span className="text-f1">F1</span> TV</span>
      ) : (
        <Fallback className="w-4 h-4 text-steel" aria-hidden="true" />
      )}
    </span>
  );
};

export default ChannelLogo;
