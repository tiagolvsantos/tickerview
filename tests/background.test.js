import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const metaHTML = await readFile(new URL('./fixtures/yahoo-meta.html', import.meta.url), 'utf8');
let listener, launch, values = {}, requests = [], createdWindows = [], updatedWindows = [], updatedTabs = [], launcherMessages = [], command;
globalThis.chrome = {
  commands: { onCommand: { addListener: fn => { command = fn; } } },
  action: { onClicked: { addListener: fn => { launch = fn; } } },
  windows: { getAll: async () => [], create: async options => { createdWindows.push(options); return { id: 55 }; }, get: async () => ({ tabs: [{ id: 77 }] }), update: async (id, options) => { updatedWindows.push({ id, ...options }); } },
  tabs: { query: async () => [{ url: 'https://x.com/' }], update: async (id, options) => { updatedTabs.push({ id, ...options }); } },
  runtime: { sendMessage: async message => { launcherMessages.push(message); }, getURL: path => `chrome-extension://test-extension/${path}`, id: 'test-extension', onMessage: { addListener: fn => { listener = fn; } } },
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
  assert.deepEqual(data.watchlist, ['AAPL', 'BRK-B']); assert.equal(data.snapshots.AAPL.price, 110); assert.equal(data.snapshots.AAPL.change, 10);
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
  assert.equal(updatedTabs.length, 0);
  assert.equal(launcherMessages.at(-1).site, null);
  assert.deepEqual(updatedWindows.at(-1), { id: 55, focused: true });
});

test('aliases validate literal targets, override built-ins, and never chain', async () => {
  const added = await send({ action: 'saveAlias', alias: '$coin', target: 'BTC-USD' });
  assert.equal(added.customAliases.COIN, 'BTC-USD');
  await send({ action: 'saveAlias', alias: 'BTC', target: 'ETH-USD' });
  assert.equal((await send({ action: 'addWatch', ticker: 'btc' })).quote.symbol, 'ETH-USD');
  await send({ action: 'saveAlias', alias: 'COIN', target: 'BTC' });
  assert.equal((await send({ action: 'addWatch', ticker: 'COIN' })).quote.symbol, 'BTC');
  assert.equal((await send({ action: 'saveAlias', alias: '5B', target: 'AAPL' })).success, false);
  assert.equal((await send({ action: 'saveAlias', alias: 'BAD', target: 'NOTREAL' })).success, false);
  await send({ action: 'deleteAlias', alias: 'BTC' });
  assert.equal((await send({ action: 'addWatch', ticker: 'btc' })).quote.symbol, 'BTC-USD');
  await send({ action: 'resetAliases' }); assert.deepEqual(values.customAliases, {});
});
test('one-time alias migration deduplicates lists without moving assumptions or snapshots', async () => {
  values.aliasMigration = undefined; values.watchlist = ['BTC', 'BTC-USD', 'VIX', '^VIX']; values.recent = ['SPX', '^GSPC'];
  values.valuationScenarios.BTC = { bear: 1, base: 2, bull: 3 };
  const result = await send({ action: 'library' });
  assert.deepEqual(result.watchlist, ['BTC-USD', '^VIX']); assert.deepEqual(result.recent, ['^GSPC']);
  assert.ok(values.valuationScenarios.BTC);
  await send({ action: 'saveAlias', alias: 'VIX', target: 'AAPL' });
  assert.deepEqual((await send({ action: 'library' })).watchlist, result.watchlist);
  await send({ action: 'resetAliases' });
});
test('notes detect concurrent writes, delete explicitly, persist without watchlist membership, and enforce limits', async () => {
  values.tickerNotes = {};
  const a = await send({ action: 'saveNote', ticker: 'BTC-USD', text: '<script>thesis</script>', revision: null });
  assert.equal(a.success, true); assert.ok(a.note.revision);
  const conflict = await send({ action: 'saveNote', ticker: 'BTC-USD', text: 'stale draft', revision: null });
  assert.equal(conflict.conflict, true); assert.equal(conflict.note.text, '<script>thesis</script>');
  const b = await send({ action: 'saveNote', ticker: 'BTC-USD', text: 'new thesis', revision: a.note.revision });
  await send({ action: 'watch', ticker: 'BTC-USD', saved: false });
  assert.equal((await send({ action: 'getNote', ticker: 'BTC-USD' })).note.text, 'new thesis');
  assert.equal((await send({ action: 'saveNote', ticker: 'BTC-USD', text: 'x'.repeat(4001), revision: b.note.revision })).success, false);
  await send({ action: 'saveNote', ticker: 'BTC-USD', text: '', revision: b.note.revision });
  assert.equal(Object.hasOwn(values.tickerNotes, 'BTC-USD'), false);
  for (let i = 0; i < 100; i++) await send({ action: 'saveNote', ticker: `NOTE${i}`, text: 'note', revision: null });
  assert.equal((await send({ action: 'saveNote', ticker: 'FULL', text: 'note', revision: null })).success, false);
  assert.equal(Object.keys(values.tickerNotes).length, 100);
});
test('refresh limits concurrent requests to three, coalesces refreshes, and preserves saved membership on failures', async () => {
  values.watchlist = ['REF1', 'REF2', 'NOTREAL', 'REF3', 'REF4'];
  const original = fetch; let active = 0, peak = 0;
  globalThis.fetch = async (...args) => { active++; peak = Math.max(peak, active); try { return await original(...args); } finally { active--; } };
  try {
    const [a, b] = await Promise.all([send({ action: 'refreshWatchlist' }), send({ action: 'refreshWatchlist' })]);
    assert.deepEqual(a, b); assert.equal(Object.keys(a.outcomes).length, 5); assert.ok(a.outcomes.NOTREAL.error);
    assert.ok(peak <= 3); assert.ok(peak > 1); assert.equal(values.watchRefresh.completed, 5);
    assert.equal(values.watchlist.length, 5);
    assert.equal(requests.filter(url => url.includes('/REF1?') && url.includes('interval=5m')).length, 1);
  } finally { globalThis.fetch = original; }
});
test('keyboard command reuses launcher without navigating its tab', async () => {
  await command('open-search'); assert.equal(launcherMessages.at(-1).focusSearch, true);
  assert.equal(updatedTabs.length, 0); assert.equal(createdWindows.length, 1);
});

