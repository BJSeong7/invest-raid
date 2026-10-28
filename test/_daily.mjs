import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('/opt/npm-tools/node_modules/playwright/index.js');
const root = new URL('../dist/', import.meta.url);
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', woff2: 'font/woff2' };
const server = createServer((req, res) => { const p = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'local.html'; const f = new URL(p, root); if (!existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[p.split('.').pop()] || 'application/octet-stream' }); res.end(readFileSync(f)); });
await new Promise(r => server.listen(0, r));
const out = '/tmp/claude-0/-home-claude/96400a46-62ae-5fb0-b889-1555f1b99326/scratchpad/';
const W = +(process.argv[2] || 1000), H = W < 500 ? 844 : 1100;
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', e => console.log('PAGEERR', e.message)); page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.addInitScript(() => localStorage.setItem('invest-rpg.profile.v1', JSON.stringify({ level: 1, exp: 0, plays: {}, seenTutorial: true, tips: { select: 1, brief: 1, party: 1, battle: 1, cp: 1, result: 1 } })));
await page.goto(`http://127.0.0.1:${server.address().port}/local.html`); await page.waitForTimeout(1200);
await page.screenshot({ path: out + `d1-home-${W}.png` });
await page.click('#dailyGo'); await page.waitForSelector('#screen-brief:not([hidden])'); await page.waitForTimeout(900);
await page.screenshot({ path: out + `d2-brief-${W}.png`, fullPage: true });
console.log('brief title:', await page.textContent('#bTitle'), '|', await page.textContent('#bTag'), '|', await page.textContent('#bDate'));
await page.click('#toParty'); await page.waitForSelector('#screen-party:not([hidden])');
await page.evaluate(() => window.__rpg.setSpeed(2));
await page.click('#startBattle'); await page.waitForSelector('#screen-battle:not([hidden])');
let shotCp = false; const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  if (await page.$('#cp:not([hidden])')) { if (!shotCp) { await page.waitForTimeout(500); await page.screenshot({ path: out + `d3-cp-${W}.png` }); shotCp = true; } await page.click('#cpHoldBtn'); await page.waitForTimeout(300); }
  const nb = await page.$('#nextBtn:not([hidden])'); if (nb) { await nb.click().catch(() => {}); }
  if (await page.$('#screen-result:not([hidden])')) break;
  await page.waitForTimeout(200);
}
await page.waitForTimeout(2500);
await page.screenshot({ path: out + `d4-result-${W}.png`, fullPage: true });
console.log('daily rec:', await page.evaluate(() => JSON.stringify(window.__rpg.profile.daily)));
await page.click('#nextRaidBtn'); await page.waitForTimeout(800);
await page.screenshot({ path: out + `d5-home-done-${W}.png` });
await b.close(); server.close();
