import { useEffect, useState } from 'react';

// Re-renders when a media query starts or stops matching
export function useMedia(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const DESKTOP = '(min-width: 1024px)';
// A phone turned sideways: wide but short
export const LANDSCAPE_PHONE = '(orientation: landscape) and (max-height: 540px)';
