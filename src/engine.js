/**
 * invest-rpg engine core
 * ----------------------
 * UI-free. Runs in Node (tests) and in the browser (Phaser scene imports it).
 *
 * Vocabulary
 *   tape        : one market event, sliced into intraday segments ("bars"). Each bar = one battle turn.
 *   instrument  : anything with a price series in the tape (ETF, leveraged ETF, option contract, cash).
 *   skill       : an instrument wrapped in game language (name, role, flavor). 1 skill = 1 instrument.
 *   party       : 4 roles (tank/dealer/healer/support) with weights (sum 100) and an equipped skill each.
 *   checkpoint  : a bar where the auto-battle pauses and the player may intervene (re-equip / rebalance).
 *
 * All damage is derived from the tape. No RNG anywhere in this file.
 */

export const ROLES = ['tank', 'dealer', 'healer', 'support'];

export const ROLE_META = {
  tank:    { name: '탱커',  asset: '채권',    char: '로한', title: '방패기사', color: '#8EA0B8' },
  dealer:  { name: '딜러',  asset: '성장주',  char: '카일', title: '대검사',   color: '#6E9BFF' },
  healer:  { name: '힐러',  asset: '금·현금', char: '엘린', title: '사제',     color: '#F2C14E' },
  support: { name: '서포터', asset: '배당주', char: '세라', title: '궁수',     color: '#6FD39A' },
};

/**
 * Party damage scale. A role's slot value starts at 100 and compounds with its instrument's bar-to-bar move,
 * amplified so that intraday % reads as damage. HP = min(100, slot); value above 100 shows as a shield.
 * Options already move 10-40% per bar, so they are not amplified.
 */
export const HP_PER_PCT = 12;
export const HP_SCALE_BY_KIND = { option: 1 };
/** Boss HP = 100 - (cumulative portfolio return %) * BOSS_HP_PER_PCT, clamped. +2.5% beats the event; a loss leaves it untouched. */
export const BOSS_HP_PER_PCT = 40;

/* ------------------------------------------------------------------ */
/* Tape validation                                                     */
/* ------------------------------------------------------------------ */

export function validateTape(tape) {
  const errors = [];
  if (!tape || typeof tape !== 'object') return ['tape is not an object'];
  if (!tape.id) errors.push('tape.id missing');
  if (!Array.isArray(tape.bars) || tape.bars.length < 2) errors.push('tape.bars needs >= 2 bars');
  if (!tape.instruments || typeof tape.instruments !== 'object') errors.push('tape.instruments missing');
  if (!Array.isArray(tape.skills) || tape.skills.length === 0) errors.push('tape.skills missing');
  if (errors.length) return errors;

  const ids = Object.keys(tape.instruments);
  tape.bars.forEach((b, i) => {
    if (!b.t) errors.push(`bar[${i}].t missing`);
    if (!b.prices) { errors.push(`bar[${i}].prices missing`); return; }
    ids.forEach(id => {
      const p = b.prices[id];
      if (typeof p !== 'number' || !(p > 0)) errors.push(`bar[${i}].prices.${id} must be a positive number`);
    });
  });
  tape.skills.forEach(s => {
    if (!tape.instruments[s.instrument]) errors.push(`skill ${s.id} references unknown instrument ${s.instrument}`);
    if (!ROLES.includes(s.role)) errors.push(`skill ${s.id} has unknown role ${s.role}`);
    if (s.blend) {
      const sum = Object.values(s.blend).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 1e-9) errors.push(`skill ${s.id} blend shares must sum to 1`);
      Object.keys(s.blend).forEach(id => { if (!tape.instruments[id]) errors.push(`skill ${s.id} blend references unknown instrument ${id}`); });
    }
  });
  (tape.checkpoints || []).forEach((c, i) => {
    if (!(c.bar > 0 && c.bar < tape.bars.length)) errors.push(`checkpoint[${i}].bar out of range`);
  });
  return errors;
}

/* ------------------------------------------------------------------ */
/* Adapters: where tapes come from                                     */
/* ------------------------------------------------------------------ */

/** Replay adapter: tapes are already in memory (bundled JSON). */
export class ReplayAdapter {
  constructor(tapes) { this.tapes = new Map(tapes.map(t => [t.id, t])); }
  async list() { return [...this.tapes.values()].map(summary); }
  async load(id) {
    const t = this.tapes.get(id);
    if (!t) throw new Error(`unknown tape ${id}`);
    const errs = validateTape(t);
    if (errs.length) throw new Error(`invalid tape ${id}: ${errs.join('; ')}`);
    return t;
  }
}

