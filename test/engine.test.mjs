import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ROLES, HP_PER_PCT, validateTape, ReplayAdapter, LiveAdapter, defaultParty, validateParty,
  barReturnPct, portfolioReturnPct, createBattle, step, intervene, runToEnd, settle, gradeOf,
  applyExp, expNext, classifyCut, coachText, contribution, alternatives,
} from '../src/engine.js';

const load = id => JSON.parse(readFileSync(new URL(`../data/tapes/${id}.json`, import.meta.url)));
const fomc = load('fomc-2026-10-29');
const semi = load('semi-earnings-2026-10-28');

test('bundled tapes validate', () => {
  assert.deepEqual(validateTape(fomc), []);
  assert.deepEqual(validateTape(semi), []);
});

test('validateTape catches broken tapes', () => {
  const bad = JSON.parse(JSON.stringify(fomc));
  bad.bars[2].prices.QQQ = -1;
  assert.ok(validateTape(bad).some(e => e.includes('bar[2].prices.QQQ')));
  bad.skills.push({ id: 'x', role: 'dealer', instrument: 'NOPE', name: 'x' });
  assert.ok(validateTape(bad).some(e => e.includes('unknown instrument NOPE')));
  assert.ok(validateTape({}).length > 0);
});

test('replay adapter lists and loads', async () => {
  const ad = new ReplayAdapter([fomc, semi]);
  const list = await ad.list();
  assert.equal(list.length, 2);
  const t = await ad.load('fomc-2026-10-29');
  assert.equal(t.boss, '동결이');
  await assert.rejects(ad.load('nope'));
});

test('live adapter uses injected fetch and validates', async () => {
  const ad = new LiveAdapter('https://example/api', async url => url.endsWith('/events') ? [{ id: 'a' }] : semi);
  assert.equal((await ad.list())[0].id, 'a');
  assert.equal((await ad.load('semi-earnings-2026-10-28')).market, 'KR');
  const broken = new LiveAdapter('x', async () => ({ id: 'b' }));
  await assert.rejects(broken.load('b'), /invalid live tape/);
});

test('default party is valid, weights sum to 100', () => {
  const p = defaultParty(fomc);
  assert.deepEqual(validateParty(p, fomc), []);
  assert.equal(ROLES.reduce((a, r) => a + p.weights[r], 0), 100);
  const bad = { ...p, weights: { ...p.weights, dealer: 50 } };
  assert.ok(validateParty(bad, fomc)[0].includes('sum to 100'));
  const wrongRole = { ...p, skills: { ...p.skills, tank: 'dealer_qqq' } };
  assert.ok(validateParty(wrongRole, fomc).some(e => e.includes('cannot be equipped')));
});

test('bar return math matches hand calculation', () => {
  // QQQ bar 0 -> 1 was authored as +0.05%
  const r = barReturnPct(fomc, 'QQQ', 1);
  assert.ok(Math.abs(r - 0.05) < 0.01, `got ${r}`);
  // leveraged ETF moves ~3x the index on the presser bar (bar 6)
  const q = barReturnPct(fomc, 'QQQ', 6), tq = barReturnPct(fomc, 'TQQQ', 6);
  assert.ok(tq / q > 2.8 && tq / q < 3.2, `ratio ${tq / q}`);
  // portfolio return is weight-averaged
  const p = defaultParty(fomc);
  const exp = ROLES.reduce((a, role) => a + p.weights[role] / 100 * barReturnPct(fomc, p._bySkill[p.skills[role]].instrument, 6), 0);
  assert.ok(Math.abs(portfolioReturnPct(fomc, p, 6) - exp) < 1e-9);
});

