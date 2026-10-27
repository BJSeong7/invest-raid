// Builds a tape from real intraday bars.
//
//   node scripts/tape-from-bars.mjs spec.json > data/tapes/<id>.json
//
// spec.json:
// {
//   "id": "fomc-2026-10-29", "title": "...", "boss": "...", "bossSpecies": "golem", "market": "US",
//   "briefing": "...", "lesson": "...", "concepts": [...], "skills": [...], "checkpoints": [...],
//   "cuts": [ { "t": "2026-10-29T02:00:00+09:00", "label": "장중 대기" }, ... ],     // one per turn, ascending
//   "instruments": { "QQQ": { "name": "나스닥100 ETF", "kind": "etf", "bars": "bars/QQQ.json" }, ... }
// }
// A bars file is either JSON [{ "t": ISO-8601, "c": close }, ...] (Alpaca-style keys also accepted: t/c)
// or CSV with a header containing time/close (or t/c) columns.
// For each cut, the LAST close at or before the cut time is used (no look-ahead).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { validateTape } from '../src/engine.js';

export function parseBars(text) {
  const s = text.trim();
  if (s.startsWith('[')) return JSON.parse(s).map(b => ({ t: Date.parse(b.t ?? b.time ?? b.timestamp), c: Number(b.c ?? b.close) }));
  const lines = s.split(/\r?\n/); const head = lines[0].split(',').map(h => h.trim().toLowerCase());
  const ti = head.findIndex(h => ['t', 'time', 'timestamp', 'datetime'].includes(h)), ci = head.findIndex(h => ['c', 'close'].includes(h));
  if (ti < 0 || ci < 0) throw new Error('CSV needs time and close columns');
  return lines.slice(1).filter(Boolean).map(l => { const cols = l.split(','); return { t: Date.parse(cols[ti]), c: Number(cols[ci]) }; });
}

/** Last close at or before `cutMs`. Throws if there is none (the tape must not look ahead). */
export function closeAt(bars, cutMs) {
  let best = null;
  for (const b of bars) { if (b.t <= cutMs && Number.isFinite(b.c)) { if (!best || b.t > best.t) best = b; } }
  if (!best) throw new Error(`no bar at or before ${new Date(cutMs).toISOString()}`);
  return best.c;
}

export function buildTape(spec, loadBars) {
  const bars = spec.cuts.map(cut => ({ t: cut.t, label: cut.label || '', prices: {} }));
  const instruments = {};
  for (const [id, ins] of Object.entries(spec.instruments)) {
    const series = loadBars(ins.bars, id).sort((a, b) => a.t - b.t);
    spec.cuts.forEach((cut, i) => { bars[i].prices[id] = closeAt(series, Date.parse(cut.t)); });
    instruments[id] = { name: ins.name, kind: ins.kind, currency: ins.currency || (spec.market === 'KR' ? 'KRW' : 'USD') };
  }
  const tape = { id: spec.id, title: spec.title, boss: spec.boss, bossSpecies: spec.bossSpecies, market: spec.market, example: false, settled: spec.settled !== false,
    daily: !!spec.daily, dailyRaid: spec.dailyRaid || undefined, headline: spec.headline || undefined, playDate: spec.playDate || undefined, source: spec.source || '', scale: spec.scale || undefined, event: spec.event || undefined,
    briefing: spec.briefing, lesson: spec.lesson, concepts: spec.concepts || [], instruments, skills: spec.skills, checkpoints: spec.checkpoints || [], bars };
  const errs = validateTape(tape);
  if (errs.length) throw new Error('tape invalid: ' + errs.join('; '));
  return tape;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const specPath = process.argv[2];
  if (!specPath) { console.error('usage: node scripts/tape-from-bars.mjs spec.json'); process.exit(1); }
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const base = dirname(resolve(specPath));
  const tape = buildTape(spec, rel => parseBars(readFileSync(resolve(base, rel), 'utf8')));
  process.stdout.write(JSON.stringify(tape, null, 1));
}
