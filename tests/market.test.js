import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSymbol, sessionDate, bars, priceData, technicals, benchmark, sentiment, profileData, rsi } from '../market.js';
const ts = text => Date.parse(text) / 1000;
function fixture() {
  return { meta: { symbol: 'AAPL', regularMarketPrice: 110, previousClose: 100,
    chartPreviousClose: 50, regularMarketTime: ts('2026-10-23T15:00Z'), regularMarketVolume: 200,
    currency: 'USD', exchangeTimezoneName: 'America/New_York' },
    timestamp: [ts('2026-10-21T13:30Z'), ts('2026-10-22T13:30Z'), ts('2026-10-23T13:30Z')],
    indicators: { quote: [{ close: [90, 100, 110], high: [95, 105, 112], low: [88, 98, 104], open: [89, 99, 105], volume: [100, 100, 200] }] } };
}
test('share classes are mapped while international suffixes remain intact', () => {
  assert.equal(normalizeSymbol('$brk.b'), 'BRK-B');
  assert.equal(normalizeSymbol('VOD.L'), 'VOD.L');
  assert.equal(normalizeSymbol('7203.T'), '7203.T');
  for (const input of ['../AAPL', '<script>', '', null]) assert.throws(() => normalizeSymbol(input));
});
test('exchange date uses the instrument timezone across midnight and DST', () => {
  assert.equal(sessionDate(ts('2026-10-23T01:00Z'), 'America/New_York'), '2026-10-22');
  assert.equal(sessionDate(ts('2026-03-09T03:30Z'), 'America/New_York'), '2026-03-08');
});
test('price and volume remain aligned when fields are null or zero', () => {
  const f = fixture(); f.indicators.quote[0].close[1] = null; f.indicators.quote[0].volume[0] = null;
  assert.deepEqual(bars(f).map(p => [p.close, p.volume]), [[90, null], [110, 200]]);
  f.indicators.quote[0].volume[2] = 0; assert.equal(bars(f).at(-1).volume, 0);
});
test('daily returns and gaps use prior session close, never range start close', () => {
  const f = fixture(), p = priceData(f), t = technicals(f, p);
  assert.equal(p.regularMarketChangePercent, 10);
  assert.equal(t.regularMarketChangePercent, 10);
  assert.ok(Math.abs(t.gapPct - 5) < 1e-10);
  assert.equal(t.keyLevelStatus, 'Breakout');
  assert.deepEqual(benchmark(f), { change: 10, date: '2026-10-23' });
});
test('before a new session opens, levels reference the session preceding the quote date', () => {
  const f = fixture(); f.meta.regularMarketTime = ts('2026-10-22T20:00Z'); f.meta.regularMarketPrice = 100;
  const t = technicals(f, priceData(f));
  assert.equal(t.regularMarketChange, 10); assert.equal(t.keyLevelStatus, 'Breakout');
  assert.ok(Math.abs(t.gapPct - 10) < 1e-10);
});
test('VWAP includes only matching regular-session bars and aligned volumes', () => {
  const f = fixture(); f.meta.currentTradingPeriod = { regular: { start: ts('2026-10-23T13:30Z'), end: ts('2026-10-23T20:00Z') } };
  assert.equal(priceData(f).vwap, 110);
});
test('volume ratio excludes current partial session from its 50-session baseline', () => {
  const f = fixture(); const start = ts('2026-08-01T14:00Z');
  f.timestamp = Array.from({ length: 51 }, (_, i) => start + i * 86400);
  f.meta.regularMarketTime = f.timestamp.at(-1); f.meta.regularMarketVolume = 50;
  f.indicators.quote[0] = { close: Array(51).fill(100), high: Array(51).fill(101), low: Array(51).fill(99), open: Array(51).fill(100), volume: [...Array(50).fill(100), 50] };
  assert.equal(technicals(f, priceData(f)).rvol, .5);
});
test('flat RSI is neutral and zero fundamentals survive parsing', () => {
  assert.equal(rsi(Array(20).fill(10)), 50);
  assert.equal(profileData({ defaultKeyStatistics: { shortPercentOfFloat: { raw: 0 } } }).shortFloatPct, 0);
});
test('sentiment evidence decays toward neutral and expires after 48h', () => {
  const now = ts('2026-10-23T15:00Z');
  const news = hours => [{ title: 'AAPL surge', providerPublishTime: now - hours * 3600, relatedTickers: ['AAPL'] }];
  assert.equal(sentiment(news(0), 'AAPL', now).total.score, 2);
  assert.equal(sentiment(news(24), 'AAPL', now).total.score, 1);
  assert.equal(sentiment(news(49), 'AAPL', now).total.label, 'No fresh news');
  assert.equal(sentiment([{ title: 'AAPL surge' }], 'AAPL', now).total.count, 0);
  assert.equal(sentiment(news(-1), 'AAPL', now).total.count, 0);
});
test('sentiment matches words, filters unrelated instruments and deduplicates titles', () => {
  const now = ts('2026-10-23T15:00Z');
  const news = [{ title: 'AAPL subscription updates', providerPublishTime: now },
    { title: 'AAPL surge', providerPublishTime: now }, { title: 'AAPL surge', providerPublishTime: now },
    { title: 'Other stock crash', providerPublishTime: now, relatedTickers: ['MSFT'] }];
  const s = sentiment(news, 'AAPL', now);
  assert.equal(s.items.length, 2); assert.equal(s.total.score, 1);
  assert.deepEqual(s.items[0].matched, []); assert.deepEqual(s.items[1].matched, ['surge']);
});
test('fresh intraday session replaces stale daily candle without refetching history', () => {
  const history = fixture(), intra = fixture();
  intra.meta.regularMarketPrice = 120;
  intra.indicators.quote[0].high[2] = 125;
  intra.indicators.quote[0].low[2] = 102;
  intra.indicators.quote[0].open[2] = 107;
  const original = structuredClone(history);
  const t = technicals(history, priceData(intra), intra);
  assert.equal(t.regularMarketChangePercent, 20);
  assert.ok(Math.abs(t.gapPct - 7) < 1e-10);
  assert.deepEqual(history, original);
});
test('premarket metadata for today does not discard yesterday’s VWAP or daily candle', () => {
  const f = fixture();
  f.meta.currentTradingPeriod = { regular: { start: ts('2026-10-24T13:30Z'), end: ts('2026-10-24T20:00Z') } };
  const quote = priceData(f);
  assert.equal(quote.vwap, 110); assert.equal(quote.vwapDist, 0);
  const t = technicals(f, quote, f);
  assert.ok(Math.abs(t.gapPct - 5) < 1e-10);
});
test('symbol validation rejects historical currency matches but retains numeric exchange listings', () => {
  for (const symbol of ['5B', '500M', '5.8B', '$39B']) assert.throws(() => normalizeSymbol(symbol));
  assert.equal(normalizeSymbol('0700.HK'), '0700.HK');
  assert.equal(normalizeSymbol('ES=F'), 'ES=F');
});
