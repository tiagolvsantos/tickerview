import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, validateBackup, prepareImport } from '../backup.js';
const source = () => ({
  settings: { ...TickerView.defaults, compact: true, disabledSites: ['x.com'], hoverDelay: 500 },
  watchlist: ['BTC-USD', '^VIX'], recent: ['^VIX'], watchSort: 'change-desc', customAliases: { COIN: 'BTC-USD' },
  tickerNotes: { 'BTC-USD': { text: '<b>Personal thesis</b>', revision: 'old-machine' } }, valuationScenarios: { AAPL: { bear: 10, base: 20, bull: 30 } },
  quoteSnapshots: { AAPL: { price: 100 } }, resourceCache: [['private-cache']], watchRefresh: { total: 10 }
});
test('portable backup round trips preferences and canonical saved data, excluding transient data and revisions', () => {
  const backup = createBackup(source());
  assert.equal(backup.format, 'tickerview-backup'); assert.equal(backup.version, 1);
  assert.equal(backup.data.tickerNotes['BTC-USD'], '<b>Personal thesis</b>');
  assert.equal(backup.data.settings.hoverDelay, 500);
  assert.equal(backup.data.quoteSnapshots, undefined); assert.equal(backup.data.resourceCache, undefined); assert.equal(backup.data.watchRefresh, undefined);
  const { patch } = prepareImport({}, JSON.parse(JSON.stringify(backup)), 'replace');
  assert.deepEqual(patch.watchlist, ['BTC-USD', '^VIX']); assert.deepEqual(patch.customAliases, { COIN: 'BTC-USD' });
  assert.equal(patch.aliasMigration, 1); assert.notEqual(patch.tickerNotes['BTC-USD'].revision, 'old-machine');
  assert.deepEqual(createBackup(patch).data, backup.data);
});
test('merge preserves local-only entries, imported collisions win, and replace removes absent entries', () => {
  const local = source(); local.watchlist = ['AAPL', 'BTC-USD']; local.recent = ['AAPL']; local.customAliases = { COIN: 'ETH-USD', LOCAL: '^GSPC' };
  local.tickerNotes.AAPL = { text: 'Local note', revision: 'local-rev' };
  const imported = createBackup(source());
  const { patch, summary } = prepareImport(local, imported, 'merge');
  assert.deepEqual(patch.watchlist, ['AAPL', 'BTC-USD', '^VIX']); assert.deepEqual(patch.recent, ['AAPL', '^VIX']);
  assert.equal(patch.customAliases.COIN, 'BTC-USD'); assert.equal(patch.customAliases.LOCAL, '^GSPC');
  assert.equal(patch.tickerNotes.AAPL.revision, 'local-rev'); assert.equal(summary.tickerNotes.total, 2);
  const replaced = prepareImport(local, imported, 'replace').patch;
  assert.equal(replaced.tickerNotes.AAPL, undefined); assert.equal(replaced.customAliases.LOCAL, undefined);
  assert.deepEqual(replaced.watchlist, imported.data.watchlist);
});
test('rejects unsupported, incomplete, invalid, and oversized sections without silently dropping data', () => {
  const invalid = [
    b => { b.version = 2; }, b => { b.format = 'other-app'; }, b => { delete b.data.settings; }, b => { b.data.unexpected = {}; },
    b => { b.data.settings.enabled = 'false'; }, b => { b.data.settings.hoverDelay = -1; }, b => { b.data.settings.indicators = ['not-an-indicator']; },
    b => { b.data.settings.disabledSites = ['https://x.com']; }, b => { b.data.watchSort = 'unknown'; },
    b => { b.data.watchlist = ['$5B']; }, b => { b.data.watchlist = Array(101).fill('AAPL'); },
    b => { b.data.tickerNotes.AAPL = 'x'.repeat(4001); }, b => { b.data.customAliases['5B'] = 'AAPL'; },
    b => { b.data.customAliases.BAD = '../path'; }, b => { b.data.valuationScenarios.AAPL.base = -20; },
    b => { b.data.tickerNotes = JSON.parse('{"__proto__":"bad"}'); }
  ];
  for (const mutate of invalid) { const backup = createBackup(source()); mutate(backup); assert.throws(() => validateBackup(backup)); }
  const local = source(); local.watchlist = Array.from({ length: 100 }, (_, i) => `S${i}`);
  assert.throws(() => prepareImport(local, createBackup(source()), 'merge'), /100/);
  assert.equal(local.watchlist.length, 100);
});
test('canonical identities and alias targets are literal; no alias chains or remapping during restore', () => {
  const backup = createBackup(source()); backup.data.customAliases = { BTC: 'ETH-USD', COIN: 'BTC' }; backup.data.watchlist = ['BTC', 'BTC-USD'];
  const { patch } = prepareImport({}, backup, 'replace');
  assert.deepEqual(patch.watchlist, ['BTC', 'BTC-USD']); assert.equal(patch.customAliases.COIN, 'BTC');
});
test('market preferences round trip while old backups remain compatible and window geometry stays local', () => {
  const stored = { ...source(), dashboardPreferences: { autoRefresh: true, refreshInterval: 15, windowMode: 'fit' }, windowBounds: { width: 500, height: 700 } };
  const backup = createBackup(stored);
  assert.deepEqual(backup.data.dashboardPreferences, stored.dashboardPreferences); assert.equal(backup.data.windowBounds, undefined);
  assert.deepEqual(prepareImport({}, backup, 'replace').patch.dashboardPreferences, stored.dashboardPreferences);
  delete backup.data.dashboardPreferences.refreshInterval;
  assert.equal(validateBackup(backup).dashboardPreferences.refreshInterval, 15);
  backup.data.dashboardPreferences.refreshInterval = 5; assert.throws(() => validateBackup(backup), /refresh interval/);
  delete backup.data.dashboardPreferences;
  assert.deepEqual(validateBackup(backup).dashboardPreferences, { autoRefresh: true, refreshInterval: 15, windowMode: 'remember' });
});