test('launcher discovers an existing window after losing its worker-local window id', async () => {
  const get = chrome.windows.get, getAll = chrome.windows.getAll;
  chrome.windows.get = async () => { throw new Error('Old window no longer exists'); };
  chrome.windows.getAll = async () => [{ id: 88, tabs: [{ url: chrome.runtime.getURL('popup.html') + '?expanded=1' }] }];
  try {
    await command('open-search');
    assert.equal(createdWindows.length, 1); assert.equal(launcherMessages.at(-1).windowId, 88);
    assert.deepEqual(updatedWindows.at(-1), { id: 88, focused: true });
  } finally { chrome.windows.get = get; chrome.windows.getAll = getAll; }
});

test('backup preview is read-only; restore is atomic, offline, and resets note revisions', async () => {
  values.valuationScenarios = { AAPL: { bear: 10, base: 20, bull: 30 } };
  values.watchlist = ['BTC-USD']; values.tickerNotes = { 'BTC-USD': { text: 'original note', revision: 'before-import' } };
  const beforeRequests = requests.length;
  const exported = await send({ action: 'exportBackup' }); assert.equal(exported.success, true);
  const backup = exported.backup; backup.data.watchlist = ['ETH-USD']; backup.data.tickerNotes['BTC-USD'] = 'imported note';
  const json = JSON.stringify(backup), before = structuredClone(values);
  const preview = await send({ action: 'previewImport', json, mode: 'merge' });
  assert.equal(preview.success, true); assert.equal(preview.summary.watchlist.total, 2); assert.deepEqual(values, before);
  const imported = await send({ action: 'importBackup', json, mode: 'merge' }); assert.equal(imported.success, true);
  assert.deepEqual(values.watchlist, ['BTC-USD', 'ETH-USD']); assert.equal(values.tickerNotes['BTC-USD'].text, 'imported note');
  const staleSave = await send({ action: 'saveNote', ticker: 'BTC-USD', text: 'old open draft', revision: 'before-import' }); assert.equal(staleSave.conflict, true);
  await send({ action: 'importBackup', json, mode: 'replace' }); assert.deepEqual(values.watchlist, ['ETH-USD']);
  assert.equal(requests.length, beforeRequests);
});
test('backup rejects invalid JSON, future versions, oversized files and over-limit merges before writing', async () => {
  const exported = await send({ action: 'exportBackup' });
  const before = structuredClone(values);
  for (const json of ['{', JSON.stringify({ ...exported.backup, version: 99 }), ' '.repeat(2 * 1024 * 1024 + 1)]) {
    assert.equal((await send({ action: 'importBackup', json, mode: 'replace' })).success, false); assert.deepEqual(values, before);
  }
  values.watchlist = Array.from({ length: 100 }, (_, i) => `LIMIT${i}`);
  const full = structuredClone(values);
  assert.equal((await send({ action: 'importBackup', json: JSON.stringify(exported.backup), mode: 'merge' })).success, false); assert.deepEqual(values, full);
});