test('damage is deterministic and scaled by HP_PER_PCT', () => {
  const s1 = runToEnd(createBattle(fomc, defaultParty(fomc)));
  const s2 = runToEnd(createBattle(fomc, defaultParty(fomc)));
  assert.deepEqual(s1.partyHp, s2.partyHp);
  assert.equal(s1.bossHp, s2.bossHp);
  // boss HP mirrors cumulative P&L
  assert.ok(Math.abs(s1.bossHp - Math.max(0, Math.min(100, 100 - (s1.equity - 100) * s1.bossScale))) < 1e-9);
  // slot value compounds: slot *= 1 + ret*scale/100. Bar 1 QQQ +0.05% -> slot 100.6 -> HP capped 100, shield 0.6
  const t1 = s1.log[0];
  assert.equal(t1.roles.dealer.hpAfter, 100);
  assert.ok(Math.abs(t1.roles.dealer.shield - (100 * (1 + t1.roles.dealer.ret * HP_PER_PCT / 100) - 100)) < 1e-9);
  // a losing bar from full HP: expected HP = slot after the move
  const t2 = s1.log.find(x => x.bar === 2);
  const slotAfter = (100 + t1.roles.dealer.shield) * (1 + t2.roles.dealer.ret * HP_PER_PCT / 100);
  assert.ok(Math.abs(t2.roles.dealer.hpAfter - Math.min(100, slotAfter)) < 1e-9);
});

test('battle pauses at checkpoints and resumes after intervene', () => {
  const s = createBattle(fomc, defaultParty(fomc));
  // bars 1,2 process; checkpoint at bar 3 pauses before processing bar 3
  assert.ok(step(s)); assert.ok(step(s));
  assert.equal(step(s), null);
  assert.equal(s.paused.bar, 3);
  assert.equal(s.bar, 2);
  assert.throws(() => step(s) || (() => { throw new Error('still paused'); })());
  intervene(s, { type: 'hold' });
  const t3 = step(s);
  assert.equal(t3.bar, 3);
  assert.equal(s.paused, null);
});

test('equip at checkpoint changes the instrument used from that bar on', () => {
  const s = createBattle(fomc, defaultParty(fomc));
  runToEnd(s, cp => cp.bar === 5 ? { type: 'equip', role: 'healer', skill: 'healer_put' } : { type: 'hold' });
  const before = s.log.find(t => t.bar === 4), after = s.log.find(t => t.bar === 5);
  assert.equal(before.roles.healer.instrument, 'GLD');
  assert.equal(after.roles.healer.instrument, 'QQQ_P');
  // put option should have GAINED during the hawkish presser bars
  const putRet = s.log.filter(t => t.bar >= 5 && t.bar <= 7).reduce((a, t) => a + t.roles.healer.ret, 0);
  assert.ok(putRet > 10, `put return ${putRet}`);   // 25% option / 75% cash blend
  assert.equal(s.actions.filter(a => a.type === 'equip').length, 1);
  assert.equal(s.actions.filter(a => a.type === 'hold').length, 1);   // the bar-3 checkpoint was held
});

test('equip enforces role and unlock level', () => {
  const s = createBattle(fomc, defaultParty(fomc));
  step(s); step(s); step(s);
  assert.throws(() => intervene(s, { type: 'equip', role: 'tank', skill: 'dealer_qqq' }), /not for tank/);
  assert.throws(() => intervene(s, { type: 'equip', role: 'dealer', skill: 'dealer_tqqq', level: 1 }), /locked until level 5/);
  intervene(s, { type: 'equip', role: 'dealer', skill: 'dealer_tqqq', level: 5 });
  assert.equal(s.party.skills.dealer, 'dealer_tqqq');
});

test('rebalance must sum to 100', () => {
  const s = createBattle(fomc, defaultParty(fomc));
  step(s); step(s); step(s);
  assert.throws(() => intervene(s, { type: 'rebalance', weights: { dealer: 80 } }), /sum to 100/);
  intervene(s, { type: 'rebalance', weights: { tank: 40, dealer: 10, healer: 40, support: 10 } });
  assert.equal(s.party.weights.dealer, 10);
});

test('same market, different choices -> different outcomes (the core loop)', () => {
  const hold = runToEnd(createBattle(fomc, defaultParty(fomc)));
  const lev = runToEnd(createBattle(fomc, defaultParty(fomc)), cp => cp.bar === 3 ? { type: 'equip', role: 'dealer', skill: 'dealer_tqqq', level: 9 } : { type: 'hold' });
  const hedge = runToEnd(createBattle(fomc, defaultParty(fomc)), cp => cp.bar === 5 ? { type: 'equip', role: 'healer', skill: 'healer_put', level: 10 } : { type: 'hold' });
  // hawkish surprise: leverage hurts more, hedge helps
  assert.ok(lev.result.returnPct < hold.result.returnPct, 'leverage should lose more');
  assert.ok(hedge.result.returnPct > hold.result.returnPct, 'hedge should save');
  assert.ok(lev.partyHp.dealer < hold.partyHp.dealer);
  // grades reflect it
  const order = ['F', 'D', 'C', 'B', 'A', 'S'];
  assert.ok(order.indexOf(hedge.result.grade) >= order.indexOf(hold.result.grade));
});

