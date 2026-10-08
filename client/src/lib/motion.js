// Shared Motion presets. Springs for things the viewer moves (sheets, pills,
// tabs), one easing curve for everything else.
export const ease = [0.22, 1, 0.36, 1];
export const spring = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 };
export const softSpring = { type: 'spring', stiffness: 260, damping: 32 };

// Page transitions: short and transform/opacity only (GPU-composited)
export const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease: 'easeIn' } },
};
