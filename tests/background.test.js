import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const metaHTML = await readFile(new URL('./fixtures/yahoo-meta.html', import.meta.url), 'utf8');
let listener, launch, values = {}, requests = [], createdWindows = [], updatedWindows = [], updatedTabs = [];
globalThis.chrome = {
  action: { onClicked: { addListener: fn => { launch = fn; } } },
  windows: { create: async options => { createdWindows.push(options); return { id: 55 }; }, get: async () => ({ tabs: [{ id: 77 }] }), update: async (id, options) => { updatedWindows.push({ id, ...options }); } },
  tabs: { update: async (id, options) => { updatedTabs.push({ id, ...options }); } },
  runtime: { getURL: path => `chrome-extension://test-extension/${path}`, id: 'test-extension', onMessage: { addListener: fn => { listener = fn; } } },
  storage: { local: { get: async () => structuredClone(values), set: async v => { Object.assign(values, structuredClone(v)); } } }
};
const times = ['2026-10-21T13:30Z', '2026-10-22T13:30Z', '2026-10-23T13:30Z'].map(x => Date.parse(x) / 1000);
function chart(symbol) { return { chart: { result: [{ meta: { symbol, regularMarketTime: times[2] + 1000, regularMarketPrice: 110, previousClose: 100, exchangeTimezoneName: 'America/New_York' }, timestamp: times, indicators: { quote: [{ close: [90, 100, 110], high: [91, 101, 111], low: [89, 99, 109], open: [90, 100, 110], volume: [100, 100, 100] }] } }] } }; }
globalThis.fetch = async (url, options) => {
  requests.push(url);
  assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
  await new Promise(r => setTimeout(r, 5));
  if (url.startsWith('https://finance.yahoo.com/quote/')) return url.includes('/META/') ? { ok: true, text: async () => metaHTML } : { ok: false, status: 503 };
  if (url.includes('/NOTREAL?')) return { ok: true, json: async () => ({ chart: { result: null, error: { description: 'No data found' } } }) };
  if (url.includes('quoteSummary')) return { ok: false, status: 401 };
  if (url.includes('/search')) return { ok: true, json: async () => ({ quotes: [{ symbol: 'AAPL', longname: 'Apple Inc.', sector: 'Technology' }], news: [] }) };
  if (url.includes('/XLK?') || url.includes('/FAIL?') && url.includes('5m')) throw Error('offline');
  return { ok: true, json: async () => chart(decodeURIComponent(url.split('/chart/')[1].split('?')[0])) };
};
await import('../background.js');
const send = request => new Promise(resolve => listener(request, { id: 'test-extension' }, resolve));
test('worker coalesces simultaneous quote requests and rejects invalid symbols', async () => {
  const [a, b] = await Promise.all([send({ action: 'base', ticker: 'AAPL' }), send({ action: 'base', ticker: '$aapl' })]);
  assert.equal(a.success, true); assert.deepEqual(a, b);
  assert.equal(requests.filter(u => u.includes('/AAPL?') && u.includes('5m')).length, 1);
  assert.equal((await send({ action: 'base', ticker: '../BAD' })).success, false);
});
test('worker preserves partial details when fundamentals and sector provider fail', async () => {
  const data = await send({ action: 'details', ticker: 'AAPL' });
  assert.equal(data.success, true); assert.equal(data.quote.longName, 'Apple Inc.');
  assert.equal(data.quote.sectorEtf, 'XLK'); assert.equal(data.benchmarks.spy.change, 10);
  assert.equal(data.benchmarks.sector, null);
  assert.deepEqual(data.issues, ['Fundamentals providers unavailable for this symbol', 'Sector benchmark unavailable']);
});
test('worker returns daily fallback when intraday fails', async () => {
  const data = await send({ action: 'base', ticker: 'FAIL' });
  assert.equal(data.success, true); assert.equal(data.status.fallback, true); assert.equal(data.chart.interval, '1d');
});
test('worker serializes watchlist updates and retains concurrent settings edits', async () => {
  await Promise.all(['AAPL', 'MSFT', 'BRK.B'].map(ticker => send({ action: 'watch', ticker })));
  assert.deepEqual(new Set(values.watchlist), new Set(['AAPL', 'MSFT', 'BRK-B']));
  await Promise.all([send({ action: 'settings', patch: { compact: true } }), send({ action: 'settings', site: 'x.com', siteEnabled: false })]);
  assert.equal(values.settings.compact, true); assert.deepEqual(values.settings.disabledSites, ['x.com']);
  await Promise.all(Array.from({ length: 20 }, (_, i) => send({ action: 'recent', ticker: `T${i}` })));
  assert.equal(values.recent.length, 12); assert.equal(values.recent[0], 'T19');
});
test('worker accepts only supported chart ranges and own extension messages', async () => {
  assert.equal((await send({ action: 'chart', ticker: 'AAPL', range: 'BAD' })).success, false);
  let called = false;
  assert.equal(listener({ action: 'base', ticker: 'AAPL' }, { id: 'external' }, () => { called = true; }), false);
  assert.equal(called, false);
});

