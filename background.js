import './shared.js';
import { BACKUP_LIMIT, createBackup, prepareImport } from './backup.js';
import { ResourceCache } from './cache.js';
import { yahooSnapshot } from './fundamentals.js';
import { normalizeSymbol, bars, priceData, technicals, benchmark, sectorETF, sentiment } from './market.js';

const cache = new ResourceCache(chrome.storage.local);
const CHARTS = { '1D': ['5m', '1d'], '5D': ['15m', '5d'], '1M': ['1d', '1mo'], '6M': ['1d', '6mo'], '1Y': ['1d', '1y'] };
async function fetchResource(url, format = 'json') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Data provider returned HTTP ${response.status}`);
    if (format === 'json') return await response.json();
    const html = await response.text();
    if (html.length > 2000000) throw new Error('Fundamentals response is too large');
    return html;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Data provider timed out');
    throw error;
  } finally { clearTimeout(timer); }
}
const fetchJSON = url => fetchResource(url);
function chartResource(symbol, interval, range, ttl) {
  return cache.get(`chart:${symbol}:${interval}:${range}`, ttl, async () => {
    const data = await fetchJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`);
    const result = data.chart?.result?.[0];
    if (!result?.meta || !bars(result).length) throw new Error(data.chart?.error?.description || 'No chart data for this symbol');
    return result;
  });
}
const daily = symbol => chartResource(symbol, '1d', '2y', 6 * 3600000);
const intra = (symbol, ttl = 60000) => chartResource(symbol, '5m', '1d', ttl);
const status = item => ({ fetchedAt: item.time, stale: item.stale, error: item.error });
const series = (result, interval) => ({ points: bars(result), interval, timezone: result.meta.exchangeTimezoneName || 'America/New_York' });
async function base(symbol, remember = true, ttl = 60000) {
  let resource;
  try { resource = await intra(symbol, ttl); }
  catch {
    // Daily history can still supply a quote during intraday outages.
    resource = await daily(symbol);
    const quote = { ...priceData(resource.value), ...technicals(resource.value) };
    if (normalizeSymbol(quote.symbol) !== symbol || !Number.isFinite(quote.regularMarketPrice)) throw new Error('No matching quote available for this symbol');
    if (remember) await rememberQuote(symbol, quote, { ...status(resource), fallback: true }).catch(() => {});
    return { quote, chart: series(resource.value, '1d'), status: { ...status(resource), fallback: true } };
  }
  const quote = priceData(resource.value);
  if (normalizeSymbol(quote.symbol) !== symbol) throw new Error('Provider returned a different symbol');
  if (quote.regularMarketPrice == null) throw new Error('No price available for this symbol');
  if (remember) await rememberQuote(symbol, quote, status(resource)).catch(() => {});
  return { quote, chart: series(resource.value, '5m'), status: status(resource) };
}
async function tech(symbol) {
  const history = await daily(symbol);
  if (normalizeSymbol(history.value.meta?.symbol) !== symbol) throw new Error('Provider returned a different symbol');
  // Reuse the fast request if it is already in progress; don't let its failure discard history.
  let live, intradayResult;
  try { intradayResult = (await intra(symbol)).value; live = priceData(intradayResult); } catch { live = priceData(history.value); }
  if (normalizeSymbol(live.symbol) !== symbol) throw new Error('Provider returned a different symbol');
  const result = { quote: technicals(history.value, live, intradayResult), sessionDate: live.sessionDate, status: status(history) };
  await rememberQuickIndicators(symbol, live, { rsi: result.quote.rsi, ytdVwap: result.quote.ytdVwap, sessionDate: live.sessionDate, fetchedAt: history.time, stale: history.stale === true, error: history.error || null }).catch(() => {});
  return result;
}
async function fundamentals(symbol) {
  // The direct summary API requires authentication. The public statistics page
  // carries the same structured data and works with credential-free requests.
  return cache.get(`fundamentals:yahoo-page:v3:${symbol}`, 6 * 3600000, async () =>
    yahooSnapshot(await fetchResource(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/key-statistics/`, 'text'), symbol));
}
async function details(symbol) {
  const nonEquity = symbol.startsWith('^') || /-USD$/.test(symbol);
  const summaryTask = nonEquity ? Promise.resolve(null) : fundamentals(symbol);
  const newsTask = cache.get(`news:${symbol}`, 10 * 60000, () => fetchJSON(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=5&newsCount=12`));
  const spyTask = chartResource('SPY', '1d', '5d', 60000);
  const [summary, news, spy] = await Promise.allSettled([summaryTask, newsTask, spyTask]);
  const quote = summary.status === 'fulfilled' && summary.value ? { ...summary.value.value.quote } : {};
  const search = news.status === 'fulfilled' ? news.value.value : {};
  const match = search.quotes?.find(q => q.symbol === symbol);
  if (match) {
    quote.longName ||= match.longname || match.shortname;
    quote.sector ||= match.sector || match.sectorDisp;
    quote.industry ||= match.industry || match.industryDisp;
  }
  // Omit undefined values so a missing optional name never replaces the core name.
  for (const key of Object.keys(quote)) if (quote[key] === undefined) delete quote[key];
  const etf = sectorETF(quote.sector, quote.industry);
  let sector;
  try { if (etf) sector = await chartResource(etf, '1d', '5d', 60000); } catch { /* Optional benchmark. */ }
  const issues = [];
  if (summary.status === 'rejected' && !nonEquity) issues.push('Fundamentals providers unavailable for this symbol');
  if (news.status === 'rejected') issues.push('News unavailable');
  if (spy.status === 'rejected') issues.push('SPY benchmark unavailable');
  if (etf && !sector) issues.push('Sector benchmark unavailable');
  return {
    quote: { ...quote, sectorEtf: etf, categorySentiment: sentiment(search.news, symbol) },
    benchmarks: { spy: spy.status === 'fulfilled' ? benchmark(spy.value.value) : null, sector: sector ? benchmark(sector.value) : null },
    sources: {
      profile: summary.status === 'fulfilled' && summary.value ? { ...status(summary.value), provider: summary.value.value.provider, url: summary.value.value.url } : null,
      news: news.status === 'fulfilled' ? status(news.value) : null,
      spy: spy.status === 'fulfilled' ? status(spy.value) : null,
      sector: sector ? status(sector) : null
    }, issues
  };
}

// Serialize read/modify/write operations across tabs and popup instances.
let edits = Promise.resolve();
function editStorage(work) {
  const task = edits.catch(() => {}).then(work);
  edits = task;
  return task;
}
function quoteSnapshot(symbol, quote, source) {
  return { symbol, name: quote.longName || symbol, price: quote.regularMarketPrice,
    change: quote.regularMarketChange, changePercent: quote.regularMarketChangePercent, currency: quote.currency || '', quoteTime: quote.quoteTime,
    sessionDate: quote.sessionDate, fetchedAt: source.fetchedAt, stale: source.stale, fallback: source.fallback === true, marketState: quote.marketState };
}
async function rememberQuote(symbol, quote, source) {
  if (!Number.isFinite(quote.regularMarketPrice)) return;
  await editStorage(async () => {
    const { quoteSnapshots = {} } = await chrome.storage.local.get('quoteSnapshots');
    const next = { ...quoteSnapshots }; delete next[symbol]; next[symbol] = quoteSnapshot(symbol, quote, source);
    const prior = quoteSnapshots[symbol];
    if (prior?.quoteTime === quote.quoteTime && prior.sessionDate === quote.sessionDate && prior.quickIndicators) next[symbol].quickIndicators = prior.quickIndicators;
    const keys = Object.keys(next);
    for (const key of keys.slice(0, Math.max(0, keys.length - 100))) delete next[key];
    await chrome.storage.local.set({ quoteSnapshots: next });
  });
}
async function rememberQuickIndicators(symbol, live, indicators) {
  await editStorage(async () => {
    const { quoteSnapshots = {} } = await chrome.storage.local.get('quoteSnapshots');
    const snapshot = quoteSnapshots[symbol];
    if (!snapshot || snapshot.quoteTime !== live.quoteTime || snapshot.sessionDate !== live.sessionDate) return;
    await chrome.storage.local.set({ quoteSnapshots: { ...quoteSnapshots, [symbol]: { ...snapshot, quickIndicators: indicators } } });
  });
}
async function library() {
  const lists = await editStorage(async () => {
    const saved = await chrome.storage.local.get(['watchlist', 'recent', 'quoteSnapshots', 'aliasMigration']);
    const migrate = list => saved.aliasMigration ? list : (Array.isArray(list) ? list : []).map(value => { try { return TickerView.resolveSymbol(value, TickerView.builtinAliases); } catch { return value; } });
    const watchlist = TickerView.cleanSymbols(migrate(saved.watchlist)), recent = TickerView.cleanSymbols(migrate(saved.recent), 12);
    const patch = saved.aliasMigration ? {} : { aliasMigration: 1 };
    if (JSON.stringify(saved.watchlist || []) !== JSON.stringify(watchlist)) patch.watchlist = watchlist;
    if (JSON.stringify(saved.recent || []) !== JSON.stringify(recent)) patch.recent = recent;
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
    return { watchlist, recent, snapshots: saved.quoteSnapshots || {} };
  });
  // Reuse legacy chart caches on upgrade. Opening the popup never fetches prices.
  await cache.ready;
  const wanted = new Set([...lists.watchlist, ...lists.recent]);
  for (const [key, entry] of cache.entries) {
    if (!key.endsWith(':5m:1d')) continue;
    const quote = priceData(entry.value);
    if (!wanted.has(quote.symbol) || !Number.isFinite(quote.regularMarketPrice)) continue;
    if (lists.snapshots[quote.symbol]?.fetchedAt >= entry.time) continue;
    lists.snapshots[quote.symbol] = { symbol: quote.symbol, name: quote.longName, price: quote.regularMarketPrice,
      change: quote.regularMarketChange, changePercent: quote.regularMarketChangePercent, currency: quote.currency, quoteTime: quote.quoteTime, fetchedAt: entry.time };
  }
  return lists;
}
const quoteQueue = [];
let activeQuotes = 0;
function queuedQuote(work) {
  return new Promise((resolve, reject) => {
    quoteQueue.push({ work, resolve, reject }); drainQuotes();
  });
}
function drainQuotes() {
  while (activeQuotes < 3 && quoteQueue.length) {
    const job = quoteQueue.shift(); activeQuotes++;
    Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => { activeQuotes--; drainQuotes(); });
  }
}
const refreshTasks = new Map();
async function refreshQuotes(kind, force = false, requestedSymbols) {
  const taskKey = requestedSymbols ? `${kind}:${JSON.stringify([...requestedSymbols].sort())}` : kind;
  if (refreshTasks.has(taskKey)) return refreshTasks.get(taskKey);
  const task = (async () => {
    const { watchlist } = await library();
    const watched = new Set(watchlist);
    const { dashboardPreferences: storedPreferences } = await chrome.storage.local.get('dashboardPreferences');
    const preferences = TickerView.dashboardPreferences(storedPreferences);
    const ttl = force ? 0 : kind === 'dashboard' && preferences.autoRefresh ? preferences.refreshInterval * 1000 : 60000;
    const available = kind === 'overview' ? [...TickerView.overviewSymbols] : kind === 'dashboard' ? [...new Set([...TickerView.overviewSymbols, ...watchlist])] : watchlist;
    const symbols = requestedSymbols ? available.filter(symbol => requestedSymbols.includes(symbol)) : available;
    const outcomes = {};
    await Promise.all(symbols.map(symbol => queuedQuote(async () => {
      try {
        const result = await base(symbol, watched.has(symbol), ttl);
        if (kind !== 'overview' && watched.has(symbol)) {
          try { await tech(symbol); }
          catch (error) {
            await rememberQuickIndicators(symbol, result.quote, { rsi: null, ytdVwap: null, sessionDate: result.quote.sessionDate, error: error.message }).catch(() => {});
          }
        }
        outcomes[symbol] = { stale: result.status.stale, error: result.status.error || (result.status.fallback ? 'Daily quote fallback' : null) };
        if (TickerView.overviewSymbols.includes(symbol)) await editStorage(async () => {
          const { marketOverview = {} } = await chrome.storage.local.get('marketOverview');
          await chrome.storage.local.set({ marketOverview: { ...marketOverview, [symbol]: quoteSnapshot(symbol, result.quote, result.status) } });
        });
      } catch (error) { outcomes[symbol] = { error: error.message }; }
      if (kind !== 'overview') await chrome.storage.local.set({ watchRefresh: { total: symbols.length, completed: Object.keys(outcomes).length, outcomes: { ...outcomes } } });
    })));
    const { marketOverview = {} } = await chrome.storage.local.get('marketOverview');
    return { outcomes, marketOverview };
  })().finally(() => { refreshTasks.delete(taskKey); });
  refreshTasks.set(taskKey, task); return task;
}
async function handle(request) {
  switch (request.action) {
    case 'setCardSection': return editStorage(async () => {
      if (!TickerView.cardSectionKeys.includes(request.section) || typeof request.open !== 'boolean') throw new Error('Invalid card section preference');
      const { cardSections = {} } = await chrome.storage.local.get('cardSections');
      const next = { ...TickerView.cardSections(cardSections), [request.section]: request.open };
      await chrome.storage.local.set({ cardSections: next }); return { cardSections: next };
    });
    case 'initializeDashboardPreferences': return editStorage(async () => {
      const saved = await chrome.storage.local.get(['dashboardPreferences', 'fiveSecondRefreshMigration']);
      if (saved.fiveSecondRefreshMigration) return {};
      const dashboardPreferences = TickerView.dashboardPreferences({ ...saved.dashboardPreferences, autoRefresh: true, refreshInterval: 5 });
      await chrome.storage.local.set({ dashboardPreferences, fiveSecondRefreshMigration: 1 });
      return { dashboardPreferences };
    });
    case 'library': return library();
    case 'exportBackup': {
      await library();
      return editStorage(async () => ({ backup: createBackup(await chrome.storage.local.get(null)) }));
    }
    case 'previewImport':
    case 'importBackup': return editStorage(async () => {
      if (typeof request.json !== 'string' || new TextEncoder().encode(request.json).length > BACKUP_LIMIT) throw new Error('Backup must be a JSON file smaller than 2 MB');
      let backup;
      try { backup = JSON.parse(request.json); } catch { throw new Error('Backup is not valid JSON'); }
      const { patch, summary } = prepareImport(await chrome.storage.local.get(null), backup, request.mode);
      if (request.action === 'importBackup') await chrome.storage.local.set(patch);
      return { summary };
    });
    case 'refreshWatchlist': return refreshQuotes('watchlist');
    case 'refreshDashboard': {
      let symbols;
      if (request.symbols !== undefined) {
        if (!Array.isArray(request.symbols) || !request.symbols.length || request.symbols.length > 104) throw new Error('Invalid refresh symbols');
        symbols = [...new Set(request.symbols.map(normalizeSymbol))];
      }
      return refreshQuotes('dashboard', request.force === true, symbols);
    }
    case 'overview': return refreshQuotes('overview');
    case 'setDashboardPreferences': return editStorage(async () => {
      const { dashboardPreferences = {} } = await chrome.storage.local.get('dashboardPreferences');
      const patch = request.patch || {};
      if (Object.hasOwn(patch, 'autoRefresh') && typeof patch.autoRefresh !== 'boolean' || Object.hasOwn(patch, 'windowMode') && !['remember', 'fit', 'full'].includes(patch.windowMode)) throw new Error('Invalid market window preference');
      if (Object.hasOwn(patch, 'refreshInterval') && ![5, 15, 30, 60, 120, 300].includes(patch.refreshInterval)) throw new Error('Invalid refresh interval');
      const preferences = TickerView.dashboardPreferences({ ...dashboardPreferences, ...patch });
      await chrome.storage.local.set({ dashboardPreferences: preferences }); return { dashboardPreferences: preferences };
    });
    case 'saveWindowBounds': return editStorage(async () => {
      const bounds = TickerView.windowBounds(request.bounds); if (!bounds) throw new Error('Invalid window size');
      const patch = { windowBounds: bounds };
      if (request.manual === true) {
        const { dashboardPreferences = {} } = await chrome.storage.local.get('dashboardPreferences');
        patch.dashboardPreferences = TickerView.dashboardPreferences({ ...dashboardPreferences, windowMode: 'remember' });
      }
      await chrome.storage.local.set(patch); return {};
    });
    case 'setWatchSort': {
      if (!TickerView.sortModes.includes(request.sort)) throw new Error('Unknown sort order');
      await chrome.storage.local.set({ watchSort: request.sort }); return {};
    }
    case 'aliases': {
      const { customAliases = {} } = await chrome.storage.local.get('customAliases');
      return { customAliases, builtinAliases: TickerView.builtinAliases };
    }
    case 'saveAlias': {
      const key = TickerView.aliasKey(request.alias), target = normalizeSymbol(request.target);
      await base(target);
      return editStorage(async () => {
        const { customAliases = {} } = await chrome.storage.local.get('customAliases');
        if (!Object.hasOwn(customAliases, key) && Object.keys(customAliases).length >= 100) throw new Error('Custom alias limit is 100');
        const next = { ...customAliases, [key]: target };
        await chrome.storage.local.set({ customAliases: next }); return { customAliases: next };
      });
    }
    case 'deleteAlias':
    case 'resetAliases': return editStorage(async () => {
      const { customAliases = {} } = await chrome.storage.local.get('customAliases');
      const next = { ...customAliases };
      if (request.action === 'resetAliases') Object.keys(next).forEach(key => delete next[key]);
      else delete next[TickerView.aliasKey(request.alias)];
      await chrome.storage.local.set({ customAliases: next }); return { customAliases: next };
    });
    case 'getNote': {
      const { tickerNotes = {} } = await chrome.storage.local.get('tickerNotes');
      return { note: tickerNotes[normalizeSymbol(request.ticker)] || { text: '', revision: null } };
    }
    case 'saveNote': return editStorage(async () => {
      const symbol = normalizeSymbol(request.ticker);
      if (typeof request.text !== 'string' || request.text.length > 4000) throw new Error('Notes must be at most 4,000 characters');
      const { tickerNotes = {} } = await chrome.storage.local.get('tickerNotes');
      const current = tickerNotes[symbol] || { text: '', revision: null };
      if (current.revision !== request.revision) return { conflict: true, note: current };
      if (request.text && !Object.hasOwn(tickerNotes, symbol) && Object.keys(tickerNotes).length >= 100) throw new Error('Note limit is 100 symbols. Delete another note first.');
      const next = { ...tickerNotes }, note = { text: request.text, revision: crypto.randomUUID() };
      if (request.text) next[symbol] = note; else delete next[symbol];
      await chrome.storage.local.set({ tickerNotes: next });
      return { note: request.text ? note : { text: '', revision: null } };
    });
    case 'saveValuation':
    case 'resetValuation': return editStorage(async () => {
      const symbol = normalizeSymbol(request.ticker);
      const assumptions = request.action === 'saveValuation' ? TickerView.valuationAssumptions(request.assumptions) : null;
      const { valuationScenarios = {} } = await chrome.storage.local.get('valuationScenarios');
      const next = {};
      for (const [key, value] of Object.entries(valuationScenarios)) {
        try { if (key !== symbol && normalizeSymbol(key) === key) next[key] = TickerView.valuationAssumptions(value); } catch { /* Ignore invalid stored assumptions. */ }
      }
      if (assumptions) next[symbol] = assumptions;
      const bounded = Object.fromEntries(Object.entries(next).slice(-100));
      await chrome.storage.local.set({ valuationScenarios: bounded });
      return { valuationScenarios: bounded };
    });
    case 'clearRecent': return editStorage(async () => { await chrome.storage.local.set({ recent: [] }); return {}; });
    case 'addWatch': {
      const { customAliases = {} } = await chrome.storage.local.get('customAliases');
      const ticker = TickerView.resolveSymbol(request.ticker, { ...TickerView.builtinAliases, ...customAliases });
      const result = await base(ticker);
      await handle({ action: 'watch', ticker, saved: true });
      return { quote: result.quote };
    }
    case 'base': return base(normalizeSymbol(request.ticker));
    case 'technicals': return tech(normalizeSymbol(request.ticker));
    case 'details': return details(normalizeSymbol(request.ticker));
    case 'chart': {
      const symbol = normalizeSymbol(request.ticker);
      const pair = CHARTS[request.range];
      if (!pair) throw new Error('Unsupported timeframe');
      const item = await chartResource(symbol, ...pair, request.range === '1D' || request.range === '5D' ? 60000 : 6 * 3600000);
      return { chart: series(item.value, pair[0]), status: status(item) };
    }
    case 'settings': return editStorage(async () => {
      const { settings = TickerView.defaults } = await chrome.storage.local.get('settings');
      const next = TickerView.settings(settings);
      // Only permit known settings; per-site state is derived inside the worker.
      for (const key of ['enabled', 'hoverDelay', 'compact', 'reducedEffects', 'indicators']) if (Object.hasOwn(request.patch || {}, key)) next[key] = request.patch[key];
      if (typeof request.site === 'string' && /^[a-z0-9.-]+$/.test(request.site) && typeof request.siteEnabled === 'boolean') {
        next.disabledSites = next.disabledSites.filter(site => site !== request.site);
        if (!request.siteEnabled) next.disabledSites.push(request.site);
      }
      await chrome.storage.local.set({ settings: TickerView.settings(next) });
      return {};
    });
    case 'moveWatch': return editStorage(async () => {
      const symbol = normalizeSymbol(request.ticker), target = normalizeSymbol(request.target);
      if (!['before', 'after'].includes(request.position)) throw new Error('Invalid watchlist move');
      const { watchlist: stored } = await chrome.storage.local.get('watchlist');
      const watchlist = TickerView.cleanSymbols(stored);
      if (!watchlist.includes(symbol) || !watchlist.includes(target)) throw new Error('Watchlist changed. Try moving the symbol again.');
      if (symbol !== target) {
        watchlist.splice(watchlist.indexOf(symbol), 1);
        watchlist.splice(watchlist.indexOf(target) + (request.position === 'after' ? 1 : 0), 0, symbol);
      }
      await chrome.storage.local.set({ watchlist, watchSort: 'saved' });
      return { watchlist };
    });
    case 'watch': return editStorage(async () => {
      const symbol = normalizeSymbol(request.ticker);
      if (request.index !== undefined && (!Number.isInteger(request.index) || request.index < 0 || request.index >= 100 || request.saved !== true)) throw new Error('Invalid watchlist insertion index');
      const stored = await chrome.storage.local.get('watchlist');
      const watchlist = TickerView.cleanSymbols(stored.watchlist);
      const saved = watchlist.includes(symbol);
      const wanted = typeof request.saved === 'boolean' ? request.saved : !saved;
      if (wanted && !saved && watchlist.length >= 100) throw new Error('Watchlist limit is 100 symbols');
      const next = wanted ? saved ? watchlist : [symbol, ...watchlist] : watchlist.filter(x => x !== symbol);
      if (wanted && !saved && request.index !== undefined) { next.shift(); next.splice(Math.min(request.index, next.length), 0, symbol); }
      await chrome.storage.local.set({ watchlist: next });
      return { watchlist: next };
    });
    case 'recent': return editStorage(async () => {
      const symbol = normalizeSymbol(request.ticker);
      const stored = await chrome.storage.local.get('recent');
      const recent = TickerView.cleanSymbols(stored.recent, 12);
      await chrome.storage.local.set({ recent: [symbol, ...recent.filter(x => x !== symbol)].slice(0, 12) });
      return {};
    });
    default: throw new Error('Unknown request');
  }
}
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !request || typeof request.action !== 'string') return false;
  handle(request).then(data => respond({ success: true, ...data }), error => respond({ success: false, error: error.message || 'Unable to load data' }));
  return true;
});

