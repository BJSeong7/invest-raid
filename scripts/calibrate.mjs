// Boss 격파선 calibration: the best single-decision path from the default party (all skills unlocked) should
// just about break the boss (100 HP). A raid where nothing works keeps a floor so the boss is never trivially beaten.
import { alternatives, defaultParty } from '../src/engine.js';
export function calibrate(tape) {
  const base = defaultParty(tape);
  const alts = alternatives(tape, base);
  const best = Math.max(...alts.map(a => a.returnPct));
  const bossHpPerPct = Math.min(80, Math.max(8, Math.round(100 / Math.max(0.8, best * 0.7) * 10) / 10));   // a good (not perfect) decision breaks the boss
  tape.scale = { ...(tape.scale || {}), bossHpPerPct, hpPerPct: tape.scale?.hpPerPct ?? (tape.daily ? 8 : 12) };
  tape.scale.note = `best single-decision path ${best.toFixed(2)}% -> 격파선 ${(100 / bossHpPerPct).toFixed(2)}%`;
  return tape;
}
