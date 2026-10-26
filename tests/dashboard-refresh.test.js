import test from 'node:test';
import assert from 'node:assert/strict';
let now = Date.parse('2026-10-23T17:00:00Z'), listener, calls = 0;
Date.now = () => now;
const values = { watchlist: ['AAPL'], dashboardPreferences: { autoRefresh: true, refreshInterval: 15, windowMode: 'remember' }, aliasMigration: 1 };
globalThis.chrome = {
  storage: { local: { get: async () => structuredClone(values), set: async patch => Object.assign(values, structuredClone(patch)) } },
  runtime: { id: 'dashboard-test', onMessage: { addListener: fn => { listener = fn; } } }, action: { onClicked: { addListener() {} } }
};
globalThis.fetch = async url => {
  calls++; const symbol = decodeURIComponent(url.split('/chart/')[1].split('?')[0]);
  return { ok: true, json: async () => ({ chart: { result: [{ meta: { symbol, regularMarketTime: now / 1000, regularMarketPrice: 100 + calls, previousClose: 100 }, timestamp: [now / 1000], indicators: { quote: [{ close: [100 + calls], volume: [1] }] } }] } }) };
};
await import('../background.js');
const send = request => new Promise(resolve => listener(request, { id: 'dashboard-test' }, resolve));
test('automatic quote freshness follows configured seconds and manual refresh bypasses fresh cache', async () => {
  await send({ action: 'refreshDashboard' }); assert.equal(calls, 6);
  now += 14999; await send({ action: 'refreshDashboard' }); assert.equal(calls, 6);
  now++; await send({ action: 'refreshDashboard' }); assert.equal(calls, 11);
  now += 1000; await send({ action: 'refreshDashboard', force: true }); assert.equal(calls, 16);
  await send({ action: 'setDashboardPreferences', patch: { refreshInterval: 30 } });
  now += 15000; await send({ action: 'refreshDashboard' }); assert.equal(calls, 16);
  now += 15000; await send({ action: 'refreshDashboard' }); assert.equal(calls, 21);
  assert.equal((await send({ action: 'setDashboardPreferences', patch: { refreshInterval: 1 } })).success, false);
});
