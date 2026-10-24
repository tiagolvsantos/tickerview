import './shared.js';

export const BACKUP_LIMIT = 2 * 1024 * 1024;
const keys = ['settings', 'watchlist', 'recent', 'watchSort', 'customAliases', 'tickerNotes', 'valuationScenarios'];
const fail = message => { throw new Error(`Invalid backup: ${message}`); };
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}
function exact(value, allowed, label) {
  object(value, label);
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`unknown field in ${label}`);
}
function symbols(value, limit, label) {
  if (!Array.isArray(value) || value.length > limit) fail(`${label} must contain at most ${limit} symbols`);
  return [...new Set(value.map(TickerView.normalizeSymbol))];
}
function map(value, label, convert, keyFor = TickerView.normalizeSymbol) {
  object(value, label);
  if (Object.keys(value).length > 100) fail(`${label} limit is 100 entries`);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const canonical = keyFor(key);
    if (Object.hasOwn(result, canonical)) fail(`duplicate ${label} key: ${canonical}`);
    result[canonical] = convert(item);
  }
  return result;
}
export function validateBackup(backup) {
  exact(backup, ['format', 'version', 'exportedAt', 'data'], 'file');
  if (backup.format !== 'tickerview-backup' || backup.version !== 1) fail('unsupported format or version');
  const data = object(backup.data, 'data'); exact(data, [...keys, 'dashboardPreferences'], 'data');
  if (keys.some(key => !Object.hasOwn(data, key))) fail('missing data section');
  const settings = data.settings, settingKeys = Object.keys(TickerView.defaults);
  exact(settings, settingKeys, 'settings');
  if (settingKeys.some(key => !Object.hasOwn(settings, key))) fail('missing setting');
  for (const key of ['enabled', 'compact', 'reducedEffects']) if (typeof settings[key] !== 'boolean') fail(`${key} must be true or false`);
  if (!Number.isFinite(settings.hoverDelay) || settings.hoverDelay < 0 || settings.hoverDelay > 1500) fail('hover delay must be between 0 and 1500 ms');
  if (!Array.isArray(settings.disabledSites) || settings.disabledSites.length > 100 || settings.disabledSites.some(site => typeof site !== 'string' || site.length > 253 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(site))) fail('invalid disabled sites');
  if (!Array.isArray(settings.indicators) || settings.indicators.length > Object.keys(TickerView.indicators).length || settings.indicators.some(key => typeof key !== 'string' || !Object.hasOwn(TickerView.indicators, key))) fail('unknown indicator');
  if (!TickerView.sortModes.includes(data.watchSort)) fail('unknown watchlist sort');
  if (data.dashboardPreferences !== undefined) {
    exact(data.dashboardPreferences, ['autoRefresh', 'refreshInterval', 'windowMode'], 'market window preferences');
    if (typeof data.dashboardPreferences.autoRefresh !== 'boolean' || !['remember', 'fit', 'full'].includes(data.dashboardPreferences.windowMode)) fail('invalid market window preferences');
    if (data.dashboardPreferences.refreshInterval !== undefined && ![15, 30, 60, 120, 300].includes(data.dashboardPreferences.refreshInterval)) fail('invalid refresh interval');
  }
  return {
    dashboardPreferences: TickerView.dashboardPreferences(data.dashboardPreferences),
    settings: TickerView.settings(settings), watchlist: symbols(data.watchlist, 100, 'watchlist'), recent: symbols(data.recent, 12, 'recent history'), watchSort: data.watchSort,
    customAliases: map(data.customAliases, 'aliases', TickerView.normalizeSymbol, TickerView.aliasKey),
    tickerNotes: map(data.tickerNotes, 'notes', text => { if (typeof text !== 'string' || !text.length || text.length > 4000) fail('notes must contain 1–4,000 characters'); return text; }),
    valuationScenarios: map(data.valuationScenarios, 'valuation assumptions', TickerView.valuationAssumptions)
  };
}
export function createBackup(stored, now = new Date()) {
  const backup = { format: 'tickerview-backup', version: 1, exportedAt: now.toISOString(), data: {
    dashboardPreferences: TickerView.dashboardPreferences(stored.dashboardPreferences),
    settings: TickerView.settings(stored.settings), watchlist: TickerView.cleanSymbols(stored.watchlist), recent: TickerView.cleanSymbols(stored.recent, 12),
    watchSort: TickerView.sortModes.includes(stored.watchSort) ? stored.watchSort : 'saved', customAliases: stored.customAliases || {},
    tickerNotes: Object.fromEntries(Object.entries(stored.tickerNotes || {}).filter(([, note]) => note.text).map(([symbol, note]) => [symbol, note.text])),
    valuationScenarios: stored.valuationScenarios || {}
  } };
  backup.data = validateBackup(backup);
  return backup;
}
export function prepareImport(stored, backup, mode) {
  if (!['merge', 'replace'].includes(mode)) fail('choose Merge or Replace');
  const incoming = validateBackup(backup), current = createBackup(stored).data;
  const data = mode === 'replace' ? incoming : {
    ...incoming,
    watchlist: [...new Set([...current.watchlist, ...incoming.watchlist])],
    recent: [...new Set([...current.recent, ...incoming.recent])].slice(0, 12),
    customAliases: { ...current.customAliases, ...incoming.customAliases }, tickerNotes: { ...current.tickerNotes, ...incoming.tickerNotes },
    valuationScenarios: { ...current.valuationScenarios, ...incoming.valuationScenarios }
  };
  // Revalidate combined limits before any storage write; never silently evict saved data.
  validateBackup({ format: 'tickerview-backup', version: 1, data });
  const count = value => Array.isArray(value) ? value.length : Object.keys(value).length;
  const summary = Object.fromEntries(['watchlist', 'recent', 'customAliases', 'tickerNotes', 'valuationScenarios'].map(key => [key, { incoming: count(incoming[key]), total: count(data[key]) }]));
  const tickerNotes = Object.fromEntries(Object.entries(data.tickerNotes).map(([symbol, text]) => [symbol,
    Object.hasOwn(incoming.tickerNotes, symbol) ? { text, revision: crypto.randomUUID() } : stored.tickerNotes[symbol]
  ]));
  return { patch: { ...data, tickerNotes, aliasMigration: 1 }, summary };
}
