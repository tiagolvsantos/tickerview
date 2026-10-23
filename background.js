import './shared.js';
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
const intra = symbol => chartResource(symbol, '5m', '1d', 60000);
const status = item => ({ fetchedAt: item.time, stale: item.stale, error: item.error });
const series = (result, interval) => ({ points: bars(result), interval, timezone: result.meta.exchangeTimezoneName || 'America/New_York' });
async function base(symbol) {
  let resource;
  try { resource = await intra(symbol); }
  catch {
    // Daily history can still supply a quote during intraday outages.
    resource = await daily(symbol);
    const quote = { ...priceData(resource.value), ...technicals(resource.value) };
    await rememberQuote(symbol, quote, status(resource)).catch(() => {});
    return { quote, chart: series(resource.value, '1d'), status: { ...status(resource), fallback: true } };
  }
  const quote = priceData(resource.value);
  if (normalizeSymbol(quote.symbol) !== symbol) throw new Error('Provider returned a different symbol');
  if (quote.regularMarketPrice == null) throw new Error('No price available for this symbol');
  await rememberQuote(symbol, quote, status(resource)).catch(() => {});
  return { quote, chart: series(resource.value, '5m'), status: status(resource) };
}
async function tech(symbol) {
  const history = await daily(symbol);
  // Reuse the fast request if it is already in progress; don't let its failure discard history.
  let live, intradayResult;
  try { intradayResult = (await intra(symbol)).value; live = priceData(intradayResult); } catch { live = priceData(history.value); }
  return { quote: technicals(history.value, live, intradayResult), sessionDate: live.sessionDate, status: status(history) };
}
async function fundamentals(symbol) {
  // The direct summary API requires authentication. The public statistics page
  // carries the same structured data and works with credential-free requests.
  return cache.get(`fundamentals:yahoo-page:v2:${symbol}`, 6 * 3600000, async () =>
    yahooSnapshot(await fetchResource(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/key-statistics/`, 'text'), symbol));
}
async function details(symbol) {
  const summaryTask = fundamentals(symbol);
  const newsTask = cache.get(`news:${symbol}`, 10 * 60000, () => fetchJSON(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=5&newsCount=12`));
  const spyTask = chartResource('SPY', '1d', '5d', 60000);
  const [summary, news, spy] = await Promise.allSettled([summaryTask, newsTask, spyTask]);
  const quote = summary.status === 'fulfilled' ? { ...summary.value.value.quote } : {};
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
  if (summary.status === 'rejected') issues.push('Fundamentals providers unavailable for this symbol');
  if (news.status === 'rejected') issues.push('News unavailable');
  if (spy.status === 'rejected') issues.push('SPY benchmark unavailable');
  if (etf && !sector) issues.push('Sector benchmark unavailable');
  return {
    quote: { ...quote, sectorEtf: etf, categorySentiment: sentiment(search.news, symbol) },
    benchmarks: { spy: spy.status === 'fulfilled' ? benchmark(spy.value.value) : null, sector: sector ? benchmark(sector.value) : null },
    sources: {
      profile: summary.status === 'fulfilled' ? { ...status(summary.value), provider: summary.value.value.provider, url: summary.value.value.url } : null,
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
async function rememberQuote(symbol, quote, source) {
  if (!Number.isFinite(quote.regularMarketPrice)) return;
  await editStorage(async () => {
    const { quoteSnapshots = {} } = await chrome.storage.local.get('quoteSnapshots');
    const next = { ...quoteSnapshots };
    delete next[symbol];
    next[symbol] = { symbol, name: quote.longName || symbol, price: quote.regularMarketPrice,
      changePercent: quote.regularMarketChangePercent, currency: quote.currency || '', quoteTime: quote.quoteTime,
      fetchedAt: source.fetchedAt, stale: source.stale };
    const keys = Object.keys(next);
    for (const key of keys.slice(0, Math.max(0, keys.length - 100))) delete next[key];
    await chrome.storage.local.set({ quoteSnapshots: next });
  });
}
async function library() {
  const lists = await editStorage(async () => {
    const saved = await chrome.storage.local.get(['watchlist', 'recent', 'quoteSnapshots']);
    const watchlist = TickerView.cleanSymbols(saved.watchlist), recent = TickerView.cleanSymbols(saved.recent, 12);
    const patch = {};
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
      changePercent: quote.regularMarketChangePercent, currency: quote.currency, quoteTime: quote.quoteTime, fetchedAt: entry.time };
  }
  return lists;
}
async function handle(request) {
  switch (request.action) {
    case 'library': return library();
    case 'clearRecent': return editStorage(async () => { await chrome.storage.local.set({ recent: [] }); return {}; });
    case 'addWatch': {
      const ticker = normalizeSymbol(request.ticker);
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
    case 'watch': return editStorage(async () => {
      const symbol = normalizeSymbol(request.ticker);
      const stored = await chrome.storage.local.get('watchlist');
      const watchlist = TickerView.cleanSymbols(stored.watchlist);
      const saved = watchlist.includes(symbol);
      const wanted = typeof request.saved === 'boolean' ? request.saved : !saved;
      if (wanted && !saved && watchlist.length >= 100) throw new Error('Watchlist limit is 100 symbols');
      const next = wanted ? saved ? watchlist : [symbol, ...watchlist] : watchlist.filter(x => x !== symbol);
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
