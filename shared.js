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
  return { valuationDefaults, valuationAssumptions, valuation, indicators, groups, presets, normalizeSymbol, cleanSymbols, defaults, settings: value => settings({ ...defaults, ...value }) };
})();
