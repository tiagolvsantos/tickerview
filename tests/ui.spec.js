import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const file = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
async function mockChrome(page, { popup = false, initial = {}, url = 'https://x.com/tickerview-test' } = {}) {
  await page.route('https://x.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body><p id="one">Watching $AAPL</p><p id="two" style="margin-left:650px">Compare $MSFT</p><textarea>$EDIT</textarea><div contenteditable="true">$DRAFT</div></body></html>' }));
  await page.route(/https:\/\/x\.com\/(?:tickerview-assets\/)?(?:icons|fonts)\/[^/]+$/, async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/(?:tickerview-assets\/)?/, '');
    const body = await readFile(new URL(`../${path}`, import.meta.url));
    await route.fulfill({ contentType: path.endsWith('.png') ? 'image/png' : 'font/ttf', body });
  });
  await page.goto(url);
  await page.evaluate(initial => {
    const values = { settings: { hoverDelay: 0 }, watchlist: [], recent: [], ...initial }, listeners = [];
    window.testCalls = [];
    window.updateStorage = async patch => {
      const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: values[key], newValue: value }]));
      Object.assign(values, patch); listeners.forEach(fn => fn(changes, 'local'));
    };
    window.chrome = {
      storage: { local: { get: async () => structuredClone(values) }, onChanged: { addListener: fn => listeners.push(fn) } },
      tabs: { query: async () => [{ url: 'https://x.com/tickerview-test' }] },
      runtime: {
        getURL: path => `https://x.com/tickerview-assets/${path}`,
        getManifest: () => ({ content_scripts: [{ matches: ['https://*.x.com/*'] }] }),
        sendMessage: async request => {
          window.testCalls.push(request);
          if (request.action === 'recent') return { success: true };
          if (request.action === 'library') {
            values.watchlist = TickerView.cleanSymbols(values.watchlist); values.recent = TickerView.cleanSymbols(values.recent, 12);
            return { success: true, watchlist: values.watchlist, recent: values.recent, snapshots: values.quoteSnapshots || {} };
          }
          if (request.action === 'clearRecent') { await window.updateStorage({ recent: [] }); return { success: true }; }
          if (request.action === 'addWatch') {
            const symbol = TickerView.normalizeSymbol(request.ticker);
            if (symbol === 'NOPE') return { success: false, error: 'Could not verify this symbol' };
            await window.updateStorage({ watchlist: [...new Set([symbol, ...values.watchlist])] });
            return { success: true };
          }
          if (request.action === 'settings') {
            await window.updateStorage({ settings: { ...values.settings, ...request.patch, ...(request.site ? { disabledSites: request.siteEnabled ? [] : [request.site] } : {}) } });
            return { success: true };
          }
          if (request.action === 'watch') {
            const symbol = request.ticker.replace(/^([A-Z]+)\.([AB])$/, '$1-$2');
            const saved = values.watchlist.includes(symbol); const wanted = typeof request.saved === 'boolean' ? request.saved : !saved;
            const watchlist = wanted ? [...new Set([symbol, ...values.watchlist])] : values.watchlist.filter(x => x !== symbol);
            await window.updateStorage({ watchlist }); return { success: true, watchlist };
          }
          const ticker = request.ticker, delay = ticker === 'AAPL' ? 180 : 20;
          await new Promise(r => setTimeout(r, request.action === 'details' ? 350 : delay));
          const points = Array.from({ length: 15 }, (_, i) => ({ time: 1792762200 + i * 300, close: 100 + i, volume: i * 100 }));
          const status = { fetchedAt: Date.now(), stale: false };
          if (request.action === 'chart') return { success: true, chart: { points: points.map(p => ({ ...p, close: p.close + 20 })), interval: '1d', timezone: 'America/New_York' }, status };
          if (request.action === 'base') return { success: true, quote: { symbol: ticker, longName: ticker, currency: 'USD', exchange: 'NASDAQ', quoteTime: Date.now() / 1000, sessionDate: '2026-10-23', marketState: 'regular', regularMarketPrice: 114, regularMarketChange: 4, regularMarketChangePercent: 4 }, chart: { points, interval: '5m', timezone: 'America/New_York' }, status };
          if (request.action === 'technicals') return { success: true, quote: { rsi: 55, gapPct: 1, regularMarketChangePercent: 4 }, sessionDate: '2026-10-23', status };
          return { success: true, quote: { longName: `${ticker} Company`, sector: 'Technology', marketCap: 1.6e12, fundamentals: { trailingPE: 20, trailingEps: -2, revenue: 4e12, currency: 'JPY', quoteCurrency: 'USD', revenueGrowth: 0, profitMargin: -.02, totalDebt: 0 }, shortFloatPct: 1.53, shortRatio: 1.72, targetMean: 846, categorySentiment: { total: { label: 'Bullish', count: 1, score: 1 }, ...Object.fromEntries(['corporate','macro','regulation','retail'].map(cat => [cat, { label: 'Neutral', count: 0 }])), items: [{ title: 'Company surge', time: Date.now() / 1000, url: 'javascript:alert(1)', decay: 1, score: 2, matched: ['surge'] }] } }, benchmarks: { spy: { change: 2, date: '2026-10-23' }, sector: { change: 1, date: '2026-10-22' } }, sources: { profile: { ...status, provider: 'Yahoo Finance' } }, issues: [] };
        }
      }
    };
  }, initial);
  await page.addStyleTag({ content: await file('brand.css') });
  if (popup) {
    const html = (await file('popup.html')).replace(/<script.*?<\/script>/g, '').replace(/<link[^>]+>/g, '');
    await page.setContent(html); await page.addStyleTag({ content: await file('brand.css') }); await page.addStyleTag({ content: await file('popup.css') }); await page.addStyleTag({ content: await file('styles.css') });
  } else { await page.addStyleTag({ content: await file('styles.css') }); }
  await page.addScriptTag({ content: await file('shared.js') });
  await page.addScriptTag({ content: await file('content.js') });
  if (popup) await page.addScriptTag({ content: await file('popup.js') });
}
test('progressive card, stale-response protection, pin, watchlist, chart, keyboard and session benchmarks', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mockChrome(page);
  await expect(page.locator('.tickerview-highlight')).toHaveCount(2);
  await page.locator('#one .tickerview-highlight').hover();
  await expect(page.locator('.tv-price')).toHaveText('USD 114');
  await expect(page.locator('.tv-news summary')).toContainText('Loading');
  await page.locator('#two .tickerview-highlight').hover();
  await expect(page.locator('.tv-symbol')).toHaveText('$MSFT');
  await page.waitForTimeout(450);
  await expect(page.locator('.tv-fullname')).toHaveText('MSFT Company');
  await expect(page.locator('[data-indicator="marketCap"]')).toContainText('1.6T');
  await expect(page.locator('[data-indicator="shortFloatPct"]')).toContainText('1.53%');
  await expect(page.locator('[data-indicator="shortRatio"]')).toContainText('1.72');
  await expect(page.locator('.tv-source-dates')).toContainText('Yahoo Finance');
  await expect(page.locator('.tv-fundamentals')).toHaveAttribute('open', '');
  await expect(page.locator('[data-fundamental="revenue"]')).toContainText('JPY 4T');
  await expect(page.locator('[data-fundamental="trailingEps"]')).toContainText('USD -2');
  await expect(page.locator('[data-fundamental="revenueGrowth"]')).toContainText('0%');
  await expect(page.locator('[data-fundamental="profitMargin"]')).toContainText('-2%');
  await expect(page.locator('[data-fundamental="freeCashFlow"]')).toHaveCount(0);
  await expect(page.locator('.tv-extras')).toContainText('Analyst mean target: USD 846');
  await page.locator('[data-action="pin"]').click();
  await page.mouse.move(950, 700);
  await expect(page.locator('#tickerview-modal')).toBeVisible();
  await page.locator('[data-action="watch"]').click();
  await expect(page.locator('[data-action="watch"]')).toContainText('Saved');
  await page.locator('[data-range="1M"]').click();
  await expect(page.locator('.tv-chart-readout')).toContainText('134');
  await page.locator('.tv-chart').focus(); await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.tv-chart-readout')).toContainText('133');
  await expect(page.locator('.tv-stat-item').filter({ hasText: 'RS vs SPY' })).toContainText('2 pp');
  await expect(page.locator('.tv-stat-item').filter({ hasText: 'RS vs sector' })).toHaveCount(0);
  await expect(page.locator('.tv-extras .tv-missing')).toContainText('RS vs sector');
  expect(await page.locator('.tv-chart-line').evaluate(node => getComputedStyle(node).stroke)).toBe('rgb(255, 102, 0)');
  await page.locator('.tv-news summary').click();
  await expect(page.locator('.tv-news article')).toContainText('Matched: surge');
  await expect(page.locator('.tv-news a')).toHaveCount(0);
  await page.locator('#tickerview-modal').evaluate(node => { node.scrollTop = 0; });
  await expect(page.locator('[data-action="close"]')).toBeInViewport();
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.tv-brand img')).toBeVisible();
  expect(await page.locator('.tv-brand img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: 'test-results/card.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('#tickerview-modal')).toBeHidden();
  await page.locator('#one .tickerview-highlight').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-action="pin"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#one .tickerview-highlight')).toBeFocused();
  expect(errors).toEqual([]);
});
test('scanning handles dynamic text, international symbols, settings and large feeds', async ({ page }) => {
  await mockChrome(page);
  await page.evaluate(() => {
    const p = document.createElement('p'); p.id = 'dynamic'; p.textContent = '$BRK.B $VOD.L $7203.T $100'; document.body.append(p);
  });
  await expect(page.locator('#dynamic .tickerview-highlight')).toHaveCount(3);
  await expect(page.locator('[contenteditable] .tickerview-highlight')).toHaveCount(0);
  await page.evaluate(() => { document.querySelector('#dynamic').firstChild.textContent = '$TSLA '; });
  await expect(page.locator('#dynamic .tickerview-highlight')).toHaveCount(4);
  await page.evaluate(() => window.updateStorage({ settings: { enabled: false } }));
  await expect(page.locator('.tickerview-highlight')).toHaveCount(0);
  await page.evaluate(() => window.updateStorage({ settings: { enabled: true, reducedEffects: true, compact: true } }));
  await expect(page.locator('#tickerview-modal')).toHaveClass(/tv-reduced/);
  await expect(page.locator('.tickerview-highlight')).toHaveCount(6);
  await page.evaluate(() => {
    window.heartbeat = 0; window.beat = setInterval(() => window.heartbeat++, 5);
    const feed = document.createElement('section'); feed.id = 'feed';
    feed.innerHTML = Array.from({ length: 2000 }, (_, i) => `<p>Post ${i} $NVDA</p>`).join(''); document.body.append(feed);
  });
  await expect(page.locator('#feed .tickerview-highlight')).toHaveCount(2000, { timeout: 15000 });
  expect(await page.evaluate(() => { clearInterval(window.beat); return window.heartbeat; })).toBeGreaterThan(5);
});
test('popup settings, per-site toggle, normalized saved symbols and remove', async ({ page }) => {
  await mockChrome(page, { popup: true });
  await expect(page.locator('#settings')).toBeEnabled();
  await page.locator('.settings-panel').filter({ hasText: 'Appearance' }).locator('summary').click();
  await page.locator('#compact').check();
  await expect(page.locator('#status')).toContainText('Settings saved');
  await page.locator('#siteEnabled').uncheck();
  await expect(page.locator('#siteEnabled')).not.toBeChecked();
  await page.locator('#symbol').fill('BRK.B'); await page.locator('#add-symbol button').click();
  await expect(page.locator('#watchlist')).toContainText('BRK-B');
  await page.locator('#symbol').fill('BRK.B'); await page.locator('#add-symbol button').click();
  await expect(page.locator('#symbol-feedback')).toContainText('already saved');
  await expect(page.locator('#watchlist .watch-row')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator('.brand-logo').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: 'test-results/popup.png' });
  await page.getByRole('button', { name: 'Remove BRK-B' }).click();
  await expect(page.locator('#watchlist .watch-row')).toHaveCount(0);
});

