/** @type {import('tailwindcss').Config} */
// F1 brand palette on a dark theme: carbon black surfaces, F1 red as the one
// accent, timing colours (purple / green / yellow) only where they mean timing.
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        night: 'rgb(var(--night) / <alpha-value>)',      // page
        carbon: 'rgb(var(--carbon) / <alpha-value>)',    // panels (F1 #15151E)
        raised: 'rgb(var(--raised) / <alpha-value>)',    // hover / nested
        graphite: 'rgb(var(--graphite) / <alpha-value>)',// lines (F1 #38383F)
        chalk: 'rgb(var(--chalk) / <alpha-value>)',      // text (F1 #F7F4F1)
        steel: 'rgb(var(--steel) / <alpha-value>)',      // secondary text (F1 #949498)
        dim: 'rgb(var(--dim) / <alpha-value>)',
        f1: 'rgb(var(--f1) / <alpha-value>)',            // F1 red #E10600
        fastest: 'rgb(var(--fastest) / <alpha-value>)',
        pb: 'rgb(var(--pb) / <alpha-value>)',
        caution: 'rgb(var(--caution) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-body)'],
        display: ['var(--font-display)'],
      },
      borderRadius: {
        chip: '6px',
        card: '16px',
        stage: '24px',
      },
      transitionTimingFunction: {
        pit: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}