/**
 * Live adapter: the same shape, produced by a server. `fetchJson(url)` is injected
 * so the engine never touches the network itself (and tests can stub it).
 * Expected endpoints:
 *   GET {base}/events           -> [summary]
 *   GET {base}/events/{id}      -> tape (bars may be partial until the event settles)
 */
export class LiveAdapter {
  constructor(base, fetchJson) { this.base = base; this.fetchJson = fetchJson; }
  async list() { return this.fetchJson(`${this.base}/events`); }
  async load(id) {
    const t = await this.fetchJson(`${this.base}/events/${id}`);
    const errs = validateTape(t);
    if (errs.length) throw new Error(`invalid live tape ${id}: ${errs.join('; ')}`);
    return t;
  }
}

export function summary(t) {
  return { id: t.id, title: t.title, boss: t.boss, date: t.bars[0].t, market: t.market, settled: t.settled !== false };
}

/* ------------------------------------------------------------------ */
/* Party                                                               */
/* ------------------------------------------------------------------ */

export function defaultParty(tape) {
  const bySkill = Object.fromEntries(tape.skills.map(s => [s.id, s]));
  const pick = role => tape.skills.find(s => s.role === role && s.default) || tape.skills.find(s => s.role === role);
  return {
    weights: { tank: 25, dealer: 40, healer: 20, support: 15 },
    skills: Object.fromEntries(ROLES.map(r => [r, pick(r).id])),
    _bySkill: bySkill,
  };
}

export function validateParty(party, tape) {
  const errors = [];
  const sum = ROLES.reduce((a, r) => a + (party.weights[r] || 0), 0);
  if (sum !== 100) errors.push(`weights must sum to 100 (got ${sum})`);
  ROLES.forEach(r => {
    const w = party.weights[r];
    if (!(w >= 0 && w <= 100)) errors.push(`weight.${r} out of range`);
    const s = tape.skills.find(k => k.id === party.skills[r]);
    if (!s) errors.push(`skill for ${r} not found: ${party.skills[r]}`);
    else if (s.role !== r) errors.push(`skill ${s.id} cannot be equipped by ${r}`);
  });
  return errors;
}

/* ------------------------------------------------------------------ */
/* Core math                                                           */
/* ------------------------------------------------------------------ */

/** Simple return of instrument `id` from bar i-1 to bar i, in percent. */
export function barReturnPct(tape, id, i) {
  const a = tape.bars[i - 1].prices[id], b = tape.bars[i].prices[id];
  return (b / a - 1) * 100;
}

/**
 * Return of a SKILL for one bar. A skill is normally one instrument; a `blend` skill splits its slot
 * across instruments (e.g. 25% put option + 75% cash = an insurance budget).
 */
export function skillReturnPct(tape, skill, i) {
  if (!skill.blend) return barReturnPct(tape, skill.instrument, i);
  let r = 0;
  for (const [id, share] of Object.entries(skill.blend)) r += share * barReturnPct(tape, id, i);
  return r;
}

/** Portfolio return for one bar given party (weights + equipped skills), in percent. */
export function portfolioReturnPct(tape, party, i) {
  let r = 0;
  for (const role of ROLES) {
    const skill = party._bySkill[party.skills[role]];
    r += (party.weights[role] / 100) * skillReturnPct(tape, skill, i);
  }
  return r;
}

/* ------------------------------------------------------------------ */
/* Battle state machine                                                */
/* ------------------------------------------------------------------ */

/**
 * createBattle(tape, party) -> state
 * step(state)                -> advances one bar; returns the turn log (or null at a checkpoint / end)
 * intervene(state, action)   -> apply a checkpoint action, then clear the pause
 *
 * The scene layer only reads `state` and plays the returned logs. It never computes damage itself.
 */
