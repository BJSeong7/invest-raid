// Builds dist/index.html (CDN libraries, for publishing) and dist/local.html (node_modules libraries, for headless tests).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const stripImports = src => src.replace(/^import[^\n]*\n/gm, '');
const inline = ['src/engine.js', 'src/audio.js', 'src/game.js'].map(p => `/* ===== ${p} ===== */\n` + stripImports(read(p))).join('\n');
const tapes = readdirSync(new URL('../data/tapes/', import.meta.url)).filter(f => f.endsWith('.json') && f !== 'index.json')
  .map(f => JSON.parse(read('data/tapes/' + f))).sort((a, b) => a.bars[0].t.localeCompare(b.bars[0].t));

const LIBS = {
  cdn: [
    'https://cdnjs.cloudflare.com/ajax/libs/phaser/3.80.1/phaser.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js',
    'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js',
  ],
  local: [
    'vendor/phaser.min.js', 'vendor/gsap.min.js', 'vendor/lightweight-charts.standalone.production.js',
  ],
};
mkdirSync(new URL('../dist/vendor/', import.meta.url), { recursive: true });
copyFileSync(new URL('../node_modules/phaser/dist/phaser.min.js', import.meta.url), new URL('../dist/vendor/phaser.min.js', import.meta.url));
copyFileSync(new URL('../node_modules/gsap/dist/gsap.min.js', import.meta.url), new URL('../dist/vendor/gsap.min.js', import.meta.url));
copyFileSync(new URL('../node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js', import.meta.url), new URL('../dist/vendor/lightweight-charts.standalone.production.js', import.meta.url));
mkdirSync(new URL('../dist/vendor/fonts/', import.meta.url), { recursive: true });
for (const [src, dst] of [['@fontsource/jua/files/jua-korean-400-normal.woff2', 'jua.woff2'], ['@fontsource/black-han-sans/files/black-han-sans-korean-400-normal.woff2', 'bhs.woff2'], ['@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff2', 'nskr-400.woff2'], ['@fontsource/noto-sans-kr/files/noto-sans-kr-korean-500-normal.woff2', 'nskr-500.woff2'], ['@fontsource/noto-sans-kr/files/noto-sans-kr-korean-700-normal.woff2', 'nskr-700.woff2']]) {
  try { copyFileSync(new URL('../node_modules/' + src, import.meta.url), new URL('../dist/vendor/fonts/' + dst, import.meta.url)); } catch (e) { console.warn('font missing', src); }
}

const tpl = read('src/template.html');
for (const [variant, libs] of Object.entries(LIBS)) {
  // function replacements: a plain string replacement would interpret `$$` / `$&` inside the game source
  let html = tpl
    .replace('<!--LIBS-->', () => libs.map(u => `<script src="${u}"></script>`).join('\n'))
    .replace('<!--TAPES-->', () => `<script>window.__TAPES__ = ${JSON.stringify(tapes)};</script>`)
    .replace('<!--GAME-->', () => `<script type="module">\n${inline}\n</script>`);
  if (variant === 'local') {
    // headless tests cannot reach Google Fonts: serve the same faces from node_modules (@fontsource)
    const face = (fam, file, w = 400) => `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};src:url(vendor/fonts/${file}) format('woff2')}`;
    const fonts = `<style>${face('Jua', 'jua.woff2')}${face('Black Han Sans', 'bhs.woff2')}${face('Noto Sans KR', 'nskr-400.woff2', 400)}${face('Noto Sans KR', 'nskr-500.woff2', 500)}${face('Noto Sans KR', 'nskr-700.woff2', 700)}</style>`;
    html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${fonts}</head><body>${html.replace(/<link rel="stylesheet" href="https:\/\/fonts.googleapis.com[^>]*>/, '')}</body></html>`;
  }
  writeFileSync(new URL(`../dist/${variant === 'cdn' ? 'index' : 'local'}.html`, import.meta.url), html);
  console.log(`dist/${variant === 'cdn' ? 'index' : 'local'}.html`, (html.length / 1024).toFixed(0) + ' KB');
}
