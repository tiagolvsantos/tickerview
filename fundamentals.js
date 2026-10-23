import { profileData } from './market.js';

// Yahoo publishes its quote-summary JSON in the server-rendered statistics page.
// Read only inert JSON payloads; never evaluate the page's JavaScript or HTML.
export function yahooSnapshot(html, symbol) {
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bdata-sveltekit-fetched\b/i.test(attributes) || !/\btype=["']application\/json["']/i.test(attributes)) continue;
    const source = attributes.match(/\bdata-url=(["'])(.*?)\1/i)?.[2]?.replace(/&amp;/g, '&');
    if (!source) continue;
    try {
      const url = new URL(source);
      if (!['query1.finance.yahoo.com', 'query2.finance.yahoo.com'].includes(url.hostname)) continue;
      if (!/^\/v\d+\/finance\/quoteSummary\//.test(url.pathname) || decodeURIComponent(url.pathname.split('/').at(-1)).toUpperCase() !== symbol.toUpperCase()) continue;
      const envelope = JSON.parse(body);
      if (envelope.status !== 200) continue;
      const data = typeof envelope.body === 'string' ? JSON.parse(envelope.body) : envelope.body;
      const result = data?.quoteSummary?.result?.find(item => item.price?.symbol?.toUpperCase() === symbol.toUpperCase());
      if (!result) continue;
      const quote = profileData(result);
      if (![quote.marketCap, quote.shortFloatPct, quote.shortRatio, quote.targetMean].some(value => typeof value === 'number' && Number.isFinite(value))) continue;
      return { quote, provider: 'Yahoo Finance', url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/key-statistics/` };
    } catch { /* Ignore unrelated, malformed, or mismatched payloads. */ }
  }
  throw new Error('Published fundamentals were not returned for this instrument');
}