export function createBattle(tape, party, opts = {}) {
  const errs = [...validateTape(tape), ...validateParty(party, tape)];
  if (errs.length) throw new Error(errs.join('; '));
  // scale can be set per tape (daily bars move more than 30-minute bars)
  const hpScale = opts.hpPerPct ?? tape.scale?.hpPerPct ?? HP_PER_PCT;
  const bossScale = opts.bossHpPerPct ?? tape.scale?.bossHpPerPct ?? BOSS_HP_PER_PCT;
  return {
    tape, party: clone(party), hpScale, bossScale,
    bar: 0,                                   // index of the last processed bar
    slot: Object.fromEntries(ROLES.map(r => [r, 100])),      // each role's value, start 100, amplified by hpScale
    partyHp: Object.fromEntries(ROLES.map(r => [r, 100])),   // min(100, slot)
    shield: Object.fromEntries(ROLES.map(r => [r, 0])),      // max(0, slot - 100)
    bossHp: 100,
    equity: 100,                              // portfolio value, start 100
    benchmark: 100,                           // equal-weight-of-default-skills value, for grading
    log: [],
    paused: null,                             // checkpoint object when waiting for the player
    done: false,
    history: [],                              // per-bar snapshots for the chart
    _benchParty: defaultParty(tape),
  };
}

export function nextCheckpoint(state) {
  return (state.tape.checkpoints || []).find(c => c.bar === state.bar + 1) || null;
}

export function step(state) {
  if (state.done) return null;
  if (state.paused) return null;                    // must intervene() first (or skip())
  const cp = nextCheckpoint(state);
  if (cp && !state._cpSeen?.has(cp.bar)) {           // pause BEFORE processing the checkpoint bar
    state.paused = cp;
    (state._cpSeen ||= new Set()).add(cp.bar);
    return null;
  }
  const i = state.bar + 1;
  const tape = state.tape, party = state.party;
  const turn = { bar: i, t: tape.bars[i].t, label: tape.bars[i].label || '', roles: {}, boss: {}, events: [] };

  // per-role damage / recovery from each role's own instrument
  let portfolio = 0;
  for (const role of ROLES) {
    const skill = party._bySkill[party.skills[role]];
    const ret = skillReturnPct(tape, skill, i);
    const w = party.weights[role] / 100;
    portfolio += w * ret;
    // slot value compounds with the instrument; the move is amplified so intraday % reads as damage.
    // A dead slot (0) stays dead for the battle.
    const before = state.partyHp[role];
    const kind = tape.instruments[skill.instrument].kind;
    const scale = HP_SCALE_BY_KIND[kind] ?? state.hpScale;
    if (state.slot[role] > 0) state.slot[role] = Math.max(0, state.slot[role] * (1 + (ret * scale) / 100));
    state.partyHp[role] = clamp(state.slot[role], 0, 100);
    state.shield[role] = Math.max(0, state.slot[role] - 100);
    turn.roles[role] = { skill: skill.id, skillName: skill.name, instrument: skill.instrument, weight: party.weights[role], ret,
      hpBefore: before, hpAfter: state.partyHp[role], shield: state.shield[role], fainted: before > 0 && state.partyHp[role] === 0 };
  }
  // boss HP mirrors cumulative P&L: gains cut it, losses let it recover (never above 100)
  const bossBefore = state.bossHp;
  state.equity *= 1 + portfolio / 100;
  state.bossHp = clamp(100 - (state.equity - 100) * state.bossScale, 0, 100);
  turn.boss = { portfolioRet: portfolio, hpBefore: bossBefore, hpAfter: state.bossHp };
  turn.cut = classifyCut(portfolio, turn.roles);

  state.benchmark *= 1 + portfolioReturnPct(tape, state._benchParty, i) / 100;
  state.bar = i;
  state.history.push({ bar: i, t: tape.bars[i].t, equity: state.equity, benchmark: state.benchmark, bossHp: state.bossHp, partyHp: { ...state.partyHp } });
  state.log.push(turn);

  if (state.bar >= tape.bars.length - 1) { state.done = true; state.result = settle(state); }
  else if (ROLES.every(r => state.partyHp[r] === 0)) { state.done = true; state.result = settle(state); }
  return turn;
}