test('overview and dashboard refresh share a three-request queue without saving overview-only symbols', async () => {
  values.watchlist = ['OV1', 'OV2', 'SPY']; values.recent = ['AAPL']; values.quoteSnapshots = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`Q${i}`, { price: i }]));
  const original = fetch; let active = 0, peak = 0;
  globalThis.fetch = async (...args) => { active++; peak = Math.max(peak, active); try { return await original(...args); } finally { active--; } };
  try {
    const [overview, dashboard] = await Promise.all([send({ action: 'overview' }), send({ action: 'refreshDashboard' })]);
    assert.equal(overview.success, true); assert.equal(dashboard.success, true);
    assert.deepEqual(Object.keys(dashboard.outcomes).sort(), ['SPY', 'QQQ', '^VIX', 'BTC-USD', 'OV1', 'OV2'].sort());
    assert.deepEqual(Object.keys(values.marketOverview).sort(), ['SPY', 'QQQ', '^VIX', 'BTC-USD'].sort());
    assert.ok(peak <= 3); assert.ok(peak > 0);
    assert.equal(Object.hasOwn(values.quoteSnapshots, 'QQQ'), false); assert.equal(Object.hasOwn(values.quoteSnapshots, '^VIX'), false);
    assert.equal(Object.hasOwn(values.quoteSnapshots, 'BTC-USD'), false); assert.equal(values.quoteSnapshots.SPY.price, 110);
    assert.deepEqual(values.watchlist, ['OV1', 'OV2', 'SPY']); assert.deepEqual(values.recent, ['AAPL']);
    const before = requests.length; await send({ action: 'overview' }); assert.equal(requests.length, before);
  } finally { globalThis.fetch = original; }
});
test('market window preferences validate and manual bounds select remembered sizing', async () => {
  assert.equal((await send({ action: 'setDashboardPreferences', patch: { autoRefresh: 'yes' } })).success, false);
  await send({ action: 'setDashboardPreferences', patch: { autoRefresh: true, refreshInterval: 15, windowMode: 'fit' } });
  assert.deepEqual(values.dashboardPreferences, { autoRefresh: true, refreshInterval: 15, windowMode: 'fit' });
  await send({ action: 'saveWindowBounds', bounds: { width: 620, height: 760, left: 12, top: 20 }, manual: true });
  assert.equal(values.dashboardPreferences.windowMode, 'remember'); assert.equal(values.dashboardPreferences.autoRefresh, true);
  const get = chrome.windows.get, getAll = chrome.windows.getAll;
  chrome.windows.get = async () => { throw new Error('closed'); }; chrome.windows.getAll = async () => [];
  try { await launch({ url: 'https://x.com/' }); assert.deepEqual({ ...createdWindows.at(-1), url: undefined }, { url: undefined, type: 'popup', width: 620, height: 760, left: 12, top: 20 }); }
  finally { chrome.windows.get = get; chrome.windows.getAll = getAll; }
});

