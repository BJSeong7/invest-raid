// Boss 격파선 calibration: the best single-decision path from the default party (all skills unlocked) should
// just about break the boss (100 HP). A raid where nothing works keeps a floor so the boss is never trivially beaten.
import { alternatives, defaultParty } from '../src/engine.js';
// Plain product names for skills (what a brokerage user would call it), keyed by the skill's instrument.
const PLAIN = { TLT: '미국 장기채', SHY: '미국 단기채', QQQ: '나스닥100', TQQQ: '나스닥100 3배', SOXX: '미국 반도체', GLD: '금', BIL: '현금',
  PSQ: '나스닥 인버스', SQQQ: '나스닥 인버스 3배', SCHD: '미국 배당주', QQQ_P: '풋옵션 보험',
  KBOND: '국고채 10년', K200: '코스피200', K200L: '코스피200 2배', KSEMI: '국내 반도체', KGOLD: '금', KCASH: '현금', KDIV: '고배당주', K200_P: '풋옵션 보험' };
export function plainNames(tape) {
  tape.skills.forEach(k => { const n = PLAIN[k.instrument]; if (!n) return; k.name = k.blend && !/_P$/.test(k.instrument) ? `${n} 일부` : n; });
  return tape;
}
export function calibrate(tape) {
  plainNames(tape);
  const base = defaultParty(tape);
  const alts = alternatives(tape, base);
  const best = Math.max(...alts.map(a => a.returnPct));
  const bossHpPerPct = Math.min(80, Math.max(8, Math.round(100 / Math.max(0.8, best * 0.7) * 10) / 10));   // a good (not perfect) decision breaks the boss
  tape.scale = { ...(tape.scale || {}), bossHpPerPct, hpPerPct: tape.scale?.hpPerPct ?? (tape.daily ? 8 : 12) };
  tape.scale.note = `best single-decision path ${best.toFixed(2)}% -> 격파선 ${(100 / bossHpPerPct).toFixed(2)}%`;
  return tape;
}