/** Checkpoint actions. All of them are just party edits; the market does the rest. */
export function intervene(state, action) {
  if (!state.paused) throw new Error('not at a checkpoint');
  const party = state.party, tape = state.tape;
  const applied = { type: action.type, at: state.paused.bar };
  switch (action.type) {
    case 'hold':
      break;
    case 'equip': {                                   // swap one role's skill
      const s = tape.skills.find(k => k.id === action.skill);
      if (!s) throw new Error(`unknown skill ${action.skill}`);
      if (s.role !== action.role) throw new Error(`skill ${s.id} is not for ${action.role}`);
      if (s.unlockLevel && (action.level ?? 99) < s.unlockLevel) throw new Error(`skill ${s.id} locked until level ${s.unlockLevel}`);
      applied.from = party.skills[action.role]; applied.to = s.id;
      party.skills[action.role] = s.id;
      break;
    }
    case 'rebalance': {                               // new weights, must sum to 100
      const w = { ...party.weights, ...action.weights };
      const sum = ROLES.reduce((a, r) => a + w[r], 0);
      if (sum !== 100) throw new Error(`weights must sum to 100 (got ${sum})`);
      applied.from = { ...party.weights }; applied.to = w;
      party.weights = w;
      break;
    }
    default: throw new Error(`unknown action ${action.type}`);
  }
  (state.actions ||= []).push(applied);
  state.paused = null;
  return applied;
}