// Toolbar panels have a browser-enforced height limit. Open our own resizable
// window instead; its page then fits itself to the display's available bounds.
let launcherWindowId, launcherTask;
async function openLauncher(tab, focusSearch = false) {
  const url = new URL(chrome.runtime.getURL('popup.html'));
  url.searchParams.set('expanded', '1');
  if (focusSearch) url.searchParams.set('search', '1');
  try { const source = new URL(tab?.url); if (source.protocol === 'https:') url.searchParams.set('site', source.hostname); } catch { /* Internal browser pages have no supported site. */ }
  if (launcherWindowId != null) {
    try { await chrome.windows.get(launcherWindowId); } catch { launcherWindowId = null; }
  }
  // A Manifest V3 worker can restart while its launcher remains open.
  if (launcherWindowId == null) {
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
    launcherWindowId = windows.find(window => window.tabs?.some(tab => tab.url?.split('?')[0] === chrome.runtime.getURL('popup.html')))?.id;
  }
  if (launcherWindowId != null) {
    try {
      await chrome.runtime.sendMessage({ action: 'focusLauncher', windowId: launcherWindowId, site: url.searchParams.get('site'), focusSearch }).catch(() => {});
      await chrome.windows.update(launcherWindowId, { focused: true });
      return;
    } catch { launcherWindowId = null; }
  }
  const stored = await chrome.storage.local.get(['dashboardPreferences', 'windowBounds']);
  const bounds = TickerView.dashboardPreferences(stored.dashboardPreferences).windowMode === 'remember' ? TickerView.windowBounds(stored.windowBounds) : null;
  const created = await chrome.windows.create({ url: url.href, type: 'popup', ...(bounds || { width: 480, height: 600 }) });
  launcherWindowId = created.id;
}
chrome.action.onClicked.addListener(tab => {
  if (launcherTask) return launcherTask;
  launcherTask = openLauncher(tab).catch(error => console.error('Unable to open TickerView', error)).finally(() => { launcherTask = null; });
  return launcherTask;
});

chrome.commands?.onCommand.addListener(command => {
  if (command !== 'open-search') return;
  if (launcherTask) return launcherTask;
  launcherTask = chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => openLauncher(tabs[0], true))
    .catch(error => console.error('Unable to open search', error)).finally(() => { launcherTask = null; });
  return launcherTask;
});
