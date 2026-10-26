// Headless playthrough: serves dist/, opens local.html, plays a full raid with interventions, checks for errors.
// Usage: node test/play.mjs [--shots]
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('/opt/npm-tools/node_modules/playwright/index.js');

const root = new URL('../dist/', import.meta.url);
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript', json: 'application/json' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'local.html';
  const f = new URL(p, root);
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[p.split('.').pop()] || 'application/octet-stream' }); res.end(readFileSync(f));
}).listen(0);
const port = server.address().port;
const shots = process.argv.includes('--shots');
mkdirSync(new URL('../shots/', import.meta.url), { recursive: true });
const shot = (page, name) => shots ? page.screenshot({ path: new URL(`../shots/${name}.png`, import.meta.url).pathname, fullPage: true }) : null;

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let failed = 0;
const check = (cond, msg) => { if (cond) console.log('ok -', msg); else { failed++; console.log('FAIL -', msg); } };
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 1300 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`http://127.0.0.1:${port}/local.html`);
  await page.waitForFunction(() => window.__rpg && document.querySelectorAll('.raid').length > 0);
  check((await page.$$('.raid')).length === 3, 'raid select shows 3 raids');
  await shot(page, '1-select');

  // brief
  await page.click('.raid:has-text("골렘")');
  await page.waitForSelector('#screen-brief:not([hidden])');
  check(await page.textContent('#bTitle') !== '', 'briefing title filled');
  await shot(page, '2-brief');

  // party: push dealer to 60, tank 10 (sum stays 100 via explicit set)
  await page.click('#toParty');
  await page.waitForSelector('#screen-party:not([hidden])');
  await page.fill('#w-dealer', '60'); await page.dispatchEvent('#w-dealer', 'input');
  await page.fill('#w-tank', '0'); await page.dispatchEvent('#w-tank', 'input');   // 60+0+20+15 = 95
  check(await page.isDisabled('#startBattle') === true, 'start disabled while weights != 100');
  await page.fill('#w-tank', '10'); await page.dispatchEvent('#w-tank', 'input');
  await page.fill('#w-healer', '15'); await page.dispatchEvent('#w-healer', 'input');
  check(await page.isDisabled('#startBattle') === false, 'start enabled at 100');
  // locked skill shows toast, not equip
  const lockedBtn = await page.$('#sk-dealer .skill .lock');
  check(!!lockedBtn, 'leverage skill is locked at Lv.1');
  await shot(page, '3-party');

  // battle at 4x; intervene at checkpoints: hold at first, equip cash healer at second
  await page.evaluate(() => window.__rpg.setSpeed(4));
  await page.click('#startBattle');
  await page.waitForSelector('#screen-battle:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#arena canvas') !== null, null, { timeout: 15000 });
  check(true, 'phaser canvas mounted');
  // first checkpoint
  await page.waitForSelector('#cp:not([hidden])', { timeout: 30000 });
  check((await page.textContent('#cpTitle')).includes('발표'), 'first checkpoint modal opened: ' + (await page.textContent('#cpTitle')).trim());
  await shot(page, '4-checkpoint');
  await page.click('#cpHoldBtn');
  await page.waitForSelector('#cp', { state: 'hidden' });
  // second checkpoint -> equip tab -> healer cash
  await page.waitForSelector('#cp:not([hidden])', { timeout: 30000 });
  await page.click('#cp [data-tab="equip"]');
  const cashBtn = await page.$$('#cpEquip .cp-role:nth-child(3) .opts .skill');
  check(cashBtn.length >= 1, 'healer has alternative skills at checkpoint');
  await cashBtn[0].click();
  await page.waitForSelector('#cp', { state: 'hidden' });
  const equipped = await page.evaluate(() => window.__rpg.battle.party.skills.healer);
  check(equipped !== 'healer_gld', 'healer skill changed by checkpoint equip: ' + equipped);
  await page.waitForTimeout(600);
  await shot(page, '5-battle');

  // result
  await page.waitForSelector('#screen-result:not([hidden])', { timeout: 60000 });
  const grade = await page.textContent('#rStamp');
  check(/^[SABCDF]$/.test(grade.trim()), 'result grade shown: ' + grade.trim());
  const ret = await page.textContent('#rRet');
  check(/%$/.test(ret.trim()), 'return shown: ' + ret.trim());
  await page.waitForTimeout(2500);
  const coach = await page.textContent('#coachBubble');
  check(coach.length > 20, 'coach text typed');
  const decisions = await page.textContent('#rDecisions');
  check(decisions.includes('버티기') && decisions.includes('→'), 'decision log lists hold + equip');
  await shot(page, '6-result');

  // profile persisted
  const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('invest-rpg.profile.v1')));
  check(prof && prof.exp >= 0 && prof.plays['fomc-2026-10-29']?.count === 1, 'profile saved with play count');

  // retry flow goes back to party screen
  await page.click('#retryBtn');
  await page.waitForSelector('#screen-party:not([hidden])');
  check(true, 'retry returns to party setup');

  // second raid quickly at 4x with default party (KR tape)
  await page.click('#backToBrief'); await page.click('#backToSelect');
  await page.click('.raid:has-text("히드라")');
  await page.click('#toParty'); await page.click('#presetBtn'); await page.click('#startBattle');
  await page.waitForSelector('#cp:not([hidden])', { timeout: 30000 });
  await page.click('#cp [data-tab="rebalance"]');
  await page.fill('#cw-dealer', '70'); await page.dispatchEvent('#cw-dealer', 'input');
  check(await page.isDisabled('#cpRebalBtn') === true, 'rebalance confirm disabled when sum != 100');
  await page.fill('#cw-tank', '0'); await page.dispatchEvent('#cw-tank', 'input');
  await page.fill('#cw-healer', '15'); await page.dispatchEvent('#cw-healer', 'input');
  await page.fill('#cw-support', '15'); await page.dispatchEvent('#cw-support', 'input');
  check(await page.isDisabled('#cpRebalBtn') === false, 'rebalance confirm enabled at 100');
  await page.click('#cpRebalBtn');
  await page.waitForSelector('#cp', { state: 'hidden' });
  await page.waitForSelector('#cp:not([hidden])', { timeout: 30000 });
  await page.click('#cpHoldBtn');
  await page.waitForSelector('#screen-result:not([hidden])', { timeout: 60000 });
  check(true, 'KR raid completed: ' + (await page.textContent('#rStamp')).trim() + ' ' + (await page.textContent('#rRet')).trim());

  // phone width sanity: no horizontal overflow on select screen
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`http://127.0.0.1:${port}/local.html`);
  await phone.waitForFunction(() => document.querySelectorAll('.raid').length > 0);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, 'no horizontal overflow at 390px (' + overflow + ')');
  await phone.click('.raid'); await phone.click('#toParty');
  const ov2 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(ov2 <= 0, 'no horizontal overflow on party screen at 390px (' + ov2 + ')');
  await shot(phone, '7-phone-party');
  // cut-in preview frame (for visual review)
  const cutPage = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await cutPage.goto(`http://127.0.0.1:${port}/local.html`);
  await cutPage.waitForFunction(() => window.__rpg);
  const cutDone = cutPage.evaluate(() => window.__rpg.previewCut('hit'));
  await cutPage.waitForTimeout(520);
  await shot(cutPage, '8-cutin');
  check((await cutPage.textContent('#cutText')) === '필살기!', 'cut-in preview rendered');
  await cutDone;
} catch (e) {
  failed++; console.log('FAIL - exception:', e.message);
} finally {
  const real = errors.filter(e => !/fonts.googleapis|net::ERR|Failed to load resource|WebGL|swiftshader/i.test(e));
  check(real.length === 0, 'no page/console errors' + (real.length ? ':\n   ' + real.join('\n   ') : ''));
  await browser.close(); server.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
}
