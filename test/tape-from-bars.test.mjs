import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBars, closeAt, buildTape } from '../scripts/tape-from-bars.mjs';

const T = (h, m = 0) => Date.parse(`2026-10-29T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`);

test('parseBars accepts JSON and CSV', () => {
  const j = parseBars(JSON.stringify([{ t: '2026-10-29T02:00:00+09:00', c: 100 }, { t: '2026-10-29T02:01:00+09:00', c: 101 }]));
  assert.equal(j.length, 2); assert.equal(j[1].c, 101);
  const c = parseBars('time,open,high,low,close\n2026-10-29T02:00:00+09:00,1,1,1,100\n2026-10-29T02:01:00+09:00,1,1,1,102');
  assert.equal(c[1].c, 102);
  assert.throws(() => parseBars('a,b\n1,2'), /time and close/);
});

test('closeAt never looks ahead', () => {
  const bars = [{ t: T(2, 0), c: 100 }, { t: T(2, 1), c: 101 }, { t: T(2, 31), c: 105 }];
  assert.equal(closeAt(bars, T(2, 30)), 101);   // 02:31 bar is in the future
  assert.equal(closeAt(bars, T(2, 31)), 105);
  assert.throws(() => closeAt(bars, T(1, 0)), /no bar/);
});

test('buildTape samples each instrument at each cut and validates', () => {
  const spec = {
    id: 'x', title: 'x', boss: 'x', bossSpecies: 'golem', market: 'US', briefing: '', lesson: '',
    cuts: [{ t: '2026-10-29T02:00:00+09:00', label: 'a' }, { t: '2026-10-29T02:30:00+09:00', label: 'b' }],
    instruments: { QQQ: { name: 'q', kind: 'etf', bars: 'q' }, BIL: { name: 'b', kind: 'cash', bars: 'b' } },
    skills: [{ id: 'd', role: 'dealer', instrument: 'QQQ', name: 'd', default: true }, { id: 't', role: 'tank', instrument: 'BIL', name: 't', default: true },
      { id: 'h', role: 'healer', instrument: 'BIL', name: 'h', default: true }, { id: 's', role: 'support', instrument: 'QQQ', name: 's', default: true }],
    checkpoints: [{ bar: 1, title: 'c', hint: '' }],
  };
  const series = { q: [{ t: T(1, 59), c: 480 }, { t: T(2, 29), c: 482 }, { t: T(2, 30), c: 483 }], b: [{ t: T(1, 0), c: 91.5 }] };
  const tape = buildTape(spec, key => series[key]);
  assert.deepEqual(tape.bars.map(b => b.prices.QQQ), [480, 483]);
  assert.deepEqual(tape.bars.map(b => b.prices.BIL), [91.5, 91.5]);
  assert.equal(tape.example, false);
  spec.instruments.QQQ.bars = 'missing';
  assert.throws(() => buildTape(spec, key => series[key] || []), /no bar/);
});
