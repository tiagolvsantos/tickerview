// Render the actual extension UI with deterministic demo data for repository images.
// No live provider requests, accounts, or external font services are used.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, timezoneId: 'Europe/Lisbon', locale: 'en-US' });
const errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.addInitScript(() => {
  const now = Date.parse('2026-10-23T17:15:00Z');
  Date.now = () => now;
  const listeners = [];
  const values = {
    settings: { enabled: true, hoverDelay: 150, compact: true, reducedEffects: false, disabledSites: [], indicators: ['marketCap', 'regularMarketVolume', 'rvol', 'relStrength', 'rsi', 'atr', 'vwap', 'keyLevelStatus'] },
    marketOverview: Object.fromEntries([['SPY', 659.12, .48], ['QQQ', 613.55, .72], ['^VIX', 18.24, -1.35], ['BTC-USD', 81296.35, -.02]].map(([symbol, price, changePercent]) => [symbol, { symbol, price, changePercent, currency: 'USD', fetchedAt: now, quoteTime: now / 1000 }])),
    watchlist: ['NVDA', 'AAPL'], recent: ['AMD', 'TSLA', 'VOD.L'],
    quoteSnapshots: { NVDA: { name: 'NVIDIA Corporation', price: 186.42, change: 4.81, fetchedAt: now, changePercent: 2.65, currency: 'USD', quoteTime: now / 1000 }, AAPL: { name: 'Apple Inc.', price: 245.38, change: -2.08, fetchedAt: now, changePercent: -.84, currency: 'USD', quoteTime: now / 1000 } }
  };
  const prices = [181.7, 182.1, 181.8, 182.7, 182.4, 183.2, 182.9, 183.6, 183.3, 183.8, 184.4, 183.9, 184.6, 184.2, 185, 184.8, 185.6, 185.2, 185.8, 185.5, 186.1, 185.7, 186.2, 186.42];
  const points = prices.map((close, i) => ({ time: now / 1000 - (prices.length - i - 1) * 300, close, volume: 260000 + (i * 97123) % 700000 }));
  const status = { fetchedAt: now, stale: false };
  const verdict = (label, score, count) => ({ label, score, count });
  const sentiment = {
    total: verdict('Bullish', 2.15, 1), corporate: verdict('Bullish', 2.15, 1),
    macro: verdict('Neutral', 0, 0), regulation: verdict('Neutral', 0, 0), retail: verdict('Neutral', 0, 0),
    items: [{ title: 'Demo: demand growth supports a positive outlook', time: now / 1000 - 3600, matched: ['growth', 'positive'], decay: .98, score: 2.15 }]
  };
  window.chrome = {
    storage: {
      local: { get: async () => structuredClone(values) },
      onChanged: { addListener: listener => listeners.push(listener) }
    },
    tabs: { query: async () => [{ url: 'https://x.com/demo' }] },
    runtime: {
      getURL: path => `https://x.com/${path}`,
      getManifest: () => ({ content_scripts: [{ matches: ['https://*.x.com/*'] }] }),
      sendMessage: async request => {
        if (['overview', 'refreshDashboard'].includes(request.action)) return { success: true, marketOverview: values.marketOverview, outcomes: Object.fromEntries([...new Set([...TickerView.overviewSymbols, ...values.watchlist])].map(symbol => [symbol, { stale: false }])) };
        if (request.action === 'library') return { success: true, watchlist: values.watchlist, recent: values.recent, snapshots: values.quoteSnapshots };
        if (request.action === 'recent') return { success: true };
        if (request.action === 'base') return {
          success: true, status, quote: {
            symbol: 'NVDA', longName: 'NVIDIA Corporation', currency: 'USD', exchange: 'NASDAQ',
            timezone: 'America/New_York', quoteTime: now / 1000, sessionDate: '2026-10-23', marketState: 'regular',
            regularMarketPrice: 186.42, regularMarketChange: 4.81, regularMarketChangePercent: 2.65,
            regularMarketVolume: 38760000, vwap: 184.3, vwapDist: 1.15
          }, chart: { points, interval: '5m', timezone: 'America/New_York' }
        };
        if (request.action === 'technicals') return {
          success: true, status, sessionDate: '2026-10-23', quote: {
            regularMarketChange: 4.81, regularMarketChangePercent: 2.65, rvol: 1.42, rsi: 62.8, atr: 5.34,
            twoHundredDayAverage: 152.6, gapPct: 1.2, keyLevelStatus: 'Breakout'
          }
        };
        if (request.action === 'details') return {
          success: true, quote: { instrumentType: 'EQUITY', sector: 'Technology', industry: 'Semiconductors', marketCap: 4530000000000, sectorEtf: 'SMH', shortFloatPct: 1.2, shortRatio: 1.4,
            ...(['fundamentals', 'news', 'valuation'].some(type => location.pathname.endsWith(type)) ? { earningsTimestamp: Date.parse('2026-11-18T21:00:00Z') / 1000,
            targetLow: 160, targetMean: 215, targetHigh: 260, analystCount: 42, recKey: 'buy' } : {}),
            fundamentals: { trailingPE: 42.8, forwardPE: 31.2, priceToSales: 23.4, priceToBook: 28.6, enterpriseToEbitda: 35.1, trailingEps: 4.36, revenue: 193600000000, revenueGrowth: .384, earningsGrowth: .42, profitMargin: .526, operatingMargin: .612, returnOnEquity: .948, freeCashFlow: 86200000000, totalCash: 60800000000, totalDebt: 8500000000, currency: 'USD', quoteCurrency: 'USD', fiscalYearEnd: Date.parse('2026-01-25T00:00:00Z') / 1000 }, categorySentiment: sentiment },
          benchmarks: { spy: { change: .8, date: '2026-10-23' }, sector: { change: 1.1, date: '2026-10-23' } },
          sources: { profile: { ...status, provider: 'Yahoo Finance' }, news: status, spy: status, sector: status }, issues: []
        };
        if (request.action === 'chart') return { success: true, status, chart: { points, interval: '5m', timezone: 'America/New_York' } };
        if (request.action === 'watch') return { success: true, watchlist: values.watchlist };
        return { success: true };
      }
    }
  };
});
const stageStyles = `
@font-face{font-family:Showcase;src:url('/fonts/Montserrat.ttf');font-weight:100 900;font-display:swap}
@font-face{font-family:ShowcaseMono;src:url('/fonts/IBMPlexMono-Regular.ttf');font-display:swap}
*{box-sizing:border-box}html,body{margin:0;width:1280px;height:800px;overflow:hidden}
body{background:#0B1220;color:#C0C6CF;font:14px/1.6 Showcase,sans-serif;border-top:3px solid #FF6600;background-image:linear-gradient(#c0c6cf06 1px,transparent 1px),linear-gradient(90deg,#c0c6cf06 1px,transparent 1px);background-size:32px 32px}
.stage-brand{position:absolute;left:64px;top:42px;display:flex;gap:14px;align-items:center}
.stage-brand img{width:48px;height:48px;border:1px solid #2E3642;border-radius:3px}
.stage-brand strong{display:block;font-size:12px;letter-spacing:.18em;color:#EDF0F4}
.stage-brand span{font:10px ShowcaseMono,monospace;color:#8D9BAD;letter-spacing:.03em}
.stage-tag{margin-left:20px;padding:4px 8px;border:1px solid #2E3642;color:#FF8533!important;font-size:9px!important}
.stage-copy{position:absolute;left:64px;top:146px;width:655px}
.stage-eyebrow{font:10px ShowcaseMono,monospace;letter-spacing:.18em;color:#FF8533;text-transform:uppercase}
h1{font:700 52px/1.16 Showcase,sans-serif;letter-spacing:-.035em;color:#EDF0F4;margin:17px 0 22px}h1 em{font-style:normal;color:#FF8533}
.stage-description{font-size:16px;line-height:1.7;max-width:570px;margin:0;color:#A1ADBD}
.stage-feed{margin-top:32px;padding:20px 22px;border:1px solid #2E3642;border-left:2px solid #FF6600;background:#101925;width:600px;border-radius:3px}
.feed-heading{display:flex;gap:10px;align-items:center;font:9px ShowcaseMono,monospace;letter-spacing:.12em;color:#8D9BAD}
.feed-dot{width:6px;height:6px;background:#FF6600}.stage-feed p{font-size:15px;line-height:1.9;margin:15px 0 12px;color:#C0C6CF}
.feed-footer{display:flex;gap:14px;color:#8D9BAD;font:10px ShowcaseMono,monospace}.feed-footer span:first-child{color:#FF8533}
.stage-features{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:30px;width:620px}
.stage-features div{border-top:1px solid #2E3642;padding-top:12px}.stage-features strong{display:block;font-size:12px;color:#EDF0F4;margin-bottom:5px}.stage-features span{font-size:11px;color:#8D9BAD;line-height:1.6;display:block}
.stage-footer{position:absolute;bottom:26px;left:64px;right:64px;display:flex;justify-content:space-between;border-top:1px solid #2E3642;padding-top:14px;font:9px ShowcaseMono,monospace;color:#8D9BAD;letter-spacing:.03em}
.stage-steps{margin-top:32px;width:600px;display:grid;gap:0}
.stage-step{display:flex;gap:18px;padding:18px 0;border-top:1px solid #2E3642}.stage-step:last-child{border-bottom:1px solid #2E3642}
.stage-step b{font:12px ShowcaseMono,monospace;color:#FF8533;padding-top:1px}.stage-step strong{display:block;font-size:14px;color:#EDF0F4;margin-bottom:4px}.stage-step p{font-size:12px;color:#A1ADBD;margin:0;max-width:480px}
.popup-frame{position:absolute;left:778px;top:42px;width:422px;height:690px;border:1px solid #2E3642;border-radius:4px;background:#0B1220;box-shadow:0 20px 50px #0005}
#tickerview-modal{left:778px!important;top:42px!important;max-height:696px!important;box-shadow:0 20px 50px #0005!important}
`;
function stage(type) {
  const one = !['settings', 'controls'].includes(type);
  const copy = {
    card: ['THE HOVER CARD', 'Market context.<br><em>One hover away.</em>', 'Quotes, charts, and technicals.<br>Right where you read.'],
    settings: ['YOUR SYMBOLS', 'Follow the names.<br><em>Keep the context.</em>', 'A local watchlist with cached prices.<br>Open any saved or recent symbol in one click.'],
    valuation: ['VALUE ESTIMATES', 'Explore value.<br><em>See the assumptions.</em>', 'Editable earnings scenarios and analyst targets.<br>Compare estimates with the current quote.'],
    fundamentals: ['COMPANY FUNDAMENTALS', 'Look beyond<br><em>the price.</em>', 'Valuation, profitability, and financial strength.<br>Company figures with clear reporting currencies.'],
    controls: ['MAKE IT YOURS', 'Less noise.<br><em>Your indicators.</em>', 'Choose a preset or select each metric.<br>Adjust the experience for the way you read.'],
    news: ['NEWS & RESEARCH', 'Read the story.<br><em>See the signals.</em>', 'Headline sentiment, earnings, analyst targets,<br>and direct links for deeper research.'],
    tweetdeck: ['X PRO / TWEETDECK', 'In your feed.<br><em>Across columns.</em>', 'Orange cashtags in X Pro and OldTweetDeck.<br>Keep the stock card pinned while you read.']
  }[type];
  const featureSets = {
    valuation: [['Earnings scenarios', 'EPS × assumed P/E.<br>Bear, base, and bull.'], ['Your assumptions', 'Edit and save multiples.<br>Reset to examples.'], ['Separate opinions', 'Analyst targets with<br>quote comparisons.']],
    fundamentals: [['Valuation', 'P/E, EPS, price / book,<br>and EV / EBITDA.'], ['Business performance', 'Revenue, growth,<br>margins, and ROE.'], ['Financial strength', 'Free cash flow,<br>cash, and debt.']],
    news: [['Explainable sentiment', 'Keyword evidence,<br>age, and decay.'], ['Upcoming catalysts', 'Earnings estimates<br>and analyst targets.'], ['Research shortcuts', 'TradingView, Finviz,<br>and insider activity.']],
    tweetdeck: [['Dynamic feeds', 'Split-span links<br>and recycled rows.'], ['Currency aware', 'Cash figures stay text.<br>Cashtags open a card.'], ['Keyboard friendly', 'Enter / Space to open.<br>Escape to dismiss.']],
    card: [['Interactive charts', 'Five timeframes.<br>Inspect price and volume.'], ['Technical context', 'RSI, ATR, VWAP,<br>and relative strength.'], ['Built for reading', 'Pin, save, refresh.<br>Keep your place.']]
  };
  const features = (featureSets[type] || featureSets.card).map(([title, body]) => `<div><strong>${title}</strong><span>${body}</span></div>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>TickerView feature showcase</title><link rel="stylesheet" href="/brand.css">${one ? '<link rel="stylesheet" href="/styles.css">' : ''}<style>${stageStyles}</style></head><body>
    <div class="stage-brand"><img src="/icons/icon128.png" alt="Cerberus"><div><strong>CERBERUS</strong><span>TickerView</span></div><span class="stage-tag">CHROME EXTENSION</span></div>
    <main class="stage-copy"><div class="stage-eyebrow">${copy[0]}</div>
      <h1>${copy[1]}</h1>
      <p class="stage-description">${copy[2]}</p>
      ${one ? `<article class="stage-feed"><div class="feed-heading"><span class="feed-dot"></span> RESEARCH FEED <span> / </span> DEMO</div><p>Watching ${type === 'tweetdeck' ? '<a id="demo-ticker" class="link-complex" href="https://x.com/search?q=%24NVDA"><span class="hash">$</span><span class="link-complex-target">NVDA</span></a>' : '<span id="demo-ticker">$NVDA</span>'} as semiconductors pick up momentum. ${type === 'tweetdeck' ? 'A $3.5B cash figure stays plain text while cashtags open stock information.' : 'Checking volume and strength against the broader market.'}</p><div class="feed-footer"><span>Hover to explore ↗</span><span>Stay in the conversation</span></div></article>
      <div class="stage-features">${features}</div>` : `<div class="stage-steps"><div class="stage-step"><b>01</b><div><strong>Control the experience</strong><p>Enable by site, set your hover delay, and choose a compact card or reduced effects.</p></div></div><div class="stage-step"><b>02</b><div><strong>Focus on your indicators</strong><p>Select the technical and fundamental metrics that matter to your process.</p></div></div><div class="stage-step"><b>03</b><div><strong>Keep your symbols close</strong><p>Save a watchlist, revisit recent tickers, and open research links. Stored locally in your browser.</p></div></div></div>`}
    </main>
    ${one ? '<script src="/shared.js"></script><script src="/content.js"></script>' : '<iframe class="popup-frame" src="/popup.html" title="TickerView settings and watchlist"></iframe>'}
    <footer class="stage-footer"><span>CERBERUS / TICKERVIEW</span><span>${one ? 'Illustrative demo data · not live quotes' : 'Actual extension interface · demonstration symbols'}</span></footer>
  </body></html>`;
}
await context.route('https://x.com/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (/^\/showcase-(card|settings|fundamentals|controls|news|tweetdeck|valuation)$/.test(path)) {
    await route.fulfill({ contentType: 'text/html', body: stage(path.replace('/showcase-', '')) }); return;
  }
  if (!/^\/(?:icons\/[\w.-]+\.png|fonts\/[\w.-]+\.ttf|[\w.-]+\.(?:js|css|html))$/.test(path)) { await route.abort(); return; }
  const contentType = path.endsWith('.png') ? 'image/png' : path.endsWith('.ttf') ? 'font/ttf' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html';
  await route.fulfill({ contentType, body: await readFile(new URL(path.slice(1), root)) });
});
try {
  const page = await context.newPage();
  const images = [];
  const types = ['card', 'settings', 'fundamentals', 'controls', 'news', 'tweetdeck', 'valuation'];
  for (const [index, type] of types.entries()) {
    await page.goto(`https://x.com/showcase-${type}`);
    if (['settings', 'controls'].includes(type)) {
      const frame = page.frameLocator('.popup-frame');
      await frame.locator('#settings:not([disabled])').waitFor({ state: 'attached' });
      await frame.locator('#watchlist .watch-row').last().waitFor();
      if (type === 'controls') {
        await frame.locator('#open-settings').click();
        await frame.getByRole('tab', { name: 'Cards', exact: true }).click();
        await frame.locator('.settings-dialog-body').evaluate(node => { node.scrollTop = 0; });
      }
      await page.evaluate(async () => { await document.fonts.ready; await document.querySelector('iframe').contentDocument.fonts.ready; });
      if (!await frame.locator('.brand-logo').evaluate(image => image.complete && image.naturalWidth > 0)) throw Error('Popup logo did not load');
    } else {
      const ticker = type === 'tweetdeck' ? '#demo-ticker.tickerview-highlight' : '#demo-ticker .tickerview-highlight';
      await page.locator(ticker).hover();
      await page.locator('.tv-price').filter({ hasText: '186.42' }).waitFor();
      await page.locator('[data-action="pin"]').click();
      await page.locator('[data-fundamental="revenue"]').waitFor();
      await page.locator('.tv-news summary').filter({ hasText: 'Bullish' }).waitFor();
      if (type !== 'valuation') await page.locator('.tv-valuation > summary').click();
      if (type !== 'fundamentals') await page.locator('.tv-fundamentals > summary').click();
      if (type === 'valuation') await page.locator('.tv-assumptions > summary').click();
      if (type === 'news') await page.locator('.tv-news > summary').click();
      await page.locator('#tickerview-modal').evaluate((node, type) => {
        if (type === 'valuation') node.scrollTop = node.querySelector('.tv-valuation').offsetTop - node.querySelector('.tv-chrome').offsetHeight - 12;
        else if (type === 'fundamentals') node.scrollTop = node.querySelector('.tv-fundamentals').offsetTop - 15;
        else if (type === 'news') node.scrollTop = node.scrollHeight;
      }, type);
      await page.mouse.move(740, 720);
      await page.evaluate(() => document.fonts.ready);
      if (!await page.locator('.tv-brand img').evaluate(image => image.complete && image.naturalWidth > 0)) throw Error('Card logo did not load');
    }
    const path = `images/image${index + 1}.png`;
    await page.screenshot({ path: fileURLToPath(new URL(path, root)) });
    images.push({ path, feature: type });
  }
  if (errors.length) throw Error(errors.join('\n'));
  console.log(JSON.stringify({ images, size: '1280 × 800', errors }, null, 2));
} finally { await browser.close(); }