export function runToEnd(state, decide = () => ({ type: 'hold' })) {
  // decide(checkpoint, state) -> action. Used by tests and by the auto-play demo.
  for (let guard = 0; guard < 10000 && !state.done; guard++) {
    if (state.paused) intervene(state, decide(state.paused, state));
    step(state);
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* Result, grading, EXP                                                */
/* ------------------------------------------------------------------ */

export function settle(state) {
  const ret = state.equity - 100;
  const bench = state.benchmark - 100;
  const alive = ROLES.filter(r => state.partyHp[r] > 0).length;
  const bossDown = state.bossHp <= 0;
  const grade = gradeOf(ret, bench, alive);
  const exp = Math.max(5, Math.round(20 + ret * 6 + (bossDown ? 30 : 0) + alive * 3 + gradeBonus(grade)));
  const mvp = ROLES.map(r => ({ role: r, contrib: contribution(state, r) })).sort((a, b) => b.contrib - a.contrib)[0];
  return { returnPct: ret, benchmarkPct: bench, alpha: ret - bench, alive, bossDown, grade, exp, mvp: mvp.role, victory: bossDown || (ret >= 0 && alive >= 2) };
}

/** Sum of a role's weighted returns over the battle, in portfolio-% points. */
export function contribution(state, role) {
  return state.log.reduce((a, t) => a + t.roles[role].ret * (t.roles[role].weight / 100), 0);
}

export function gradeOf(ret, bench, alive) {
  if (alive === 0) return 'F';
  const a = ret - bench;
  if (ret > 0 && a >= 0.5) return 'S';
  if (ret > 0 && a >= 0) return 'A';
  if (ret > -0.5) return 'B';
  if (ret > -2) return 'C';
  return 'D';
}
const gradeBonus = g => ({ S: 25, A: 15, B: 5, C: 0, D: 0, F: 0 }[g] || 0);
/** one line that says why this grade, in the player's words */
export function gradeReason(r) {
  const p = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  if (r.grade === 'F') return '파티가 전멸했어요.';
  if (r.grade === 'S') return `수익 ${p(r.returnPct)}, 기본 파티보다 ${p(r.alpha)}p 앞섰어요 (S는 +0.5%p 이상).`;
  if (r.grade === 'A') return `수익 ${p(r.returnPct)}, 기본 파티보다 앞섰어요 (+0.5%p 이상이면 S).`;
  if (r.grade === 'B') return `수익 ${p(r.returnPct)} — 플러스로 마치고 기본 파티보다 앞서면 A예요.`;
  if (r.grade === 'C') return `수익 ${p(r.returnPct)} — −0.5% 안쪽으로 막으면 B예요.`;
  return `수익 ${p(r.returnPct)} — 크게 밀렸어요. 방어 상품 비중을 늘려 보세요.`;
}

/** Level curve: exp needed to go from L to L+1. */
export const expNext = L => 40 + L * 20;
export function applyExp(profile, exp) {
  const out = { ...profile, exp: profile.exp + exp, levelUps: [] };
  while (out.exp >= expNext(out.level)) { out.exp -= expNext(out.level); out.level++; out.levelUps.push(out.level); }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cut-in classification & coach text (deterministic; LLM can replace) */
/* ------------------------------------------------------------------ */

export function classifyCut(portfolioRet, roles) {
  const worst = Object.entries(roles).sort((a, b) => a[1].ret - b[1].ret)[0];
  const best = Object.entries(roles).sort((a, b) => b[1].ret - a[1].ret)[0];
  if (portfolioRet <= -1.0) return { kind: 'critical_hit', role: worst[0], text: '필살기!' };
  if (portfolioRet >= 1.0) return { kind: 'critical_deal', role: best[0], text: '크리티컬!' };
  if (worst[1].ret <= -2.0) return { kind: 'role_crushed', role: worst[0], text: `${ROLE_META[worst[0]].char} 대피해!` };
  if (best[1].ret >= 2.0) return { kind: 'role_shine', role: best[0], text: `${ROLE_META[best[0]].char} 맹활약!` };
  return null;
}

export function coachText(state) {
  // Three short sentences, no more: what happened, the one thing that decided it, the lesson of this raid.
  const r = state.result || settle(state);
  const byRole = ROLES.map(role => ({ role, c: contribution(state, role), w: state.party.weights[role], skill: state.party._bySkill[state.party.skills[role]] }));
  const worst = [...byRole].sort((a, b) => a.c - b.c)[0];
  const best = [...byRole].sort((a, b) => b.c - a.c)[0];
  const sign = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const lines = [];
  const mover = Math.abs(worst.c) > Math.abs(best.c) ? worst : best;
  lines.push(`${sign(r.returnPct)}로 마쳤고, 기본 파티보다 ${sign(r.alpha)}예요. ${mover.c < 0 ? '가장 크게 깎은 건' : '가장 크게 벌어준 건'} ${ROLE_META[mover.role].char}의 ${mover.skill.name}(비중 ${mover.w}%)였어요.`);
  const eq = state.actions?.find(a => a.type === 'equip');
  const maxW = Math.max(...ROLES.map(x => state.party.weights[x]));
  if (eq) { const s = state.party._bySkill[eq.to]; lines.push(`체크포인트에서 ${s.name}(으)로 바꾼 선택은 ${afterCheckpointRet(state, eq.at) >= 0 ? '맞아떨어졌어요' : '이번엔 통하지 않았어요'}.`); }
  else if (maxW >= 60) lines.push(`한 역할에 ${maxW}%를 몰아준 편성이라 ${maxW === worst.w ? '한 방에 크게 맞았어요' : '이번엔 크게 벌었지만 반대였다면 크게 잃었을 거예요'}.`);
  else lines.push(worst.c < -0.3 ? `${ROLE_META[worst.role].char}가 맞을 때 바꿔줄 상품이 있었는지 '같은 시장, 다른 선택'을 보세요.` : '고르게 나눈 편성이 크게 다치지 않은 비결이에요.');
  if (state.tape.lesson) lines.push(state.tape.lesson);
  return lines.slice(0, 3);
}
function afterCheckpointRet(state, bar) {
  return state.log.filter(t => t.bar >= bar).reduce((a, t) => a + t.boss.portfolioRet, 0);
}

/* ------------------------------------------------------------------ */
/* utils                                                               */
/* ------------------------------------------------------------------ */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function clone(p) { return { weights: { ...p.weights }, skills: { ...p.skills }, _bySkill: p._bySkill }; }

/* ------------------------------------------------------------------ */
/* What-if: the same market with different checkpoint choices          */
/* ------------------------------------------------------------------ */

/**
 * Enumerates single-action strategies (hold everywhere; or one equip at one checkpoint) from the same
 * starting party and returns their settled results, best first. Pure and deterministic.
 */
export function alternatives(tape, baseParty) {
  const start = () => ({ weights: { ...baseParty.weights }, skills: { ...baseParty.skills }, _bySkill: baseParty._bySkill });
  const out = [];
  const run = (label, decide, detail) => {
    const s = runToEnd(createBattle(tape, start()), decide);
    out.push({ label, detail, returnPct: s.result.returnPct, grade: s.result.grade, bossDown: s.result.bossDown });
  };
  run('모두 버티기', () => ({ type: 'hold' }), { type: 'hold' });
  for (const cp of tape.checkpoints || []) {
    for (const role of ROLES) {
      for (const sk of tape.skills.filter(k => k.role === role && k.id !== baseParty.skills[role])) {
        run(`${cp.title}에 ${ROLE_META[role].char} → ${sk.name}`, c => c.bar === cp.bar ? { type: 'equip', role, skill: sk.id, level: 99 } : { type: 'hold' }, { type: 'equip', bar: cp.bar, role, skill: sk.id, unlockLevel: sk.unlockLevel || 1 });
      }
    }
  }
  out.sort((a, b) => b.returnPct - a.returnPct);
  return out;
}
