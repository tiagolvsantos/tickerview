import test from 'node:test';
import assert from 'node:assert/strict';
import '../research-data.js';
const { points, returnPercent, compare, coordinates } = globalThis.TickerViewResearch;
const day = (date, close, hour = '16:00') => ({ time: Date.parse(`${date}T${hour}:00Z`) / 1000, close });
const entry = (symbol, bars, timezone = 'America/New_York', interval = '1d') => ({ symbol, chart: { points: bars, timezone, interval } });

test('research returns retain zero prices and reject unusable baselines', () => {
  assert.equal(returnPercent(100, 0), -100);
  assert.equal(returnPercent(0, 100), null);
  assert.equal(returnPercent(100, Infinity), null);
  assert.equal(returnPercent(100, -10), null);
  assert.equal(returnPercent(100, 100), 0);
  assert.equal(points({ points: [{ time: 2, close: 0 }, { time: 1, close: 100 }, { time: 3, close: null }, { time: NaN, close: 1 }] }).length, 2);
  assert.equal(coordinates([4, 4], 100, 28), '0,14 100,14');
});

test('comparison aligns exchange-local dates across currencies without converting prices', () => {
  const result = compare([
    entry('US', [day('2026-10-20', 100, '20:00'), day('2026-10-21', 110, '20:00'), day('2026-10-22', 120, '20:00')]),
    entry('JP', [day('2026-10-20', 1000, '06:00'), day('2026-10-22', 900, '06:00'), day('2026-10-23', 950, '06:00')], 'Asia/Tokyo')
  ]);
  assert.deepEqual(result.keys, ['2026-10-20', '2026-10-22']);
  assert.equal(result.series[0].values[0], 0);
  assert.ok(Math.abs(result.series[0].values[1] - 20) < 1e-9);
  assert.ok(Math.abs(result.series[1].values[1] + 10) < 1e-9);
});

test('intraday comparison intersects exact timestamps and never bridges separate sessions', () => {
  const result = compare([
    entry('A', [{ time: 100, close: 10 }, { time: 200, close: 20 }, { time: 300, close: 30 }], 'UTC', '5m'),
    entry('B', [{ time: 150, close: 10 }, { time: 200, close: 10 }, { time: 300, close: 0 }], 'UTC', '5m')
  ]);
  assert.deepEqual(result.keys, ['200', '300']);
  assert.deepEqual(result.series[1].values, [0, -100]);
  assert.deepEqual(compare([entry('A', [{ time: 1, close: 1 }], 'UTC', '5m'), entry('B', [{ time: 2, close: 1 }], 'UTC', '5m')]).series, []);
});

test('comparison requires two observations after a shared positive baseline', () => {
  const result = compare([
    entry('A', [{ time: 1, close: 0 }, { time: 2, close: 10 }, { time: 3, close: 20 }], 'UTC', '5m'),
    entry('B', [{ time: 1, close: 10 }, { time: 2, close: 20 }, { time: 3, close: 30 }], 'UTC', '5m')
  ]);
  assert.deepEqual(result.keys, ['2', '3']);
  assert.equal(result.series[0].values[1], 100);
  assert.deepEqual(compare([entry('A', [day('2026-10-20', 1)]), entry('B', [day('2026-10-20', 1)])]).keys, []);
});
