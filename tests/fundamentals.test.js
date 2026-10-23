import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { yahooSnapshot } from '../fundamentals.js';
import { profileData } from '../market.js';
const html = await readFile(new URL('./fixtures/yahoo-meta.html', import.meta.url), 'utf8');
test('public statistics snapshot extracts structured fundamentals, targets, dates and units', () => {
  const data = yahooSnapshot(html, 'META');
  assert.equal(data.provider, 'Yahoo Finance'); assert.equal(data.quote.marketCap, 1652949385216);
  assert.equal(data.quote.shortFloatPct, 1.52); assert.equal(data.quote.shortRatio, 1.44);
  assert.equal(data.quote.targetMean, 843.48); assert.equal(data.quote.targetLow, 600);
  assert.equal(data.quote.targetHigh, 1050); assert.equal(data.quote.analystCount, 58);
  assert.equal(data.quote.shortInterestTimestamp, 1790726400);
});
test('rejects wrong instruments, failed envelopes and unrelated sources', () => {
  assert.throws(() => yahooSnapshot(html, 'MSFT'), /not returned/);
  assert.throws(() => yahooSnapshot(html.replace('"status":200', '"status":403'), 'META'), /not returned/);
  assert.throws(() => yahooSnapshot(html.replace('query1.finance.yahoo.com', 'example.com'), 'META'), /not returned/);
  assert.throws(() => yahooSnapshot('<title>Verify your browser</title>', 'META'), /not returned/);
});
test('ignores executable scripts and malformed payloads without running page code', () => {
  const decorated = '<script>throw new Error("must not execute")</script><script type="application/json" data-sveltekit-fetched data-url="https://query1.finance.yahoo.com/v10/finance/quoteSummary/META">invalid json</script>' + html;
  assert.equal(yahooSnapshot(decorated, 'META').quote.marketCap, 1652949385216);
});
test('zero short float survives percentage conversion', () => {
  assert.equal(yahooSnapshot(html.replace('0.0152', '0'), 'META').quote.shortFloatPct, 0);
});

test('company fundamentals retain reporting currencies, negative earnings, zero growth and absent values', () => {
  const { fundamentals: f } = profileData({
    price: { currency: 'USD' }, summaryDetail: { trailingPE: { raw: 20 }, forwardPE: 18, priceToSalesTrailing12Months: 3 },
    defaultKeyStatistics: { trailingEps: { raw: -2 }, priceToBook: 1.5, enterpriseToEbitda: 10 },
    financialData: { financialCurrency: 'JPY', totalRevenue: { raw: 4e12 }, revenueGrowth: { raw: 0 }, profitMargins: { raw: -.02 }, totalDebt: 0 }
  });
  assert.equal(f.currency, 'JPY'); assert.equal(f.quoteCurrency, 'USD');
  assert.equal(f.priceToSales, null); // Do not expose the provider's mixed-currency ADR multiple.
  assert.equal(f.revenue, 4e12); assert.equal(f.trailingPE, 20); assert.equal(f.forwardPE, 18);
  assert.equal(f.trailingEps, -2); assert.equal(f.revenueGrowth, 0); assert.equal(f.profitMargin, -.02);
  assert.equal(f.totalDebt, 0); assert.equal(f.freeCashFlow, null);
  assert.equal(profileData().fundamentals.trailingPE, null);
});