test('undo inserts into current saved order, validates indices, and preserves concurrent additions', async () => {
  values.watchlist = ['AAPL', 'MSFT', 'GOOG'];
  await send({ action: 'watch', ticker: 'MSFT', saved: false });
  await send({ action: 'watch', ticker: 'NVDA', saved: true });
  assert.equal((await send({ action: 'watch', ticker: 'MSFT', saved: true, index: 1 })).success, true);
  assert.deepEqual(values.watchlist, ['NVDA', 'MSFT', 'AAPL', 'GOOG']);
  await send({ action: 'watch', ticker: 'MSFT', saved: true, index: 0 });
  assert.deepEqual(values.watchlist, ['NVDA', 'MSFT', 'AAPL', 'GOOG']);
  for (const index of [-1, 100, 1.5, '1', null]) {
    assert.equal((await send({ action: 'watch', ticker: 'TSLA', saved: true, index })).success, false);
  }
  values.watchlist = Array.from({ length: 100 }, (_, i) => `SYM${i}`);
  assert.equal((await send({ action: 'watch', ticker: 'TSLA', saved: true, index: 1 })).success, false);
});

test('card section preferences validate, merge, and remain outside backup data', async () => {
  values.cardSections = { note: true, unknown: true, fundamentals: 'yes' };
  assert.equal((await send({ action: 'setCardSection', section: 'news', open: true })).success, true);
  assert.deepEqual(values.cardSections, { note: true, news: true });
  await Promise.all([
    send({ action: 'setCardSection', section: 'valuation', open: false }),
    send({ action: 'setCardSection', section: 'guide', open: true })
  ]);
  assert.deepEqual(values.cardSections, { note: true, news: true, valuation: false, guide: true });
  for (const request of [{ section: 'unknown', open: true }, { section: 'news', open: 'yes' }, { section: '__proto__', open: false }]) {
    assert.equal((await send({ action: 'setCardSection', ...request })).success, false);
  }
  const exported = await send({ action: 'exportBackup' });
  assert.equal(exported.success, true); assert.equal(exported.backup.data.cardSections, undefined);
});

test('targeted dashboard refresh validates subsets, skips removed symbols, and retains cooldowns', async () => {
  values.watchlist = ['RETRY1', 'RETRY2', 'NOTREAL'];
  const before = requests.length;
  const [a, b] = await Promise.all([
    send({ action: 'refreshDashboard', force: true, symbols: ['RETRY1', 'NOTREAL', 'REMOVED'] }),
    send({ action: 'refreshDashboard', force: true, symbols: ['REMOVED', 'NOTREAL', 'RETRY1'] })
  ]);
  assert.equal(a.success, true); assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a.outcomes).sort(), ['NOTREAL', 'RETRY1']);
  assert.equal(requests.slice(before).some(url => /RETRY2|REMOVED|SPY/.test(url)), false);
  assert.equal(requests.slice(before).filter(url => url.includes('/RETRY1?') && url.includes('interval=5m')).length, 1);
  const failedRequests = requests.filter(url => url.includes('/NOTREAL?')).length;
  await send({ action: 'refreshDashboard', force: true, symbols: ['NOTREAL'] });
  assert.equal(requests.filter(url => url.includes('/NOTREAL?')).length, failedRequests);
  for (const symbols of [[], null, 'RETRY1', ['../BAD'], [null], Array(105).fill('RETRY1')]) {
    assert.equal((await send({ action: 'refreshDashboard', symbols })).success, false);
  }
});

