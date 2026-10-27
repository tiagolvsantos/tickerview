import test from 'node:test';
import assert from 'node:assert/strict';
import '../shared.js';
const tv = globalThis.TickerView;
test('built-in aliases are case-insensitive and preserve literal symbols', () => {
  for (const [alias, target] of Object.entries(tv.builtinAliases)) {
    assert.equal(tv.resolveSymbol(` $${alias.toLowerCase()} `), target);
    assert.equal(tv.resolveSymbol(target), target);
  }
  assert.equal(tv.normalizeSymbol('BTC'), 'BTC');
  assert.equal(tv.resolveSymbol('BRK.B'), 'BRK-B'); assert.equal(tv.resolveSymbol('7203.T'), '7203.T');
  assert.equal(tv.resolveSymbol('ES=F'), 'ES=F');
  for (const bad of ['$5B', '$500M', '$5.8B']) assert.throws(() => tv.resolveSymbol(bad));
});
test('custom aliases override without chaining and reset to built-ins', () => {
  tv.setAliases({ BTC: 'ETH-USD', COIN: 'BTC' });
  assert.equal(tv.resolveSymbol('BTC'), 'ETH-USD'); assert.equal(tv.resolveSymbol('COIN'), 'BTC');
  assert.equal(tv.normalizeSymbol('BTC'), 'BTC');
  tv.setAliases({}); assert.equal(tv.resolveSymbol('BTC'), 'BTC-USD');
});
test('sorting retains saved order, sorts missing last and breaks ties by symbol', () => {
  const list = ['Z', 'B', 'A', 'C']; const quotes = { Z: { name: 'Zulu', changePercent: -1 }, B: { name: 'Beta', changePercent: 0 }, A: { name: 'Alpha', changePercent: 0 } };
  assert.deepEqual(tv.sortSymbols(list, quotes, 'saved'), list);
  assert.deepEqual(tv.sortSymbols(list, quotes, 'symbol'), ['A', 'B', 'C', 'Z']);
  assert.deepEqual(tv.sortSymbols(list, quotes, 'company'), ['A', 'B', 'Z', 'C']);
  assert.deepEqual(tv.sortSymbols(list, quotes, 'change-desc'), ['A', 'B', 'Z', 'C']);
  assert.deepEqual(tv.sortSymbols(list, quotes, 'change-asc'), ['Z', 'A', 'B', 'C']);
  assert.deepEqual(list, ['Z', 'B', 'A', 'C']);
});
test('header sort modes support descending symbols and numeric prices with missing last', () => {
  const list = ['A', 'B', 'C', 'D'], quotes = { A: { price: 30 }, B: { price: 0 }, C: { price: 20 } };
  assert.deepEqual(tv.sortSymbols(list, quotes, 'price-desc'), ['A', 'C', 'B', 'D']);
  assert.deepEqual(tv.sortSymbols(list, quotes, 'price-asc'), ['B', 'C', 'A', 'D']);
  assert.deepEqual(tv.sortSymbols(list, quotes, 'symbol-desc'), ['D', 'C', 'B', 'A']);
  assert.deepEqual(tv.dashboardPreferences(), { autoRefresh: true, refreshInterval: 5, windowMode: 'remember' });
});
