import test from 'node:test';
import assert from 'node:assert/strict';
import '../shared.js';
const { valuation, valuationAssumptions } = TickerView;
const quote = { instrumentType: 'EQUITY', currency: 'USD', regularMarketPrice: 100, fundamentals: { trailingEps: 4, quoteCurrency: 'USD' }, targetLow: 90, targetMean: 120, targetHigh: 140 };
test('earnings scenarios use EPS and independent assumptions, with quote-relative differences', () => {
  const result = valuation(quote);
  assert.deepEqual(result.scenarios.map(x => x.value), [60, 80, 100]);
  assert.equal(result.scenarios[0].difference, -40);
  assert.equal(result.scenarios[2].difference, 0);
  assert.ok(Math.abs(result.targets[1].difference - 20) < 1e-10);
  assert.equal(valuation({ ...quote, trailingPE: 999 }).scenarios[1].value, 80);
  assert.equal(valuation(quote, { bear: 10, base: 30, bull: 40 }).scenarios[1].value, 120);
});
test('rejects incomplete, nonfinite, unordered and out-of-range assumptions', () => {
  for (const value of [null, {}, { bear: 0, base: 20, bull: 25 }, { bear: '15', base: 20, bull: 25 }, { bear: 15, base: NaN, bull: 25 }, { bear: 15, base: 20, bull: Infinity }, { bear: 15, base: 20, bull: 201 }, { bear: 25, base: 20, bull: 15 }]) assert.throws(() => valuationAssumptions(value));
  assert.deepEqual(valuationAssumptions({ bear: .01, base: 200, bull: 200 }), { bear: .01, base: 200, bull: 200 });
});
test('ineligible earnings do not discard analyst targets', () => {
  for (const eps of [-2, 0, null, undefined, NaN, Infinity]) {
    const result = valuation({ ...quote, fundamentals: { ...quote.fundamentals, trailingEps: eps } });
    assert.equal(result.scenarios.length, 0); assert.equal(result.targets.length, 3); assert.match(result.reason, /positive trailing/);
  }
  for (const type of ['ETF', 'INDEX', null]) assert.equal(valuation({ ...quote, instrumentType: type }).scenarios.length, 0);
});
test('currency and quote validation avoid invalid comparisons and preserve valid partial targets', () => {
  for (const currency of ['EUR', 'usd', null, '']) {
    const result = valuation({ ...quote, currency });
    assert.equal(result.scenarios.length, 0); assert.equal(result.targets.length, 0);
  }
  assert.equal(valuation({ ...quote, currency: 'GBp', fundamentals: { trailingEps: 4, quoteCurrency: 'GBP' } }).scenarios.length, 0);
  const noPrice = valuation({ ...quote, regularMarketPrice: 0 });
  assert.equal(noPrice.scenarios.length, 0); assert.equal(noPrice.targets[0].difference, null);
  const partial = valuation({ ...quote, targetLow: -1, targetHigh: NaN });
  assert.equal(partial.targets.length, 1); assert.equal(partial.targets[0].label, 'Mean');
});