test('watchlist moves preserve membership and concurrent edits, validate targets, and export saved order', async () => {
  values.watchlist = ['AAPL', 'BRK-B', 'MSFT']; values.watchSort = 'price-desc';
  const moved = await send({ action: 'moveWatch', ticker: 'BRK.B', target: 'MSFT', position: 'after' });
  assert.equal(moved.success, true); assert.deepEqual(values.watchlist, ['AAPL', 'MSFT', 'BRK-B']); assert.equal(values.watchSort, 'saved');
  await send({ action: 'moveWatch', ticker: 'BRK-B', target: 'AAPL', position: 'before' });
  assert.deepEqual(values.watchlist, ['BRK-B', 'AAPL', 'MSFT']);
  await send({ action: 'moveWatch', ticker: 'AAPL', target: 'AAPL', position: 'after' });
  assert.deepEqual(values.watchlist, ['BRK-B', 'AAPL', 'MSFT']);
  await Promise.all([
    send({ action: 'watch', ticker: 'NVDA', saved: true }),
    send({ action: 'moveWatch', ticker: 'MSFT', target: 'BRK-B', position: 'before' })
  ]);
  assert.deepEqual(values.watchlist, ['NVDA', 'MSFT', 'BRK-B', 'AAPL']);
  for (const patch of [{ target: 'MISSING' }, { ticker: 'MISSING' }, { ticker: '../BAD' }, { position: 'first' }, { target: null }]) {
    assert.equal((await send({ action: 'moveWatch', ticker: 'AAPL', target: 'MSFT', position: 'before', ...patch })).success, false);
  }
  const [removed, staleMove] = await Promise.all([
    send({ action: 'watch', ticker: 'MSFT', saved: false }),
    send({ action: 'moveWatch', ticker: 'AAPL', target: 'MSFT', position: 'after' })
  ]);
  assert.equal(removed.success, true); assert.equal(staleMove.success, false);
  assert.deepEqual(values.watchlist, ['NVDA', 'BRK-B', 'AAPL']);
  const exported = await send({ action: 'exportBackup' });
  assert.deepEqual(exported.backup.data.watchlist, values.watchlist); assert.equal(exported.backup.data.watchSort, 'saved');
});

test('watchlist indicators use cached daily history and failures preserve successful quote data', async () => {
  values.watchlist = ['INDGOOD', 'INDBAD'];
  const original = fetch;
  globalThis.fetch = async (url, options) => {
    if (url.includes('/INDBAD?') && url.includes('interval=1d')) throw new Error('History unavailable');
    return original(url, options);
  };
  try {
    const result = await send({ action: 'refreshDashboard', force: true, symbols: ['INDGOOD', 'INDBAD'] });
    assert.equal(result.success, true); assert.equal(result.outcomes.INDBAD.error, null);
    assert.equal(values.quoteSnapshots.INDBAD.price, 110);
    assert.match(values.quoteSnapshots.INDBAD.quickIndicators.error, /History unavailable/);
    const good = values.quoteSnapshots.INDGOOD.quickIndicators;
    assert.equal(good.ytdVwap, 100); assert.equal(good.rsi, null);
    assert.equal(good.sessionDate, '2026-10-23'); assert.ok(Number.isFinite(good.fetchedAt));
    const dailyCalls = requests.filter(url => url.includes('/INDGOOD?') && url.includes('interval=1d')).length;
    await send({ action: 'refreshDashboard', force: true, symbols: ['INDGOOD'] });
    assert.equal(requests.filter(url => url.includes('/INDGOOD?') && url.includes('interval=1d')).length, dailyCalls);
    const exported = await send({ action: 'exportBackup' });
    assert.equal(exported.backup.data.quoteSnapshots, undefined);
  } finally { globalThis.fetch = original; }
});

test('late indicator history cannot overwrite a newer quote session', async () => {
  const symbol = 'INDLATE', original = fetch;
  await send({ action: 'base', ticker: symbol });
  let release, started;
  const historyStarted = new Promise(resolve => { started = resolve; });
  const heldHistory = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (url, options) => {
    if (url.includes(`/${symbol}?`) && url.includes('interval=1d')) { started(); await heldHistory; }
    return original(url, options);
  };
  try {
    const pending = send({ action: 'technicals', ticker: symbol });
    await historyStarted;
    const newer = { ...values.quoteSnapshots[symbol], quoteTime: times[2] + 86400, sessionDate: '2026-10-24', quickIndicators: { rsi: 60, ytdVwap: 120, sessionDate: '2026-10-24' } };
    values.quoteSnapshots[symbol] = newer;
    release(); assert.equal((await pending).success, true);
    assert.deepEqual(values.quoteSnapshots[symbol], newer);
  } finally { release(); globalThis.fetch = original; }
});
