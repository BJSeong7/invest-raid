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

const tpl = read('src/template.html');
for (const [variant, libs] of Object.entries(LIBS)) {
  // function replacements: a plain string replacement would interpret `$$` / `$&` inside the game source
  let html = tpl
    .replace('<!--LIBS-->', () => libs.map(u => `<script src="${u}"></script>`).join('\n'))
    .replace('<!--TAPES-->', () => `<script>window.__TAPES__ = ${JSON.stringify(tapes)};</script>`)
    .replace('<!--GAME-->', () => `<script type="module">\n${inline}\n</script>`);
  if (variant === 'local') html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${html}</body></html>`;
  writeFileSync(new URL(`../dist/${variant === 'cdn' ? 'index' : 'local'}.html`, import.meta.url), html);
  console.log(`dist/${variant === 'cdn' ? 'index' : 'local'}.html`, (html.length / 1024).toFixed(0) + ' KB');
}
