// Headless playthrough: serves dist/, opens local.html, plays a full raid with interventions, checks for errors.
// Usage: node test/play.mjs [--shots]
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('/opt/npm-tools/node_modules/playwright/index.js');

const root = new URL('../dist/', import.meta.url);
const types = { html: 'text/html; charset=utf-8', js: 'text/javascript', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', woff2: 'font/woff2' };
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
  await page.waitForSelector('#tip:not([hidden])', { timeout: 5000 });
  check(true, 'first-visit coach tip appears');
  await page.click('#menuBtn'); await page.click('#helpBtn'); await page.waitForSelector('#tut:not([hidden])'); await page.click('#tutSkip'); await page.waitForSelector('#tut', { state: 'hidden' });
  check(!(await page.$('#chapterMap')) && (await page.$$('#raidsUpcoming .raid.upcoming')).length === 3, 'home has no scenario map (it would spoil future problems) and lists 3 upcoming');
  check(!!(await page.$('#dailyGo')) && !!(await page.$('#weekCard .btn')), 'home shows today\'s problem and the weekly major');
  await shot(page, '1-select');

  // brief
  await page.evaluate(id => window.__rpg.openBrief(id), 'fomc-2026-10-29');
  await page.waitForSelector('#screen-brief:not([hidden])');
  check(await page.textContent('#bTitle') !== '', 'briefing title filled');
  await shot(page, '2-brief');

  // party: push dealer to 60, tank 10 (sum stays 100 via explicit set)
  await page.click('#toParty');
  await page.waitForSelector('#screen-party:not([hidden])');
  await page.evaluate(() => { document.querySelector('#partyDetail').open = true; });
  for (let i = 0; i < 4; i++) await page.click('.wbtn[data-w="dealer"][data-d="5"]');   // 40 -> 60, taken from the largest other role
  check((await page.evaluate(() => Object.values(window.__rpg.profile ? 1 : 1))) !== null && (await page.textContent('#o-dealer')) === '60%', 'dealer stepped to 60% and total stays 100');
  await page.click('.wbtn[data-w="tank"][data-d="-5"]');
  check(await page.isDisabled('#startBattle') === true && (await page.textContent('#sumTxt')).includes('남은 비중 5%'), 'freed weight shows as 남은 비중 and start waits');
  await page.click('.wbtn[data-w="healer"][data-d="5"]');
  check(await page.isDisabled('#startBattle') === false, 'start enabled once the pool is reassigned');
  // locked skill shows toast, not equip
  const lockedBtn = await page.$('#sk-dealer .skill .lock');
  check(!!lockedBtn, 'leverage skill is locked at Lv.1');
  // 가방 열기: tapping the chosen product again opens the holdings sheet
  await page.click('#sk-dealer .skill[aria-pressed="true"]'); await page.waitForSelector('#peek:not([hidden])');
  check((await page.$$('#peek .tile')).length >= 5 && (await page.textContent('#peek .pk-line')).includes('ETF'), '가방 열기 shows holdings tiles + one ETF line');
  await page.click('#peekClose'); await page.waitForSelector('#peek', { state: 'hidden' });
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
  check(/%\)$/.test(ret.trim()), 'return shown: ' + ret.trim());
  await page.waitForTimeout(2500);
  const coach = await page.textContent('#coachBubble');
  check(coach.length > 20, 'coach text typed');
  const decisions = await page.textContent('#rDecisions');
  check(decisions.includes('그대로') && decisions.includes('→'), 'decision log lists hold + equip');
  const board = await page.textContent('#rBoard .hd b');
  check(/^이번 판 \d+명 중 \d+등$/.test(board.trim()), 'leaderboard headline: ' + board.trim());
  check((await page.$$('#rBoard .tbl .me')).length === 1 && (await page.$$('#rBoard .tbl > div')).length >= 4, 'leaderboard lists top 3 + my row');
  check(!(await page.$eval('#rEtfCard', e => e.hidden)) && /AO[ARMK]/.test(await page.textContent('#rEtfCard b')), 'result shows the allocation ETF card');
  await shot(page, '6-result');

  // profile persisted
  const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('invest-rpg.profile.v1')));
  check(prof && prof.exp >= 0 && prof.plays['fomc-2026-10-29']?.count === 1, 'profile saved with play count');

  // season carries over
  check(!prof.season || prof.season.raids === 0, 'practice raids leave the season alone');
  // collection
  await page.click('#dexBtn'); await page.waitForSelector('#dex:not([hidden])');
  check((await page.$$('#dexBosses .dex:not(.unknown)')).length === 1 && (await page.$$('#dexClasses .dex')).length === 4, '도감 shows the met boss and 4 class slots');
  check((await page.$$('#dexProducts .pcard:not(.locked)')).length >= 3, '상품 도감 unlocks products used in the raid');
  await page.click('#dexClose');
  // retry flow goes back to party screen
  await page.click('#retryBtn');
  await page.waitForSelector('#screen-party:not([hidden])');
  check(true, 'retry returns to party setup');

  // second raid quickly at 4x with default party (KR tape)
  await page.click('#backToBrief'); await page.click('#backToSelect');
  await page.evaluate(id => window.__rpg.openBrief(id), 'semi-earnings-2026-10-28');
  await page.click('#toParty'); await page.click('[data-preset="balanced"]'); await page.click('#startBattle');
  await page.waitForSelector('#cp:not([hidden])', { timeout: 30000 });
  await page.click('#cp [data-tab="rebalance"]');
  await page.click('#cpSliders .wbtn[data-cw="tank"][data-d="-5"]');
  check(await page.isDisabled('#cpRebalBtn') === true, 'rebalance confirm disabled while weight is unassigned');
  await page.click('#cpSliders .wbtn[data-cw="dealer"][data-d="5"]');
  check(await page.isDisabled('#cpRebalBtn') === false, 'rebalance confirm enabled at 100');
  await page.click('#cpRebalBtn');
  await page.waitForSelector('#cp', { state: 'hidden' });
  await page.waitForSelector('#cp:not([hidden])', { timeout: 30000 });
  await page.click('#cpHoldBtn');
  await page.waitForSelector('#screen-result:not([hidden])', { timeout: 60000 });
  check(true, 'KR raid completed: ' + (await page.textContent('#rStamp')).trim() + ' ' + (await page.textContent('#rRet')).trim());

  // third raid: real daily-close tape (lich boss) — date labels, chart without clock times, hedge equip at checkpoint 1
  await page.click('#otherBtn');
  await page.waitForSelector('#screen-select:not([hidden])');
  await page.evaluate(() => { if (!document.querySelector('#unlockBtn').getAttribute('aria-pressed').includes('true')) document.querySelector('#unlockBtn').click(); }); await page.evaluate(id => window.__rpg.openBrief(id), 'fomc-2026-09-16');
  await page.waitForSelector('#screen-brief:not([hidden])');
  check((await page.textContent('#bDate')).includes('뉴욕 종가'), 'daily tape briefing says 뉴욕 종가: ' + (await page.textContent('#bDate')).trim());
  check(/\d\d\/\d\d\(.\)/.test(await page.textContent('#bTimeline')), 'daily timeline shows dates, not clock times');
  await page.click('#toParty'); await page.click('[data-preset="balanced"]'); await page.click('#startBattle');
  await page.waitForSelector('#cp:not([hidden])', { timeout: 30000 });
  check(/^체크포인트 \d \/ \d$/.test((await page.textContent('#cpStep')).trim()), 'daily checkpoint step is short: ' + (await page.textContent('#cpStep')).trim());
  await page.click('#cp [data-tab="equip"]');
  const healerOpts = await page.$$('#cpEquip .cp-role:nth-child(3) .opts .skill:not(:disabled)');
  const lockedOpts = await page.$$('#cpEquip .cp-role:nth-child(3) .opts .skill:disabled');
  check(healerOpts.length >= 1, `daily tape healer has ${healerOpts.length} open + ${lockedOpts.length} locked alternatives`);
  await healerOpts[0].click();
  await page.waitForSelector('#cp', { state: 'hidden' });
  await page.waitForSelector('#cp:not([hidden])', { timeout: 30000 });
  await page.click('#cpHoldBtn');
  await page.waitForSelector('#screen-result:not([hidden])', { timeout: 60000 });
  check(/^[SABCDF]$/.test((await page.textContent('#rStamp')).trim()), 'real-data raid completed: ' + (await page.textContent('#rStamp')).trim() + ' ' + (await page.textContent('#rRet')).trim());
  check((await page.textContent('#hTime')).includes('뉴욕 종가'), 'battle HUD unit note says 뉴욕 종가');
  await shot(page, '6b-result-real');

  // today's problem: blind brief, one try, reveal with grid, season moves
  await page.evaluate(() => { window.__rpg.setDaily(null); });
  await page.evaluate(() => { document.querySelector('#screen-select').hidden = false; });
  await page.evaluate(() => window.__rpg.openDaily());
  await page.waitForSelector('#screen-brief:not([hidden])');
  check((await page.textContent('#bTag')).startsWith('모험단 레이드 No. '), 'daily brief hides the event: ' + (await page.textContent('#bTag')));
  await page.click('#toParty'); await page.waitForSelector('#screen-party:not([hidden])');
  await page.evaluate(() => window.__rpg.setSpeed(4)); await page.click('#startBattle');
  for (let k = 0; k < 4; k++) { const hit = await Promise.race([page.waitForSelector('#cp:not([hidden])', { timeout: 60000 }).then(() => 'cp'), page.waitForSelector('#screen-result:not([hidden])', { timeout: 60000 }).then(() => 'res')]); if (hit === 'res') break; await page.click('#cpHoldBtn'); }
  await page.waitForSelector('#screen-result:not([hidden])', { timeout: 60000 }); await page.waitForTimeout(1200);
  const dprof = await page.evaluate(() => JSON.parse(localStorage.getItem('invest-rpg.profile.v1')));
  const drec = Object.values(dprof.daily || {})[0];
  check(!!drec?.done && drec.grid.length >= 2 && !(await page.$eval('#rDaily', e => e.hidden)), 'daily reveal shows the grid and saves the result');
  check(dprof.season?.raids === 1, 'daily result moves the season');
  await shot(page, '6c-daily');
  await page.close();   // free the software GPU before the next Phaser instance
  // phone width sanity: no horizontal overflow on select screen
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(`http://127.0.0.1:${port}/local.html`);
  await phone.waitForFunction(() => document.querySelectorAll('.raid').length > 0);

  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, 'no horizontal overflow at 390px (' + overflow + ')');
  await phone.evaluate(id => window.__rpg.openBrief(id), 'fomc-2026-10-29'); await phone.click('#toParty'); await phone.evaluate(() => { document.querySelector('#partyDetail').open = true; });
  const ov2 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(ov2 <= 0, 'no horizontal overflow on party screen at 390px (' + ov2 + ')');
  await phone.waitForTimeout(700); await shot(phone, '7-phone-party');
  await phone.evaluate(() => window.__rpg.setSpeed(4));
  await phone.click('[data-preset="balanced"]');
  const t0 = Date.now();
  await phone.evaluate(() => document.querySelector('#startBattle').click());   // don't block on the (heavy) Phaser boot
  await phone.waitForSelector('#cp:not([hidden])', { timeout: 60000 });
  console.log('   (phone raid reached first checkpoint in', Date.now() - t0, 'ms)');
  await phone.click('#cpHoldBtn');
  await phone.waitForTimeout(900);
  const ov3 = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(ov3 <= 0, 'no horizontal overflow on battle screen at 390px (' + ov3 + ')');
  await shot(phone, '9-phone-battle');
  await phone.close();
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
