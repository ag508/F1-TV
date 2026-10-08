// Registers the official Formula1 Display fonts when their files are present
// in src/assets/fonts (see the README there). Vite resolves the glob at build
// time, so with no files there's nothing to fetch and no 404s; Saira is used.
const files = import.meta.glob('../assets/fonts/*.{woff2,woff,ttf,otf}', { eager: true, query: '?url', import: 'default' });

export function loadF1Fonts() {
  if (typeof FontFace === 'undefined') return;
  for (const [path, url] of Object.entries(files)) {
    const name = path.split('/').pop();
    const family = /wide/i.test(name) ? 'F1 Wide' : 'F1 Regular';
    const weight = /black/i.test(name) ? '900' : /bold/i.test(name) ? '700' : family === 'F1 Wide' ? '700' : '400';
    const style = /italic/i.test(name) ? 'italic' : 'normal';
    const face = new FontFace(family, `url(${url})`, { weight, style, display: 'swap' });
    face.load().then(f => document.fonts.add(f)).catch(err => console.warn('[Fonts] Could not load', name, err));
  }
}
