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
  return { indicators, groups, presets, normalizeSymbol, cleanSymbols, defaults, settings: value => settings({ ...defaults, ...value }) };
})();