test('late quote responses cannot overwrite another ticker or reopen a closed card', async ({ page }) => {
  await mockChrome(page);
  await expect(page.locator('.tickerview-highlight')).toHaveCount(2);
  await page.locator('#one .tickerview-highlight').dispatchEvent('mouseover');
  await expect(page.locator('.tv-symbol')).toHaveText('$AAPL');
  await page.locator('#two .tickerview-highlight').dispatchEvent('mouseover');
  await expect(page.locator('.tv-symbol')).toHaveText('$MSFT');
  await expect(page.locator('.tv-price')).toHaveText('USD 114');
  await page.waitForTimeout(250);
  await expect(page.locator('.tv-symbol')).toHaveText('$MSFT');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await expect(page.locator('#tickerview-modal')).toBeHidden();
});

test('cash amounts remain plain text while stock cashtags still work', async ({ page }) => {
  await mockChrome(page);
  const money = 'Toto Wolff says Mercedes F1 make $1B a year. Mercedes F1 valued at ~$5B (no NFL team under $5B...18 NBA teams over $5B). Also $5.8B, $2.5M, $10k, $12bn, $100, and $1,200.50.';
  await page.evaluate(text => {
    const article = document.createElement('article'); article.id = 'money'; article.textContent = text;
    const tickers = document.createElement('p'); tickers.id = 'stocks'; tickers.textContent = '$AAPL $BRK.B $VOD.L $7203.T $0700.HK';
    document.body.append(article, tickers);
  }, money);
  // Waiting for the following paragraph confirms this mutation batch was scanned.
  await expect(page.locator('#stocks .tickerview-highlight')).toHaveCount(5);
  await expect(page.locator('#money .tickerview-highlight')).toHaveCount(0);
  await expect(page.locator('#money')).toHaveText(money);
  expect(await page.locator('#stocks .tickerview-highlight').evaluateAll(nodes => nodes.map(node => node.dataset.ticker)))
    .toEqual(['AAPL', 'BRK.B', 'VOD.L', '7203.T', '0700.HK']);
});

