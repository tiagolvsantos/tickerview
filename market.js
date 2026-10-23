import './shared.js';
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const raw = value => finite(value?.raw) ? value.raw : finite(value) ? value : null;
export const normalizeSymbol = input => TickerView.normalizeSymbol(input);
const dateFormatters = new Map();
export function sessionDate(timestamp, timezone = 'America/New_York') {
  if (!finite(timestamp)) return null;
  try {
    if (!dateFormatters.has(timezone)) dateFormatters.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }));
    return dateFormatters.get(timezone).format(new Date(timestamp * 1000));
  }
  catch { return new Date(timestamp * 1000).toISOString().slice(0, 10); }
}
export function bars(result) {
  const q = result?.indicators?.quote?.[0] || {};
  return (result?.timestamp || []).flatMap((time, i) => finite(time) && finite(q.close?.[i]) ? [{
    time, close: q.close[i], volume: finite(q.volume?.[i]) ? q.volume[i] : null,
    high: finite(q.high?.[i]) ? q.high[i] : null, low: finite(q.low?.[i]) ? q.low[i] : null,
    open: finite(q.open?.[i]) ? q.open[i] : null
  }] : []);
}
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
function sma(values, period) { return values.length < period ? null : mean(values.slice(-period)); }
export function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = values[i] - values[i - 1]; gain += Math.max(d, 0); loss += Math.max(-d, 0); }
  gain /= period; loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  return gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}