test('fundamentals use the public statistics payload without authenticated summary requests', async () => {
  const meta = await send({ action: 'details', ticker: 'META' });
  assert.equal(meta.success, true); assert.equal(meta.quote.marketCap, 1652949385216);
  assert.equal(meta.quote.shortFloatPct, 1.52); assert.equal(meta.quote.shortRatio, 1.44);
  assert.equal(meta.quote.targetMean, 843.48); assert.equal(meta.sources.profile.provider, 'Yahoo Finance');
  assert.equal(meta.issues.includes('Fundamentals providers unavailable for this symbol'), false);
  assert.equal(requests.some(url => url.includes('quoteSummary')), false);
});
test('library migrates old currency matches and returns cached snapshots without network traffic', async () => {
  values.recent = ['5B', 'META', '39B', '7203.T', 'META'];
  values.watchlist = ['AAPL', 'BRK.B'];
  const before = requests.length;
  const data = await send({ action: 'library' });
  assert.deepEqual(data.recent, ['META', '7203.T']); assert.deepEqual(values.recent, data.recent);
  assert.deepEqual(data.watchlist, ['AAPL', 'BRK-B']); assert.equal(data.snapshots.AAPL.price, 110);
  assert.equal(requests.length, before);
});
test('manual addition validates data before saving, rejects amounts, and explicit save is idempotent', async () => {
  const amount = await send({ action: 'addWatch', ticker: '5B' }); assert.equal(amount.success, false);
  const unknown = await send({ action: 'addWatch', ticker: 'NOTREAL' }); assert.equal(unknown.success, false); assert.equal(values.watchlist.includes('NOTREAL'), false);
  const added = await send({ action: 'addWatch', ticker: 'META' }); assert.equal(added.success, true);
  assert.ok(values.watchlist.includes('META'));
  await send({ action: 'watch', ticker: 'META', saved: true }); assert.equal(values.watchlist.filter(x => x === 'META').length, 1);
  await send({ action: 'watch', ticker: 'META', saved: false }); assert.equal(values.watchlist.includes('META'), false);
  const saved = [...values.watchlist]; await send({ action: 'clearRecent' });
  assert.deepEqual(values.recent, []); assert.deepEqual(values.watchlist, saved);
});

test('valuation assumptions are normalized, validated, serialized and bounded per stock', async () => {
  const assumptions = { bear: 10, base: 20, bull: 30 };
  await Promise.all(['BRK.B', 'MSFT'].map(ticker => send({ action: 'saveValuation', ticker, assumptions })));
  assert.deepEqual(values.valuationScenarios['BRK-B'], assumptions);
  assert.deepEqual(values.valuationScenarios.MSFT, assumptions);
  assert.equal((await send({ action: 'saveValuation', ticker: 'MSFT', assumptions: { bear: 40, base: 20, bull: 30 } })).success, false);
  assert.deepEqual(values.valuationScenarios.MSFT, assumptions);
  await send({ action: 'resetValuation', ticker: 'BRK.B' });
  assert.equal(Object.hasOwn(values.valuationScenarios, 'BRK-B'), false);
  for (let i = 0; i < 101; i++) await send({ action: 'saveValuation', ticker: `VAL${i}`, assumptions });
  assert.equal(Object.keys(values.valuationScenarios).length, 100);
  assert.equal(Object.hasOwn(values.valuationScenarios, 'VAL0'), false);
});

test('toolbar directly opens and reuses a full-height launcher with the source site', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.action.default_popup, undefined);
  await launch({ url: 'https://x.com/i/tweetdeck' });
  assert.equal(createdWindows.length, 1);
  assert.equal(createdWindows[0].type, 'popup');
  assert.equal(new URL(createdWindows[0].url).searchParams.get('expanded'), '1');
  assert.equal(new URL(createdWindows[0].url).searchParams.get('site'), 'x.com');
  await launch({ url: 'chrome://extensions/' });
  assert.equal(createdWindows.length, 1);
  assert.equal(new URL(updatedTabs.at(-1).url).searchParams.has('site'), false);
  assert.deepEqual(updatedWindows.at(-1), { id: 55, focused: true });
});