test('TweetDeck split cashtags, recycled links, column scrolling and body replacement', async ({ page }) => {
  await mockChrome(page, { url: 'https://x.com/i/tweetdeck' });
  await page.evaluate(() => {
    const column = document.createElement('section'); column.id = 'deck-column'; column.style = 'width:320px;height:300px;overflow:auto';
    column.innerHTML = '<a id="native-cash" href="https://twitter.com/search?q=%24META" rel="hashtag" target="_blank" class="link-complex"><span class="hash">$</span><span class="link-complex-target">META</span></a><p><a id="native-money" href="#"><span>$</span><span>5B</span></a></p><div style="height:800px"></div>';
    document.body.append(column);
  });
  // Simulate TweetDeck's blue nested spans, including late styles with priority.
  await page.addStyleTag({ content: '.tweet-text a.link-complex, .tweet-text a.link-complex .hash, .tweet-text a.link-complex .link-complex-target { color: #1da1f2 !important; }' });
  await page.locator('#deck-column').evaluate(node => node.classList.add('tweet-text'));
  const link = page.locator('#native-cash');
  await expect(link).toHaveClass(/tickerview-highlight/);
  await expect(link.locator('span')).toHaveCount(2);
  await expect(link).toHaveCSS('color', 'rgb(255, 102, 0)');
  await expect(link.locator('.hash')).toHaveCSS('color', 'rgb(255, 102, 0)');
  await expect(link.locator('.link-complex-target')).toHaveCSS('color', 'rgb(255, 102, 0)');
  await expect(link).toHaveCSS('border-bottom-style', 'dotted');
  await expect(link.locator('.tickerview-highlight')).toHaveCount(0);
  await expect(link).toHaveAttribute('href', 'https://twitter.com/search?q=%24META');
  await expect(page.locator('#native-money')).not.toHaveClass(/tickerview-highlight/);
  await link.hover();
  await expect(link.locator('.link-complex-target')).toHaveCSS('color', 'rgb(255, 133, 51)');
  await expect(page.locator('.tv-symbol')).toHaveText('$META');
  await page.locator('[data-action="pin"]').click();
  await page.locator('#deck-column').evaluate(node => { node.scrollTop = 150; });
  await expect(page.locator('#tickerview-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#native-cash .link-complex-target').evaluate(node => { node.firstChild.textContent = 'NVDA'; });
  await expect(link).toHaveAttribute('data-ticker', 'NVDA');
  await page.evaluate(() => window.updateStorage({ settings: { enabled: false } }));
  await expect(link).not.toHaveClass(/tickerview-highlight/);
  await expect(link).toHaveAttribute('href', 'https://twitter.com/search?q=%24META');
  await expect(link.locator('span')).toHaveCount(2);
  await expect(link).not.toHaveAttribute('aria-label');
  await expect(link.locator('.link-complex-target')).toHaveCSS('color', 'rgb(29, 161, 242)');
  await page.evaluate(() => window.updateStorage({ settings: { enabled: true, hoverDelay: 0 } }));
  await expect(link).toHaveClass(/tickerview-highlight/);
  await page.evaluate(() => {
    const body = document.createElement('body'); body.innerHTML = '<a id="new-deck" href="/search?q=%24AMD"><span>$</span><span>AMD</span></a>'; document.body.replaceWith(body);
  });
  await expect(page.locator('#new-deck')).toHaveAttribute('data-ticker', 'AMD');
  await expect(page.locator('#tickerview-modal')).toHaveCount(1);
  await page.locator('#new-deck').hover(); await expect(page.locator('.tv-symbol')).toHaveText('$AMD');
});

test('popup presets, master switch, validated entry, cached rows, cards, recent save and clear', async ({ page }) => {
  await mockChrome(page, { popup: true, initial: {
    watchlist: ['AAPL'], recent: ['META', '5B', '500M', 'BRK.B'],
    quoteSnapshots: { AAPL: { name: 'Apple Inc.', price: 177.5, changePercent: 2.1, currency: 'USD', quoteTime: 1792753200 } }
  } });
  await expect(page.locator('#settings')).toBeEnabled();
  await expect(page.locator('#watchlist')).toContainText('Apple Inc.');
  await expect(page.locator('#watchlist')).toContainText('USD 177.5');
  await expect(page.locator('#watchlist')).toContainText('+2.10%');
  await expect(page.locator('#recent')).not.toContainText('5B');
  await expect(page.locator('#recent')).not.toContainText('500M');
  expect(await page.evaluate(() => window.testCalls.filter(call => ['base','details','technicals'].includes(call.action)))).toEqual([]);
  await page.locator('#enabled').uncheck(); await expect(page.locator('#siteEnabled')).toBeDisabled();
  await page.locator('#enabled').check(); await expect(page.locator('#siteEnabled')).toBeEnabled();
  await page.locator('#indicator-options summary').click(); await page.locator('[data-preset="Essential"]').click();
  await expect(page.locator('#indicator-count')).toHaveText('9 selected');
  await expect(page.locator('#indicators legend')).toHaveText(['Technicals', 'Fundamentals']);
  await page.locator('[data-preset="Technical"]').click(); await expect(page.locator('#indicator-count')).toHaveText('18 selected');
  await page.locator('[data-preset="All"]').click(); await expect(page.locator('#indicator-count')).toHaveText('21 selected');
  await page.locator('#indicator-options summary').click();
  await page.locator('#symbol').fill('$5B'); await page.locator('#symbol').press('Enter');
  await expect(page.locator('#symbol')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#symbol-feedback')).toContainText('currency amount');
  await page.locator('#symbol').fill('NOPE'); await page.locator('#symbol').press('Enter');
  await expect(page.locator('#symbol-feedback')).toContainText('Could not verify');
  await expect(page.locator('#watchlist .watch-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Save META to watchlist' }).click();
  await expect(page.locator('#watchlist .watch-row')).toHaveCount(2);
  await page.locator('#watchlist').getByRole('button', { name: 'Open AAPL stock card' }).click();
  await expect(page.locator('.tv-symbol')).toHaveText('$AAPL');
  await page.evaluate(() => window.updateStorage({ quoteSnapshots: { AAPL: { name: 'Apple Inc.', price: 114, currency: 'USD' } } }));
  await expect(page.locator('#watchlist')).toContainText('USD 114');
  await page.keyboard.press('Escape'); await expect(page.locator('#tickerview-modal')).toBeHidden();
  await expect(page.locator('#watchlist').getByRole('button', { name: 'Open AAPL stock card' })).toBeFocused();
  await page.locator('#clear-recent').click(); await expect(page.locator('#recent .symbol')).toHaveCount(0);
  await expect(page.locator('#clear-recent')).toBeDisabled();
  await expect(page.locator('#watchlist .watch-row')).toHaveCount(2);
});