export function regularSessionBars(result, date) {
  const timezone = result.meta?.exchangeTimezoneName || 'America/New_York';
  const period = result.meta?.currentTradingPeriod?.regular;
  // Intraday chart requests exclude extended hours. At premarket, Yahoo may
  // describe today's trading period while returning yesterday's regular bars.
  // Apply absolute period bounds only when they belong to the requested session.
  const matchingPeriod = period && sessionDate(period.start, timezone) === date;
  return bars(result).filter(p => sessionDate(p.time, timezone) === date &&
    (!matchingPeriod || (p.time >= period.start && p.time < period.end)));
}
export function priceData(result) {
  const m = result.meta || {};
  const timezone = m.exchangeTimezoneName || 'America/New_York';
  const date = sessionDate(m.regularMarketTime, timezone);
  const previous = raw(m.previousClose) ?? raw(m.regularMarketPreviousClose);
  const price = raw(m.regularMarketPrice);
  const change = price != null && previous > 0 ? price - previous : null;
  const period = m.currentTradingPeriod || {};
  const now = Date.now() / 1000;
  const marketState = ['pre', 'regular', 'post'].find(key => period[key]?.start <= now && now < period[key]?.end) || 'closed';
  const sessionBars = regularSessionBars(result, date);
  const volumeBars = sessionBars.filter(p => p.volume != null && p.volume > 0);
  const vol = volumeBars.reduce((a, b) => a + b.volume, 0);
  const vwap = vol ? volumeBars.reduce((a, b) => a + b.close * b.volume, 0) / vol : null;
  return {
    symbol: m.symbol, longName: m.longName || m.shortName || m.symbol,
    currency: m.currency || '', exchange: m.fullExchangeName || m.exchangeName || '', timezone,
    quoteTime: m.regularMarketTime, sessionDate: date, marketState,
    regularMarketPrice: price, regularMarketChange: change,
    regularMarketChangePercent: change != null ? change / previous * 100 : null,
    regularMarketVolume: raw(m.regularMarketVolume), marketCap: raw(m.marketCap), vwap,
    vwapDist: vwap && price != null ? (price / vwap - 1) * 100 : null,
    fiftyTwoWeekRange: finite(m.fiftyTwoWeekLow) && finite(m.fiftyTwoWeekHigh) ? `${m.fiftyTwoWeekLow.toFixed(2)} – ${m.fiftyTwoWeekHigh.toFixed(2)}` : null
  };
}
export function technicals(result, live = priceData(result), intradayResult = null) {
  const m = result.meta || {}, timezone = live.timezone;
  let all = bars(result).filter(p => sessionDate(p.time, timezone) <= live.sessionDate);
  // Rebuild today's candle from the fresh intraday bars while reusing historical data.
  // This keeps live indicators current without downloading two years on every hover.
  if (intradayResult && live.regularMarketPrice != null) {
    const today = regularSessionBars(intradayResult, live.sessionDate);
    if (today.length) {
      const highs = today.flatMap(p => p.high != null ? [p.high] : []);
      const lows = today.flatMap(p => p.low != null ? [p.low] : []);
      all = all.filter(p => sessionDate(p.time, timezone) !== live.sessionDate);
      all.push({ time: today[0].time, open: today[0].open, close: live.regularMarketPrice,
        high: highs.length ? Math.max(...highs) : null, low: lows.length ? Math.min(...lows) : null,
        volume: live.regularMarketVolume });
    }
  }
  const historical = all.filter(p => sessionDate(p.time, timezone) < live.sessionDate);
  const current = all.findLast(p => sessionDate(p.time, timezone) === live.sessionDate);
  const previous = historical.at(-1);
  const values = all.map(p => p.close), price = live.regularMarketPrice;
  const ma20 = sma(values, 20), ma50 = sma(values, 50), ma200 = sma(values, 200);
  const std = values.length >= 20 ? Math.sqrt(mean(values.slice(-20).map(v => (v - ma20) ** 2))) : null;
  const ranges = all.slice(1).flatMap((p, i) => p.high != null && p.low != null ? [Math.max(p.high - p.low, Math.abs(p.high - all[i].close), Math.abs(p.low - all[i].close))] : []);
  let atr = ranges.length >= 14 ? mean(ranges.slice(0, 14)) : null;
  for (let i = 14; i < ranges.length; i++) atr = (atr * 13 + ranges[i]) / 14;
  const adr = all.flatMap(p => p.high != null && p.low > 0 ? [(p.high / p.low - 1) * 100] : []);
  const avgVol = sma(historical.flatMap(p => p.volume != null ? [p.volume] : []), 50);
  const baseline = previous?.close;
  const change = price != null && baseline > 0 ? price - baseline : null;
  return {
    fiftyDayAverage: ma50, twoHundredDayAverage: ma200, rsi: rsi(values), atr,
    atrPct: atr != null && price > 0 ? atr / price * 100 : null,
    dist200: ma200 && price != null ? (price / ma200 - 1) * 100 : null,
    zScore: std > 0 && price != null ? (price - ma20) / std : null,
    bbPct: std > 0 && price != null ? (price - (ma20 - 2 * std)) / (4 * std) * 100 : null,
    adrPct: sma(adr, 20), rvol: avgVol > 0 && live.regularMarketVolume != null ? live.regularMarketVolume / avgVol : null,
    gapPct: current?.open != null && baseline > 0 ? (current.open / baseline - 1) * 100 : null,
    keyLevelStatus: previous?.high != null && previous?.low != null && price != null ? price > previous.high ? 'Breakout' : price < previous.low ? 'Breakdown' : 'Inside' : null,
    regularMarketChange: change ?? live.regularMarketChange,
    regularMarketChangePercent: change != null ? change / baseline * 100 : live.regularMarketChangePercent,
    dailyQuoteTime: m.regularMarketTime
  };
}
export function benchmark(result) {
  const quote = priceData(result);
  const tech = technicals(result, quote);
  return { change: tech.regularMarketChangePercent, date: quote.sessionDate };
}
const sectorMap = { technology: 'XLK', 'communication services': 'XLC', 'consumer cyclical': 'XLY', 'financial services': 'XLF', healthcare: 'XLV', energy: 'XLE', industrials: 'XLI', 'real estate': 'XLRE', utilities: 'XLU', 'basic materials': 'XLB', 'consumer defensive': 'XLP' };
export function sectorETF(sector, industry) { return /semiconductor/i.test(industry || '') ? 'SMH' : sectorMap[(sector || '').toLowerCase()] || null; }
export function profileData(s = {}) {
  const price = s.price || {}, profile = s.summaryProfile || s.assetProfile || {}, f = s.financialData || {}, k = s.defaultKeyStatistics || {};
  const earnings = s.calendarEvents?.earnings?.earningsDate?.[0];
  return {
    longName: price.longName || price.shortName, sector: profile.sector, industry: profile.industry,
    marketCap: raw(s.summaryDetail?.marketCap) ?? raw(price.marketCap),
    fundamentals: {
      trailingPE: raw(s.summaryDetail?.trailingPE), forwardPE: raw(s.summaryDetail?.forwardPE) ?? raw(k.forwardPE),
      // Yahoo can divide an ADR's USD market cap by JPY revenue without converting.
      priceToSales: price.currency && f.financialCurrency && price.currency !== f.financialCurrency ? null : raw(s.summaryDetail?.priceToSalesTrailing12Months), priceToBook: raw(k.priceToBook),
      enterpriseToEbitda: raw(k.enterpriseToEbitda), trailingEps: raw(k.trailingEps),
      revenue: raw(f.totalRevenue), revenueGrowth: raw(f.revenueGrowth), earningsGrowth: raw(f.earningsGrowth),
      profitMargin: raw(f.profitMargins), operatingMargin: raw(f.operatingMargins), returnOnEquity: raw(f.returnOnEquity),
      freeCashFlow: raw(f.freeCashflow), totalCash: raw(f.totalCash), totalDebt: raw(f.totalDebt),
      currency: f.financialCurrency || null, quoteCurrency: price.currency || null,
      fiscalYearEnd: raw(k.lastFiscalYearEnd)
    },
    earningsTimestamp: raw(earnings), earningsDate: earnings?.fmt,
    shortFloatPct: raw(k.shortPercentOfFloat) != null ? raw(k.shortPercentOfFloat) * 100 : null,
    shortRatio: raw(k.shortRatio), shortInterestTimestamp: raw(k.dateShortInterest), targetLow: raw(f.targetLowPrice), targetMean: raw(f.targetMeanPrice), targetHigh: raw(f.targetHighPrice),
    analystCount: raw(f.numberOfAnalystOpinions), recKey: f.recommendationKey,
    extendedPrice: price.marketState === 'PRE' ? raw(price.preMarketPrice) : ['POST', 'CLOSED'].includes(price.marketState) ? raw(price.postMarketPrice) : null,
    extendedTime: price.marketState === 'PRE' ? raw(price.preMarketTime) : raw(price.postMarketTime)
  };
}
const categories = {
  corporate: /\b(earnings|dividend|buyback|merger|acquisition|layoffs?|guidance|revenue|profit|beat|miss|ceo|product|launch|partnership)\b/i,
  macro: /\b(inflation|cpi|fed|rates|gdp|unemployment|economy|interest|yield|treasury|debt)\b/i,
  regulation: /\b(sec|lawsuit|fine|court|antitrust|regulator|legal|probe|investigation|compliance)\b/i,
  retail: /\b(reddit|squeeze|retail|moon|rocket|pump|dump|trending|social|community)\b/i
};
const weights = { surge: 2, breakout: 2, moon: 2, beat: 1.5, growth: 1.2, buy: 1.2, positive: 1, climb: 1, strong: 1.2, higher: .8, profit: 1, optimistic: 1, partnership: 1.5, upgrade: 1.5, innovative: 1, crash: -2.5, plunge: -2, slump: -1.8, miss: -1.5, layoff: -2, fine: -2, lawsuit: -1.5, negative: -1, drop: -1, fall: -.8, underperform: -1.5, risk: -1.2, inflation: -1, downgrade: -1.5, bankruptcy: -2.5, insolvency: -2.5, debt: -1 };
export function sentiment(news = [], symbol, now = Date.now() / 1000) {
  const seen = new Set();
  const items = news.filter(item => {
    const title = (item.title || '').trim();
    if (!title || seen.has(title.toLowerCase())) return false;
    seen.add(title.toLowerCase());
    // Discard search results explicitly associated only with other instruments.
    return !Array.isArray(item.relatedTickers) || !item.relatedTickers.length || item.relatedTickers.includes(symbol);
  }).map(item => {
    const time = Number(item.providerPublishTime);
    const age = (now - time) / 3600;
    const decay = Number.isFinite(age) && age >= 0 && age < 48 ? 1 - age / 48 : 0;
    const tokens = (item.title.toLowerCase().match(/[a-z]+/g) || []);
    const matched = [...new Set(tokens)].filter(word => Object.hasOwn(weights, word));
    const score = matched.reduce((sum, word) => sum + weights[word], 0) * decay;
    return { title: item.title, url: item.link, time: finite(time) ? time : null, matched, decay, score,
      categories: Object.entries(categories).filter(([, regex]) => regex.test(item.title)).map(([name]) => name) };
  }).slice(0, 20);
  const verdict = list => {
    const fresh = list.filter(x => x.decay > 0);
    // Divide by article count, not decayed weight: old evidence fades toward zero.
    const score = fresh.length ? fresh.reduce((sum, x) => sum + x.score, 0) / fresh.length : 0;
    return { score, count: fresh.length, label: !fresh.length ? 'No fresh news' : score > .1 ? 'Bullish' : score < -.1 ? 'Bearish' : 'Neutral' };
  };
  return { total: verdict(items), ...Object.fromEntries(Object.keys(categories).map(cat => [cat, verdict(items.filter(item => item.categories.includes(cat)))])), items };
}
