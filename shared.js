/* Shared by the isolated content script, popup, and service worker. */
globalThis.TickerView = (() => {
  const indicators = {
    marketCap: 'Market cap', regularMarketVolume: 'Volume', rvol: 'Volume / avg day',
    relStrength: 'RS vs SPY', relStrengthSector: 'RS vs sector', rsi: 'RSI (14)',
    atr: 'ATR (14)', atrPct: 'ATR %', vwap: 'VWAP (bar estimate)', vwapDist: 'VWAP distance %',
    fiftyDayAverage: '50 DMA', twoHundredDayAverage: '200 DMA', dist200: '200 DMA distance %',
    zScore: 'Stretch (Z)', bbPct: 'Bollinger position %', adrPct: 'ADR (20) %',
    gapPct: 'Session gap %', keyLevelStatus: 'Prior session levels', fiftyTwoWeekRange: '52-week range',
    shortFloatPct: 'Short float %', shortRatio: 'Days to cover'
  };
  function normalizeSymbol(input) {
    if (typeof input !== 'string') throw new Error('Enter a symbol, such as AAPL or VOD.L');
    const value = input.trim().replace(/^\$/, '').toUpperCase();
    if (!/^(?:[A-Z^][A-Z0-9.^=-]{0,19}|\d{1,10}\.[A-Z]{1,4})$/.test(value)) throw new Error('Enter a stock symbol, not a currency amount');
    return value.replace(/^([A-Z]+)\.([AB])$/, '$1-$2');
  }
  const builtinAliases = Object.freeze({ VIX: '^VIX', SPX: '^GSPC', SP500: '^GSPC', DJI: '^DJI', IXIC: '^IXIC', RUT: '^RUT', BTC: 'BTC-USD', BTCUSD: 'BTC-USD', ETH: 'ETH-USD', ETHUSD: 'ETH-USD' });
  let customAliases = {};
  function aliasKey(value) {
    const key = typeof value === 'string' ? value.trim().replace(/^\$/, '').toUpperCase() : '';
    if (!/^[A-Z][A-Z0-9]{0,19}$/.test(key)) throw new Error('Alias must contain letters/numbers and start with a letter.');
    return normalizeSymbol(key);
  }
  function setAliases(value = {}) {
    customAliases = {};
    for (const [key, target] of Object.entries(value || {}).slice(0, 100)) {
      try { if (aliasKey(key) === key) customAliases[key] = normalizeSymbol(target); } catch { /* Ignore invalid stored mappings. */ }
    }
  }
  function resolveSymbol(input, aliases = { ...builtinAliases, ...customAliases }) {
    const symbol = normalizeSymbol(input);
    return Object.hasOwn(aliases, symbol) ? normalizeSymbol(aliases[symbol]) : symbol;
  }
  const sortModes = ['saved', 'symbol', 'symbol-desc', 'company', 'price-desc', 'price-asc', 'change-desc', 'change-asc'];
  function sortSymbols(symbols, snapshots, mode) {
    if (mode === 'saved' || !sortModes.includes(mode)) return [...symbols];
    return [...symbols].sort((a, b) => {
      const av = mode.startsWith('symbol') ? a : mode === 'company' ? snapshots[a]?.name : mode.startsWith('price') ? snapshots[a]?.price : snapshots[a]?.changePercent;
      const bv = mode.startsWith('symbol') ? b : mode === 'company' ? snapshots[b]?.name : mode.startsWith('price') ? snapshots[b]?.price : snapshots[b]?.changePercent;
      const numeric = mode.startsWith('change') || mode.startsWith('price');
      const valid = v => numeric ? Number.isFinite(v) : typeof v === 'string' && !!v;
      if (valid(av) !== valid(bv)) return valid(av) ? -1 : 1;
      const result = !valid(av) ? 0 : numeric ? (av - bv) * (mode.endsWith('-desc') ? -1 : 1) : av.localeCompare(bv) * (mode === 'symbol-desc' ? -1 : 1);
      return result || a.localeCompare(b);
    });
  }
  const overviewSymbols = Object.freeze(['SPY', 'QQQ', '^VIX', 'BTC-USD']);
  function dashboardPreferences(value = {}) {
    return { autoRefresh: value?.autoRefresh !== false, refreshInterval: [5, 15, 30, 60, 120, 300].includes(value?.refreshInterval) ? value.refreshInterval : 5, windowMode: ['remember', 'fit', 'full'].includes(value?.windowMode) ? value.windowMode : 'remember' };
  }
  function windowBounds(value) {
    if (!value || !['width', 'height'].every(key => Number.isFinite(value[key]))) return null;
    const bounds = { width: Math.round(Math.max(320, Math.min(10000, value.width))), height: Math.round(Math.max(300, Math.min(10000, value.height))) };
    for (const key of ['left', 'top']) if (Number.isFinite(value[key])) bounds[key] = Math.round(Math.max(-100000, Math.min(100000, value[key])));
    return bounds;
  }
  function cleanSymbols(values, limit = 100) {
    const symbols = [];
    for (const input of Array.isArray(values) ? values : []) {
      try { const symbol = normalizeSymbol(input); if (!symbols.includes(symbol)) symbols.push(symbol); } catch { /* Old currency matches and invalid values. */ }
      if (symbols.length === limit) break;
    }
    return symbols;
  }
  const fundamentalKeys = ['marketCap', 'shortFloatPct', 'shortRatio'];
  const groups = { Technicals: Object.keys(indicators).filter(key => !fundamentalKeys.includes(key)), Fundamentals: fundamentalKeys };
  const presets = { Essential: ['marketCap', 'regularMarketVolume', 'rvol', 'relStrength', 'rsi', 'atr', 'vwap', 'gapPct', 'keyLevelStatus'], Technical: groups.Technicals, All: Object.keys(indicators) };
  const defaults = { enabled: true, disabledSites: [], hoverDelay: 300, compact: false, reducedEffects: false, indicators: Object.keys(indicators) };
  function settings(value = {}) {
    return {
      enabled: value.enabled !== false,
      disabledSites: Array.isArray(value.disabledSites) ? value.disabledSites.filter(x => typeof x === 'string').slice(0, 100) : [],
      hoverDelay: Math.min(1500, Math.max(0, Number(value.hoverDelay) || 0)),
      compact: value.compact === true, reducedEffects: value.reducedEffects === true,
      indicators: Array.isArray(value.indicators) ? value.indicators.filter(x => Object.hasOwn(indicators, x)) : [...defaults.indicators]
    };
  }
  const valuationDefaults = Object.freeze({ bear: 15, base: 20, bull: 25 });
  function valuationAssumptions(value) {
    const result = {};
    for (const key of ['bear', 'base', 'bull']) {
      const n = value?.[key];
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 200) throw new Error('Each P/E must be greater than 0 and at most 200.');
      result[key] = n;
    }
    if (result.bear > result.base || result.base > result.bull) throw new Error('Use bear ≤ base ≤ bull P/E values.');
    return result;
  }
  function valuation(quote, assumptions = valuationDefaults) {
    const pe = valuationAssumptions(assumptions), f = quote.fundamentals || {};
    const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
    const currencyMatches = typeof quote.currency === 'string' && !!quote.currency && f.quoteCurrency === quote.currency;
    const comparable = currencyMatches && positive(quote.regularMarketPrice);
    const difference = value => comparable ? (value / quote.regularMarketPrice - 1) * 100 : null;
    let reason = null;
    if (quote.instrumentType !== 'EQUITY') reason = 'Earnings estimates are available only for stocks with verified instrument data.';
    else if (!positive(f.trailingEps)) reason = 'A positive trailing 12-month EPS is required for the earnings model.';
    else if (!currencyMatches) reason = 'The EPS and quote currencies could not be matched.';
    else if (!positive(quote.regularMarketPrice)) reason = 'A current positive quote is required for comparison.';
    const scenarios = reason ? [] : ['bear', 'base', 'bull'].map(key => {
      const value = f.trailingEps * pe[key];
      return { key, multiple: pe[key], value, difference: difference(value) };
    });
    const targets = currencyMatches ? [['Low', quote.targetLow], ['Mean', quote.targetMean], ['High', quote.targetHigh]]
      .filter(([, value]) => positive(value)).map(([label, value]) => ({ label, value, difference: difference(value) })) : [];
    return { reason, scenarios, targets };
  }
  const cardSectionKeys = ['note', 'valuation', 'assumptions', 'fundamentals', 'news', 'guide'];
  function cardSections(value = {}) {
    return Object.fromEntries(cardSectionKeys.filter(key => typeof value?.[key] === 'boolean').map(key => [key, value[key]]));
  }
  return { cardSectionKeys, cardSections, overviewSymbols, dashboardPreferences, windowBounds, builtinAliases, aliasKey, setAliases, resolveSymbol, sortModes, sortSymbols, valuationDefaults, valuationAssumptions, valuation, indicators, groups, presets, normalizeSymbol, cleanSymbols, defaults, settings: value => settings({ ...defaults, ...value }) };
})();