test('cash healer never takes damage, put healer is volatile', () => {
  const p = defaultParty(fomc); p.skills.healer = 'healer_cash';
  const s = runToEnd(createBattle(fomc, p));
  assert.equal(s.partyHp.healer, 100);
});

test('settle / grade / exp are consistent', () => {
  assert.equal(gradeOf(2, 1, 4), 'S');
  assert.equal(gradeOf(0.2, 0.1, 4), 'A');
  assert.equal(gradeOf(-0.2, 0.1, 4), 'B');
  assert.equal(gradeOf(-1.5, 0.1, 3), 'C');
  assert.equal(gradeOf(-5, 0.1, 1), 'D');
  assert.equal(gradeOf(1, 0, 0), 'F');
  const s = runToEnd(createBattle(semi, defaultParty(semi)));
  const r = settle(s);
  assert.ok(r.exp >= 5);
  assert.ok(ROLES.includes(r.mvp));
  assert.ok(Math.abs(ROLES.reduce((a, role) => a + contribution(s, role), 0) - s.log.reduce((a, t) => a + t.boss.portfolioRet, 0)) < 1e-9);
});

test('exp curve and level ups', () => {
  let prof = { level: 1, exp: 0 };
  prof = applyExp(prof, expNext(1) + expNext(2) + 5);
  assert.equal(prof.level, 3);
  assert.equal(prof.exp, 5);
  assert.deepEqual(prof.levelUps, [2, 3]);
});

test('cut-in classification', () => {
  const roles = { tank: { ret: -0.2 }, dealer: { ret: -2.5 }, healer: { ret: 0.1 }, support: { ret: -0.3 } };
  assert.equal(classifyCut(-1.2, roles).kind, 'critical_hit');
  assert.equal(classifyCut(-0.6, roles).kind, 'role_crushed');
  assert.equal(classifyCut(-0.6, roles).role, 'dealer');
  assert.equal(classifyCut(0.1, { tank: { ret: 0 }, dealer: { ret: 0.2 }, healer: { ret: 0 }, support: { ret: 0 } }), null);
});

test('coach text is produced and mentions the worst role', () => {
  const s = runToEnd(createBattle(fomc, defaultParty(fomc)));
  const lines = coachText(s);
  assert.ok(lines.length >= 2);
  assert.ok(lines.join(' ').includes('전사'));
});

test('KR tape: semiconductor concentration is punished by the profit-taking leg', () => {
  const diversified = runToEnd(createBattle(semi, defaultParty(semi)));
  const p = defaultParty(semi); p.skills.dealer = 'dealer_ksemi'; p.weights = { tank: 10, dealer: 70, healer: 10, support: 10 };
  const concentrated = runToEnd(createBattle(semi, p));
  // bigger swings both ways: dealer HP should end lower than diversified dealer at some point
  const minHp = Math.min(...concentrated.history.map(h => h.partyHp.dealer));
  const minHpDiv = Math.min(...diversified.history.map(h => h.partyHp.dealer));
  assert.ok(minHp < minHpDiv, `${minHp} vs ${minHpDiv}`);
});

test('alternatives enumerate single-action strategies and are sorted best first', () => {
  const alts = alternatives(fomc, defaultParty(fomc));
  // hold + (checkpoints × roles × alternative skills)
  const expected = 1 + fomc.checkpoints.length * ROLES.reduce((a, r) => a + fomc.skills.filter(s => s.role === r).length - 1, 0);
  assert.equal(alts.length, expected);
  for (let i = 1; i < alts.length; i++) assert.ok(alts[i - 1].returnPct >= alts[i].returnPct);
  assert.ok(alts[0].label.includes('QQQ 풋옵션'), 'best move in a hawkish surprise is the hedge: ' + alts[0].label);
  assert.ok(alts.at(-1).label.includes('나스닥100 3배'), 'worst move is leverage before the drop: ' + alts.at(-1).label);
  const hold = alts.find(a => a.detail.type === 'hold');
  assert.ok(Math.abs(hold.returnPct - runToEnd(createBattle(fomc, defaultParty(fomc))).result.returnPct) < 1e-9);
});
