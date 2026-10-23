import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceCache } from '../cache.js';
function storage() { let values = {}; return { get: async () => structuredClone(values), set: async v => { values = structuredClone(v); } }; }
test('coalesces concurrent loads and restores persisted cache after worker restart', async () => {
  const store = storage(), cache = new ResourceCache(store);
  let calls = 0, resolve;
  const loader = () => { calls++; return new Promise(r => { resolve = r; }); };
  const a = cache.get('AAPL', 60000, loader), b = cache.get('AAPL', 60000, loader);
  await new Promise(r => setTimeout(r, 0)); resolve({ price: 100 });
  assert.deepEqual(await a, await b); assert.equal(calls, 1);
  await cache.flush();
  const restored = new ResourceCache(store);
  assert.deepEqual((await restored.get('AAPL', 60000, () => { throw Error('should not load'); })).value, { price: 100 });
});
test('returns stale data on outage, applies cooldown, then recovers', async () => {
  let now = 0, calls = 0; const cache = new ResourceCache(storage(), { now: () => now });
  await cache.get('quote', 100, async () => 10);
  now = 101;
  const fail = async () => { calls++; throw Error('offline'); };
  assert.equal((await cache.get('quote', 100, fail)).stale, true);
  assert.equal((await cache.get('quote', 100, fail)).value, 10); assert.equal(calls, 1);
  now += 20001;
  assert.equal((await cache.get('quote', 100, async () => 20)).value, 20);
  await cache.flush();
});
test('bounds cache by entry count and byte budget', async () => {
  const cache = new ResourceCache(storage(), { limit: 2, maxBytes: 500 });
  for (const key of ['a', 'b', 'c']) await cache.get(key, 100, async () => key);
  assert.equal(cache.entries.size, 2); assert.equal(cache.entries.has('a'), false);
  await cache.get('huge', 100, async () => 'x'.repeat(1000)); assert.ok(cache.entries.size <= 2);
  assert.ok(JSON.stringify([...cache.entries]).length * 2 <= 500);
  await cache.flush();
});
test('a cache without data rejects failures and eventually retries', async () => {
  const cache = new ResourceCache(storage()); let calls = 0;
  const loader = async () => { calls++; throw Error('429'); };
  await assert.rejects(cache.get('none', 100, loader), /429/);
  await assert.rejects(cache.get('none', 100, loader), /429/); assert.equal(calls, 1);
});
test('synchronous loader failures do not leave a permanently stuck request', async () => {
  let now = 0;
  const cache = new ResourceCache(storage(), { now: () => now });
  await assert.rejects(cache.get('sync', 100, () => { throw Error('bad loader'); }), /bad loader/);
  assert.equal(cache.pending.size, 0);
  now = 20001;
  assert.equal((await cache.get('sync', 100, () => 42)).value, 42);
  await cache.flush();
});
