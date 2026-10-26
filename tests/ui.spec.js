import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createBackup, prepareImport } from '../backup.js';
test.beforeEach(async ({ page }) => {
  await page.exposeFunction('backupOperation', (request, values) => {
    try {
      if (request.action === 'exportBackup') return { success: true, backup: createBackup(values) };
      const result = prepareImport(values, JSON.parse(request.json), request.mode);
      return { success: true, summary: result.summary, ...(request.action === 'importBackup' ? { patch: result.patch } : {}) };
    } catch (error) { return { success: false, error: error.message }; }
  });
});
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
    const values = { dashboardPreferences: { autoRefresh: false }, settings: { hoverDelay: 0 }, watchlist: [], recent: [], ...initial }, listeners = [];
    window.testCalls = [];
    window.testCurrentWindow = { id: 123, width: 480, height: 800, left: 0, top: 0, state: 'normal', ...(initial.testWindow || {}) };
    window.updateStorage = async patch => {
      const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: values[key], newValue: value }]));
      Object.assign(values, patch); listeners.forEach(fn => fn(changes, 'local'));
    };
    window.chrome = {
      storage: { local: { get: async () => structuredClone(values) }, onChanged: { addListener: fn => listeners.push(fn) } },
      tabs: { query: async () => [{ url: 'https://x.com/tickerview-test' }] },
      windows: { create: async options => { window.createdWindow = options; return { id: 123 }; }, getCurrent: async () => ({ ...window.testCurrentWindow }), update: async (id, options) => { window.resizedWindow = { id, ...options }; Object.assign(window.testCurrentWindow, options); return { ...window.testCurrentWindow }; } },
      runtime: {
        getURL: path => `https://x.com/tickerview-assets/${path}`,
        getManifest: () => ({ content_scripts: [{ matches: ['https://*.x.com/*', 'https://*.finance.yahoo.com/*'] }] }),
        sendMessage: async request => {
          window.testCalls.push(request);
          if (['exportBackup', 'previewImport', 'importBackup'].includes(request.action)) {
            const result = await window.backupOperation(request, values);
            if (result.patch) await window.updateStorage(result.patch);
            return result;
          }
          if (['saveValuation', 'resetValuation'].includes(request.action)) {
            const valuationScenarios = { ...values.valuationScenarios };
            if (request.action === 'resetValuation') delete valuationScenarios[request.ticker];
            else valuationScenarios[request.ticker] = TickerView.valuationAssumptions(request.assumptions);
            await window.updateStorage({ valuationScenarios }); return { success: true, valuationScenarios };
          }
          if (request.action === 'setCardSection') { await window.updateStorage({ cardSections: { ...values.cardSections, [request.section]: request.open } }); return { success: true }; }
          if (request.action === 'getNote') return { success: true, note: values.tickerNotes?.[request.ticker] || { text: '', revision: null } };
          if (request.action === 'saveNote') {
            const tickerNotes = { ...values.tickerNotes }, current = tickerNotes[request.ticker] || { text: '', revision: null };
            if (current.revision !== request.revision) return { success: true, conflict: true, note: current };
            const note = { text: request.text, revision: crypto.randomUUID() };
            if (request.text) tickerNotes[request.ticker] = note; else delete tickerNotes[request.ticker];
            await window.updateStorage({ tickerNotes }); return { success: true, note: request.text ? note : { text: '', revision: null } };
          }
          if (request.action === 'setDashboardPreferences') { const dashboardPreferences = TickerView.dashboardPreferences({ ...values.dashboardPreferences, ...request.patch }); await window.updateStorage({ dashboardPreferences }); return { success: true, dashboardPreferences }; }
          if (request.action === 'saveWindowBounds') {
            const patch = { windowBounds: request.bounds };
            if (request.manual) patch.dashboardPreferences = TickerView.dashboardPreferences({ ...values.dashboardPreferences, windowMode: 'remember' });
            await window.updateStorage(patch); return { success: true };
          }
          if (request.action === 'overview') {
            const marketOverview = values.marketOverview || Object.fromEntries(TickerView.overviewSymbols.map((symbol, i) => [symbol, { name: symbol, price: 100 + i * 10, change: i - 1, changePercent: i - 1, currency: 'USD', ...values.quoteSnapshots?.[symbol], fetchedAt: Date.now(), quoteTime: Date.now()/1000 }]));
            await window.updateStorage({ marketOverview }); return { success: true, marketOverview, outcomes: {} };
          }
          if (request.action === 'setWatchSort') { await window.updateStorage({ watchSort: request.sort }); return { success: true }; }
          if (['refreshWatchlist', 'refreshDashboard'].includes(request.action)) {
            if (window.blockRefresh) await new Promise(resolve => { window.releaseRefresh = resolve; });
            const quoteSnapshots = { ...values.quoteSnapshots }, marketOverview = { ...values.marketOverview }, outcomes = {};
            const symbols = request.symbols || (request.action === 'refreshDashboard' ? [...new Set([...TickerView.overviewSymbols, ...values.watchlist])] : values.watchlist);
            for (const symbol of symbols) {
              outcomes[symbol] = symbol === 'FAIL' && !window.recoverQuotes ? { error: 'offline' } : { stale: false };
              const quote = { name: symbol + ' Inc.', price: 200, currency: 'USD', change: 10, changePercent: 5, fetchedAt: Date.now(), sessionDate: '2026-10-23', quickIndicators: { rsi: 55, ytdVwap: 180, sessionDate: '2026-10-23', fetchedAt: Date.now() } };
              if ((symbol !== 'FAIL' || window.recoverQuotes) && values.watchlist.includes(symbol)) quoteSnapshots[symbol] = quote;
              if ((symbol !== 'FAIL' || window.recoverQuotes) && TickerView.overviewSymbols.includes(symbol)) marketOverview[symbol] = quote;
              await window.updateStorage({ quoteSnapshots: { ...quoteSnapshots }, marketOverview: { ...marketOverview }, watchRefresh: { completed: Object.keys(outcomes).length, total: symbols.length, outcomes: { ...outcomes } } });
            }
            return { success: true, outcomes, marketOverview };
          }
          if (['saveAlias', 'deleteAlias', 'resetAliases'].includes(request.action)) {
            const customAliases = request.action === 'resetAliases' ? {} : { ...values.customAliases };
            if (request.action === 'saveAlias') {
              if (request.target === 'NOPE') return { success: false, error: 'Could not verify this symbol' };
              customAliases[TickerView.aliasKey(request.alias)] = TickerView.normalizeSymbol(request.target);
            }
            if (request.action === 'deleteAlias') delete customAliases[request.alias];
            await window.updateStorage({ customAliases }); return { success: true, customAliases };
          }
          if (request.action === 'recent') return { success: true };
          if (request.action === 'library') {
            values.watchlist = TickerView.cleanSymbols(values.watchlist); values.recent = TickerView.cleanSymbols(values.recent, 12);
            return { success: true, watchlist: values.watchlist, recent: values.recent, snapshots: values.quoteSnapshots || {} };
          }
          if (request.action === 'clearRecent') { await window.updateStorage({ recent: [] }); return { success: true }; }
          if (request.action === 'addWatch') {
            const symbol = TickerView.resolveSymbol(request.ticker);
            if (symbol === 'NOPE') return { success: false, error: 'Could not verify this symbol' };
            await window.updateStorage({ watchlist: [...new Set([symbol, ...values.watchlist])] });
            return { success: true };
          }
          if (request.action === 'settings') {
            await window.updateStorage({ settings: { ...values.settings, ...request.patch, ...(request.site ? { disabledSites: request.siteEnabled ? [] : [request.site] } : {}) } });
            return { success: true };
          }
          if (request.action === 'moveWatch') {
            if (window.failMove) return { success: false, error: 'Could not save order' };
            const watchlist = [...values.watchlist];
            if (!watchlist.includes(request.ticker) || !watchlist.includes(request.target)) return { success: false, error: 'Watchlist changed' };
            if (request.ticker !== request.target) { watchlist.splice(watchlist.indexOf(request.ticker), 1); watchlist.splice(watchlist.indexOf(request.target) + (request.position === 'after' ? 1 : 0), 0, request.ticker); }
            await window.updateStorage({ watchlist, watchSort: 'saved' }); return { success: true, watchlist };
          }
          if (request.action === 'watch') {
            const symbol = request.ticker.replace(/^([A-Z]+)\.([AB])$/, '$1-$2');
            const saved = values.watchlist.includes(symbol); const wanted = typeof request.saved === 'boolean' ? request.saved : !saved;
            if (wanted && !saved && values.watchlist.length >= 100) return { success: false, error: 'Watchlist limit is 100 symbols' };
            const watchlist = wanted ? saved ? [...values.watchlist] : [...values.watchlist] : values.watchlist.filter(x => x !== symbol);
            if (wanted && !saved) watchlist.splice(request.index ?? 0, 0, symbol);
            await window.updateStorage({ watchlist }); return { success: true, watchlist };
          }
          const ticker = request.ticker, delay = ticker === 'AAPL' ? 180 : 20;
          await new Promise(r => setTimeout(r, request.action === 'details' ? 350 : delay));
          const points = Array.from({ length: 15 }, (_, i) => ({ time: 1792762200 + i * 300, close: 100 + i, volume: i * 100 }));
          const status = { fetchedAt: Date.now(), stale: false };
          if (request.action === 'chart') return { success: true, chart: { points: points.map(p => ({ ...p, close: p.close + 20 })), interval: '1d', timezone: 'America/New_York' }, status };
          if (request.action === 'base') return { success: true, quote: { symbol: ticker, longName: ticker, currency: 'USD', exchange: 'NASDAQ', quoteTime: Date.now() / 1000, sessionDate: '2026-10-23', marketState: 'regular', regularMarketPrice: 114, regularMarketChange: 4, regularMarketChangePercent: 4 }, chart: { points, interval: '5m', timezone: 'America/New_York' }, status };
          if (request.action === 'technicals') return { success: true, quote: { rsi: 55, gapPct: 1, regularMarketChangePercent: 4 }, sessionDate: '2026-10-23', status };
          return { success: true, quote: { instrumentType: ticker.startsWith('^') ? 'INDEX' : ticker.endsWith('-USD') ? 'CRYPTOCURRENCY' : ticker === 'FUND' ? 'ETF' : 'EQUITY', longName: `${ticker} Company`, sector: 'Technology', marketCap: 1.6e12, fundamentals: { trailingPE: 20, trailingEps: ticker === 'LOSS' ? -2 : 4, revenue: 4e12, currency: 'JPY', quoteCurrency: 'USD', revenueGrowth: 0, profitMargin: -.02, totalDebt: 0 }, shortFloatPct: 1.53, shortRatio: 1.72, targetMean: 846, categorySentiment: { total: { label: 'Bullish', count: 1, score: 1 }, ...Object.fromEntries(['corporate','macro','regulation','retail'].map(cat => [cat, { label: 'Neutral', count: 0 }])), items: [{ title: 'Company surge', time: Date.now() / 1000, url: 'javascript:alert(1)', decay: 1, score: 2, matched: ['surge'] }] } }, benchmarks: { spy: { change: 2, date: '2026-10-23' }, sector: { change: 1, date: '2026-10-22' } }, sources: { profile: { ...status, provider: 'Yahoo Finance' } }, issues: [] };
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
  await expect(page.locator('[data-fundamental="trailingEps"]')).toContainText('USD 4');
  await expect(page.locator('[data-fundamental="revenueGrowth"]')).toContainText('0%');
  await expect(page.locator('[data-fundamental="profitMargin"]')).toContainText('-2%');
  await expect(page.locator('[data-fundamental="freeCashFlow"]')).toHaveCount(0);
  await expect(page.locator('[data-target="mean"]')).toContainText('USD 846');
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
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Cards', exact: true }).click();
  await page.locator('#compact').check();
  await expect(page.locator('#status')).toContainText('Settings saved');
  await page.locator('#siteEnabled').uncheck();
  await expect(page.locator('#siteEnabled')).not.toBeChecked();
  await page.locator('#close-settings').click();
  await page.locator('#toggle-add').click();
  await page.locator('#symbol').fill('BRK.B'); await page.locator('#add-symbol button').click();
  await expect(page.locator('#watchlist')).toContainText('BRK-B');
  await page.locator('#toggle-add').click();
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

test('TweetDeck hover switches from QQQ to META when the host intercepts mouse events', async ({ page }) => {
  await mockChrome(page, { url: 'https://x.com/i/tweetdeck' });
  await page.evaluate(() => {
    const column = document.createElement('section');
    column.innerHTML = '<a id="qqq" href="#"><span>$</span><span>QQQ</span></a> <a id="meta" href="#"><span>$</span><span>META</span></a>';
    for (const type of ['mouseover', 'mouseout']) column.addEventListener(type, event => event.stopPropagation());
    document.body.append(column);
  });
  await expect(page.locator('#meta')).toHaveAttribute('data-ticker', 'META');
  await page.locator('#qqq span').last().dispatchEvent('mouseover');
  await expect(page.locator('.tv-symbol')).toHaveText('$QQQ');
  await page.locator('#meta span').last().dispatchEvent('mouseover');
  await expect(page.locator('.tv-symbol')).toHaveText('$META');
  await expect.poll(() => page.evaluate(() => window.testCalls.filter(call => call.action === 'base').at(-1)?.ticker)).toBe('META');
});

test('extension reload cannot leave the previous ticker or an empty card visible', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockChrome(page);
  await expect(page.locator('.tickerview-highlight')).toHaveCount(2);
  await page.locator('#one .tickerview-highlight').dispatchEvent('mouseover');
  await expect(page.locator('.tv-price')).toHaveText('USD 114');
  await page.evaluate(() => {
    chrome.runtime.getURL = () => { throw new Error('Extension context invalidated.'); };
    chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.'); };
    document.querySelector('#two .tickerview-highlight').textContent = '$SOXX';
  });
  await page.locator('#two .tickerview-highlight').dispatchEvent('mouseover');
  await expect(page.locator('.tv-symbol')).toHaveText('$SOXX');
  await expect(page.locator('.tv-messages')).toContainText('Extension updated. Refresh this page.');
  await expect(page.locator('.tv-price')).toHaveText('N/A');
  await page.locator('[data-action="close"]').click();
  await expect(page.locator('#tickerview-modal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('card renders on host pages enforcing Trusted Types', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockChrome(page);
  await expect(page.locator('.tickerview-highlight')).toHaveCount(2);
  await page.evaluate(() => {
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = "require-trusted-types-for 'script'";
    document.head.append(meta);
  });
  await page.locator('#one .tickerview-highlight').hover();
  await expect(page.locator('.tv-symbol')).toHaveText('$AAPL');
  await expect(page.locator('.tv-fullname')).toHaveText('AAPL Company');
  await expect(page.locator('.tv-chart svg')).toBeVisible();
  await expect(page.locator('.tv-news-body')).toContainText('Company surge');
  const bounds = await page.locator('#tickerview-modal').boundingBox();
  expect(bounds.height).toBeGreaterThan(200);
  expect(errors).toEqual([]);
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
  await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Cards', exact: true }).click();
  await page.locator('#enabled').uncheck(); await expect(page.locator('#siteEnabled')).toBeDisabled();
  await page.locator('#enabled').check(); await expect(page.locator('#siteEnabled')).toBeEnabled();
  await page.locator('[data-preset="Essential"]').click();
  await expect(page.locator('#indicator-count')).toHaveText('9 selected');
  await expect(page.locator('#indicators legend')).toHaveText(['Technicals', 'Fundamentals']);
  await page.locator('[data-preset="Technical"]').click(); await expect(page.locator('#indicator-count')).toHaveText('18 selected');
  await page.locator('[data-preset="All"]').click(); await expect(page.locator('#indicator-count')).toHaveText('21 selected');
  await page.locator('#indicator-options summary').click();
  await page.locator('#close-settings').click();
  await page.locator('#toggle-add').click();
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

test('value estimates preserve drafts and focus through refresh, save by stock, sync and reset', async ({ page }) => {
  await mockChrome(page);
  await page.locator('#one .tickerview-highlight').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-scenario="base"]')).toContainText('USD 80');
  await expect(page.locator('.tv-valuation-output')).toContainText('Illustrative examples');
  await page.locator('.tv-assumptions > summary').click();
  const base = page.getByRole('spinbutton', { name: 'Base P/E', exact: true });
  await base.fill('30');
  await page.locator('[data-action="refresh"]').click();
  await base.focus();
  await expect(page.locator('.tv-messages')).not.toContainText('Loading');
  await expect(base).toHaveValue('30'); await expect(base).toBeFocused();
  await page.locator('.tv-valuation-form button[type="submit"]').click();
  await expect(page.locator('.tv-valuation-feedback')).toContainText('bear ≤ base ≤ bull');
  await page.getByRole('spinbutton', { name: 'Bull P/E', exact: true }).fill('40');
  await page.locator('.tv-valuation-form button[type="submit"]').click();
  await expect(page.locator('[data-scenario="base"]')).toContainText('USD 120');
  await expect(page.locator('.tv-valuation-output')).toContainText('Your saved assumptions');
  await page.evaluate(() => window.updateStorage({ valuationScenarios: { AAPL: { bear: 10, base: 25, bull: 40 } } }));
  await expect(base).toHaveValue('25');
  await base.fill('27');
  await page.evaluate(() => window.updateStorage({ valuationScenarios: { AAPL: { bear: 10, base: 26, bull: 40 } } }));
  await expect(base).toHaveValue('27');
  await expect(page.locator('[data-scenario="base"]')).toContainText('USD 104');
  await page.locator('[data-action="valuation-reset"]').click();
  await expect(base).toHaveValue('20');
  await expect(page.locator('[data-scenario="base"]')).toContainText('USD 80');
  await page.keyboard.press('Escape');
  await page.locator('#two .tickerview-highlight').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-scenario="base"]')).toContainText('USD 80');
  await page.evaluate(() => window.updateStorage({ valuationScenarios: { MSFT: { bear: 10, base: 35, bull: 50 } } }));
  await expect(page.locator('[data-scenario="base"]')).toContainText('USD 140');
  await page.setViewportSize({ width: 360, height: 740 });
  expect(await page.locator('.tv-valuation').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});
test('negative earnings and ETFs explain unavailable models while retaining analyst targets', async ({ page }) => {
  await mockChrome(page);
  await page.evaluate(() => { document.querySelector('#one').textContent = '$LOSS'; document.querySelector('#two').textContent = '$FUND'; });
  for (const [id, text] of [['one', 'positive trailing'], ['two', 'only for stocks']]) {
    await page.locator(`#${id} .tickerview-highlight`).focus(); await page.keyboard.press('Enter');
    await expect(page.locator('.tv-valuation-output')).toContainText(text);
    await expect(page.locator('[data-scenario]')).toHaveCount(0);
    await expect(page.locator('[data-target="mean"]')).toContainText('USD 846');
    await page.keyboard.press('Escape');
  }
});

test('popup valuation inputs participate in keyboard navigation and retain models without targets', async ({ page }) => {
  await mockChrome(page, { popup: true, initial: { recent: ['AAPL'] } });
  await page.evaluate(() => {
    const send = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = async request => {
      const result = await send(request);
      if (request.action === 'details') {
        result.quote.targetMean = null;
        result.sources.profile.stale = true;
      }
      return result;
    };
  });
  await page.getByRole('button', { name: 'Open AAPL stock card' }).click();
  await expect(page.locator('[data-scenario="base"]')).toContainText('USD 80');
  await expect(page.locator('.tv-valuation-output')).toContainText('STALE cache');
  await expect(page.locator('.tv-analyst-comparison')).toContainText('unavailable');
  await page.locator('.tv-assumptions > summary').click();
  await page.getByRole('spinbutton', { name: 'Bear P/E', exact: true }).focus();
  await page.keyboard.press('Tab'); await expect(page.getByRole('spinbutton', { name: 'Base P/E', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('spinbutton', { name: 'Bull P/E', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.locator('.tv-valuation-form button[type="submit"]')).toBeFocused();
  await page.locator('.tv-research-dock a').last().focus(); await page.keyboard.press('Tab');
  await expect(page.locator('[data-action="pin"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open AAPL stock card' })).toBeFocused();
});

test('analyst comparison retains recommendation and original colored target range', async ({ page }) => {
  await mockChrome(page);
  await page.evaluate(() => {
    const send = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = async request => {
      const result = await send(request);
      if (request.action === 'details') Object.assign(result.quote, { targetLow: 90, targetMean: 110, targetHigh: 140, recKey: 'strong_buy', analystCount: 12 });
      return result;
    };
  });
  await page.locator('#one .tickerview-highlight').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.tv-analyst-comparison')).toContainText('12 analysts · Strong buy');
  const track = page.locator('.tv-target-track');
  await expect(track).toHaveAttribute('aria-label', /Low: USD 90.*Mean: USD 110.*High: USD 140.*Price: USD 114/);
  await expect(track.locator('span')).toHaveCount(4);
  expect(await track.evaluate(node => getComputedStyle(node).backgroundImage)).toContain('linear-gradient');
  await expect(page.locator('[data-scenario="base"]')).toContainText('USD 80');
});

test('Expand opens a resizable window fitted to content and retains site controls', async ({ page }) => {
  await mockChrome(page, { popup: true });
  await page.evaluate(() => {
    window.close = () => { window.popupClosed = true; };
    for (const [key, value] of Object.entries({ availHeight: 1200, availWidth: 1800, availTop: 0, availLeft: 0 })) Object.defineProperty(screen, key, { value, configurable: true });
  });
  await page.getByRole('button', { name: 'Expand TickerView into a resizable window' }).click();
  const options = await page.evaluate(() => window.createdWindow);
  expect(options).toMatchObject({ type: 'popup', width: 480, height: 600, top: 20, left: 1300 });
  expect(new URL(options.url).searchParams.get('site')).toBe('x.com');
  expect(new URL(options.url).searchParams.get('expanded')).toBe('1');
  expect(await page.evaluate(() => window.popupClosed)).toBe(true);
  await page.setViewportSize({ width: 480, height: 1000 });
  await mockChrome(page, { popup: true, url: 'https://x.com/popup.html?expanded=1&site=finance.yahoo.com', initial: { watchlist: ['ASTS', 'NBIS', 'SPY', 'META', 'NVDA'], recent: ['TSLA', 'AXP', 'BTC', 'FFIV', 'MSFT', 'AAPL'] } });
  await expect(page.locator('body')).toHaveClass(/tv-expanded/);
  expect(await page.evaluate(() => window.resizedWindow.height)).toBeLessThan(await page.evaluate(() => Math.max(300, Math.floor(screen.availHeight - 40))));
  await expect(page.locator('#expand-popup')).toBeHidden();
  await expect(page.locator('#site')).toHaveText('finance.yahoo.com');
  await expect(page.locator('#siteEnabled')).toBeEnabled();
  await expect(page.locator('#watchlist .watch-row')).toHaveCount(5);
  await expect(page.locator('footer')).toBeInViewport();
  const metrics = await page.evaluate(() => ({ body: document.body.scrollWidth <= innerWidth, list: document.querySelector('#watchlist').scrollHeight <= document.querySelector('#watchlist').clientHeight }));
  expect(metrics).toEqual({ body: true, list: true });
  await page.screenshot({ path: 'test-results/popup-expanded.png' });
});

test('search resolves aliases, opens without saving, and shares notes with canonical watchlist entries', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mockChrome(page, { popup: true, initial: { watchlist: ['BTC-USD'] } });
  await page.locator('#search-symbol').fill('$btc'); await page.locator('#search-symbol').press('Enter');
  await expect(page.locator('.tv-symbol')).toHaveText('$BTC-USD');
  await expect(page.locator('.tv-summary')).toContainText('Resolved from $btc');
  await expect(page.locator('.tv-research-dock')).toContainText('Yahoo Finance');
  await expect(page.locator('.tv-research-dock')).not.toContainText('Finviz');
  await expect(page.locator('.tv-fundamentals-body')).toContainText('do not apply');
  await page.locator('.tv-note summary').click();
  const note = page.locator('#tv-note-text'); await expect(note).toBeEnabled();
  await note.fill('<img src=x onerror=alert(1)> My thesis'); await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.locator('.tv-note-status')).toHaveText('Saved locally');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open BTC-USD stock card' }).click();
  await page.locator('.tv-note summary').click(); await expect(note).toHaveValue('<img src=x onerror=alert(1)> My thesis');
  await expect(page.locator('.tv-note img')).toHaveCount(0);
  expect(await page.evaluate(() => window.testCalls.filter(call => call.action === 'addWatch'))).toHaveLength(0);
  await page.keyboard.press('Escape'); await expect(page.locator('#watchlist .watch-row')).toHaveCount(1);
  await page.locator('#search-symbol').fill('$5B'); await page.locator('#search-symbol').press('Enter');
  await expect(page.locator('#search-feedback')).toContainText('currency amount'); expect(errors).toEqual([]);
});
test('notes preserve drafts across refresh and ranges and offer cancel, discard, save, and conflict resolution', async ({ page }) => {
  await mockChrome(page, { popup: true });
  await page.locator('#search-symbol').fill('AAPL'); await page.locator('#search-symbol').press('Enter');
  await page.locator('.tv-note summary').click();
  const note = page.locator('#tv-note-text'); await expect(note).toBeEnabled(); await note.fill('draft');
  await page.locator('[data-action="refresh"]').click(); await page.locator('[data-range="1M"]').click(); await expect(note).toHaveValue('draft');
  await page.keyboard.press('Escape'); await expect(page.locator('.tv-note-prompt')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(note).toHaveValue('draft');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Save and continue' }).click(); await expect(page.locator('#tickerview-modal')).toBeHidden();
  await page.locator('#search-symbol').press('Enter'); await expect(page.locator('.tv-note')).toHaveAttribute('open', ''); await expect(note).toHaveValue('draft');
  await note.fill('new draft');
  await page.evaluate(() => window.updateStorage({ tickerNotes: { AAPL: { text: 'remote', revision: 'remote-1' } } }));
  await expect(note).toHaveValue('new draft'); await expect(page.locator('.tv-note-conflict')).toBeVisible();
  await page.getByRole('button', { name: 'Overwrite saved note' }).click(); await expect(page.locator('.tv-note-status')).toHaveText('Saved locally');
  await note.fill('another draft');
  await page.evaluate(() => window.updateStorage({ tickerNotes: { AAPL: { text: 'remote again', revision: 'remote-2' } } }));
  await page.getByRole('button', { name: 'Reload saved note' }).click(); await expect(note).toHaveValue('remote again');
  await note.fill('discard me'); await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator('#tickerview-modal')).toBeHidden();
});
test('watchlist refresh keeps failed rows and sorts missing data last without fetching on open', async ({ page }) => {
  await mockChrome(page, { popup: true, initial: { watchlist: ['FAIL', 'B', 'A'], quoteSnapshots: { FAIL: { price: 99, changePercent: -2, name: 'Failure Inc.' }, A: { price: 100, changePercent: 0, name: 'Alpha' } } } });
  expect(await page.evaluate(() => window.testCalls.filter(call => ['base', 'refreshWatchlist'].includes(call.action)))).toHaveLength(0);
  await page.getByRole('button', { name: 'Sort by daily percentage change' }).click();
  await expect(page.locator('.watch-identity strong')).toHaveText(['A', 'FAIL', 'B']);
  await page.locator('#refresh-watchlist').click();
  await expect(page.locator('#refresh-feedback')).toContainText('1 unavailable');
  await expect(page.locator('.watch-identity strong')).toHaveText(['A', 'B', 'FAIL']);
  await expect(page.locator('.watch-row').filter({ hasText: 'Failure Inc.' })).toContainText('99');
  await expect(page.locator('.watch-warning')).toContainText('offline');
  await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Market', exact: true }).click();
  await page.locator('#watch-sort').selectOption('saved'); await page.locator('#close-settings').click(); await expect(page.locator('.watch-identity strong')).toHaveText(['FAIL', 'B', 'A']);
});
test('custom aliases update existing cashtags and settings overrides reset to built-ins', async ({ page }) => {
  await mockChrome(page);
  await page.locator('#one').evaluate(node => { node.textContent = 'Watching $BTC and $VIX'; });
  const btc = page.locator('.tickerview-highlight').filter({ hasText: '$BTC' });
  await btc.focus(); await page.keyboard.press('Enter'); await expect(page.locator('.tv-symbol')).toHaveText('$BTC-USD');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.updateStorage({ customAliases: { BTC: 'ETH-USD' } }));
  await btc.focus(); await page.keyboard.press('Enter'); await expect(page.locator('.tv-symbol')).toHaveText('$ETH-USD');
  await expect(btc).toHaveText('$BTC');
  await page.keyboard.press('Escape');
  await page.locator('#two').evaluate(node => { node.innerHTML = '<a href="https://x.com/search?q=BTC"><span>$</span><span>BTC</span></a>'; });
  const native = page.locator('#two a'); await expect(native).toHaveClass(/tickerview-highlight/);
  await native.focus(); await page.keyboard.press('Enter'); await expect(page.locator('.tv-symbol')).toHaveText('$ETH-USD');
  await expect(native).toHaveAttribute('href', 'https://x.com/search?q=BTC'); await expect(native.locator('span')).toHaveCount(2);

  await mockChrome(page, { popup: true }); await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Aliases', exact: true }).click();
  await page.getByRole('button', { name: 'Edit alias BTC', exact: true }).click();
  await page.locator('#alias-target').fill('ETH-USD'); await page.getByRole('button', { name: 'Save alias', exact: true }).click();
  await expect(page.locator('#alias-list')).toContainText('BTC → ETH-USD (custom)');
  await page.getByRole('button', { name: 'Delete alias BTC', exact: true }).click();
  await expect(page.locator('#alias-list')).toContainText('BTC → BTC-USD');
  await page.locator('#alias-key').fill('COIN'); await page.locator('#alias-target').fill('BTC-USD'); await page.getByRole('button', { name: 'Save alias', exact: true }).click();
  await expect(page.locator('#alias-list')).toContainText('COIN → BTC-USD (custom)');
  await page.getByRole('button', { name: 'Reset custom mappings' }).click(); await expect(page.locator('#alias-list')).not.toContainText('COIN');
});

test('backup downloads JSON, previews without changing data, merges and replaces saved configuration', async ({ page }, testInfo) => {
  await mockChrome(page, { popup: true, initial: { watchlist: ['AAPL'], customAliases: { LOCAL: '^VIX' }, tickerNotes: { AAPL: { text: 'Local note', revision: 'local' } } } });
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Backup', exact: true }).click();
  const downloadEvent = page.waitForEvent('download'); await page.locator('#export-backup').click();
  const download = await downloadEvent; expect(download.suggestedFilename()).toMatch(/^tickerview-backup-.*\.json$/);
  const path = testInfo.outputPath('backup.json'); await download.saveAs(path);
  const exported = JSON.parse(await readFile(path, 'utf8'));
  expect(exported.data.watchlist).toEqual(['AAPL']); expect(exported.data.tickerNotes.AAPL).toEqual('Local note'); expect(exported.data.resourceCache).toBeUndefined();
  const imported = createBackup({ watchlist: ['BTC-USD'], customAliases: { COIN: 'BTC-USD' }, settings: { compact: true }, tickerNotes: { 'BTC-USD': { text: 'Imported thesis', revision: 'old' } } });
  const upload = { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) };
  await page.locator('#import-file').setInputFiles(upload);
  await expect(page.locator('#import-summary')).toContainText('Watchlist symbols: 1 in file → 2 after import');
  await expect(page.locator('#watchlist .watch-row')).toHaveCount(1);
  await page.locator('#cancel-import').click(); await expect(page.locator('#import-preview')).toBeHidden();
  await expect(page.locator('#watchlist .watch-row')).toHaveCount(1);
  await page.locator('#import-file').setInputFiles(upload); await expect(page.locator('#import-preview')).toBeVisible();
  await page.locator('#apply-import').click(); await expect(page.locator('#backup-feedback')).toContainText('Backup imported');
  await expect(page.locator('.watch-identity strong')).toHaveText(['AAPL', 'BTC-USD']); await expect(page.locator('#compact')).toBeChecked();
  await page.getByRole('tab', { name: 'Aliases', exact: true }).click(); await expect(page.locator('#alias-list')).toContainText('COIN → BTC-USD');
  await page.getByRole('tab', { name: 'Backup', exact: true }).click();
  await page.locator('#import-file').setInputFiles(upload); await page.locator('#import-mode').selectOption('replace');
  await expect(page.locator('#import-summary')).toContainText('Watchlist symbols: 1 in file → 1 after import');
  await expect(page.locator('#import-explanation')).toContainText('Replace all'); await page.locator('#apply-import').click();
  await expect(page.locator('.watch-identity strong')).toHaveText(['BTC-USD']);
  await page.getByRole('tab', { name: 'Aliases', exact: true }).click(); await expect(page.locator('#alias-list')).not.toContainText('LOCAL');
  await page.locator('#close-settings').click();
  await page.locator('#watchlist [data-open-ticker="BTC-USD"]').click(); await page.locator('.tv-note summary').click();
  await expect(page.locator('#tv-note-text')).toHaveValue('Imported thesis');
});
test('invalid and oversized backup files never expose an import button or alter saved entries', async ({ page }) => {
  await mockChrome(page, { popup: true, initial: { watchlist: ['AAPL'] } });
  await page.locator('#open-settings').click();
  await page.getByRole('tab', { name: 'Backup', exact: true }).click();
  await page.locator('#import-file').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(page.locator('#backup-feedback')).not.toHaveText('Checking backup…'); await expect(page.locator('#import-preview')).toBeHidden();
  const unsupported = createBackup({}); unsupported.version = 99;
  await page.locator('#import-file').setInputFiles({ name: 'future.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(unsupported)) });
  await expect(page.locator('#backup-feedback')).toContainText('unsupported'); await expect(page.locator('#import-preview')).toBeHidden();
  await page.locator('#import-file').setInputFiles({ name: 'huge.json', mimeType: 'application/json', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
  await expect(page.locator('#backup-feedback')).toContainText('2 MB'); await expect(page.locator('#watchlist .watch-row')).toHaveCount(1);
});

test('market-first watchlist table and gear settings work at normal and narrow widths', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 850 });
  await mockChrome(page, { popup: true, url: 'https://x.com/popup.html?expanded=1', initial: {
    watchlist: ['BTC-USD', 'ASTS', 'NBIS', 'SPY'], recent: ['ETH-USD', 'AAPL'],
    quoteSnapshots: { 'BTC-USD': { name: 'Bitcoin USD', price: 81296.35, currency: 'USD', change: -16.26, fetchedAt: Date.now(), changePercent: -.02 }, ASTS: { name: 'AST SpaceMobile, Inc.', price: 39.79, currency: 'USD', change: 1.02, fetchedAt: Date.now(), changePercent: 2.63 }, NBIS: { name: 'Nebius Group N.V.', price: 158.74, currency: 'USD', change: -.43, fetchedAt: Date.now(), changePercent: -.27 }, SPY: { name: 'State Street SPDR S&P 500 ETF Trust', price: 759.97, currency: 'USD', change: -3.97, fetchedAt: Date.now(), changePercent: -.52 } }
  } });
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expect(page.getByRole('table', { name: 'Watchlist quotes' })).toBeVisible();
  await expect(page.getByRole('columnheader')).toHaveText(['Symbol / company ↕', 'Price ↕', 'Change ↕', 'RSI (14)', 'YTD VWAP*', 'Δ VWAP', '× Actions']);
  await expect(page.locator('.watch-row').first().locator('td')).toHaveCount(7);
  expect((await page.locator('#watchlist').boundingBox()).y).toBeLessThan(340);
  await page.screenshot({ path: 'test-results/market-table.png' });
  await page.locator('#open-settings').click(); await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Market', exact: true })).toBeFocused();
  await expect(page.getByRole('switch', { name: 'Auto-refresh', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Aliases', exact: true })).toBeVisible(); await expect(page.getByRole('tab', { name: 'Backup', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings-wheel.png' });
  await page.keyboard.press('Escape'); await expect(page.locator('#settings-dialog')).toBeHidden(); await expect(page.locator('#open-settings')).toBeFocused();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open ASTS stock card' }).click(); await expect(page.locator('.tv-symbol')).toHaveText('$ASTS');
  await page.keyboard.press('Escape'); await page.locator('#open-settings').click();
  expect(await page.locator('#settings-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  await page.getByRole('tab', { name: 'Cards', exact: true }).click(); await page.locator('#compact').check();
  await page.locator('#close-settings').click(); await expect(page.locator('#watchlist')).toBeVisible();
  await page.screenshot({ path: 'test-results/market-table-narrow.png' });
});

test('watchlist shows daily amount and percent, retaining zero and handling partial snapshots', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockChrome(page, { popup: true, initial: { watchlist: ['UP', 'DOWN', 'FLAT', 'PARTIAL'], quoteSnapshots: {
    UP: { price: 100, currency: 'USD', change: 2.5, changePercent: 2.56 },
    DOWN: { price: 90, currency: 'USD', change: -1.25, changePercent: -1.37 },
    FLAT: { price: 50, currency: 'USD', change: 0, changePercent: 0 },
    PARTIAL: { price: 80, currency: 'EUR', changePercent: 1.5 }
  } } });
  await expect(page.locator('.watch-change-amount')).toHaveText(['+2.50', '-1.25', '0.00', '—']);
  await expect(page.locator('.watch-change-percent')).toHaveText(['+2.56%', '-1.37%', '+0.00%', '+1.50%']);
  await expect(page.locator('.watch-change-amount').nth(1)).toHaveClass(/negative/);
  await expect(page.locator('.watch-change-amount').first()).toHaveAttribute('title', 'Daily price change (USD)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('overview strip opens canonical index and crypto cards without saving them', async ({ page }) => {
  await mockChrome(page, { popup: true });
  await expect(page.locator('.overview-quote')).toHaveCount(4);
  await expect(page.locator('.overview-quote strong')).toHaveText(['SPY', 'QQQ', 'VIX', 'BTC']);
  await expect(page.locator('.overview-price')).toHaveText(['100', '110', '120', '130']);
  await page.getByRole('button', { name: 'Open VIX market overview card' }).click(); await expect(page.locator('.tv-symbol')).toHaveText('$^VIX');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Open BTC market overview card' }).click(); await expect(page.locator('.tv-symbol')).toHaveText('$BTC-USD');
  await page.keyboard.press('Escape'); await expect(page.locator('#watch-count')).toHaveText('0');
  expect(await page.evaluate(() => window.testCalls.filter(call => call.action === 'overview').length)).toBe(1);
});
test('column headers toggle accessible sorting and preserve keyboard focus', async ({ page }) => {
  await mockChrome(page, { popup: true, initial: { watchlist: ['B', 'A', 'C', 'D'], quoteSnapshots: { A: { price: 30, changePercent: 1 }, B: { price: 10, changePercent: 3 }, C: { price: 20, changePercent: 2 } } } });
  const price = page.getByRole('button', { name: 'Sort by price', exact: true });
  await price.click(); await expect(page.locator('.watch-identity strong')).toHaveText(['A', 'C', 'B', 'D']);
  await expect(page.locator('th').filter({ has: price })).toHaveAttribute('aria-sort', 'descending'); await expect(price).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('.watch-identity strong')).toHaveText(['B', 'C', 'A', 'D']);
  await expect(page.locator('th').filter({ has: price })).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: 'Sort by symbol', exact: true }).click(); await expect(page.locator('.watch-identity strong')).toHaveText(['A', 'B', 'C', 'D']);
  await page.getByRole('button', { name: 'Sort by symbol', exact: true }).click(); await expect(page.locator('.watch-identity strong')).toHaveText(['D', 'C', 'B', 'A']);
  await page.getByRole('button', { name: 'Sort by daily percentage change' }).click(); await expect(page.locator('.watch-identity strong')).toHaveText(['B', 'C', 'A', 'D']);
  await expect(page.locator('.watch-heading select')).toHaveCount(0);
});
test('freshness uses retrieval time and auto refresh pauses while hidden and resumes without overlaps', async ({ page }) => {
  const now = Date.parse('2026-10-23T17:00:00Z'); await page.clock.install({ time: now });
  const marketOverview = Object.fromEntries(['SPY', 'QQQ', '^VIX', 'BTC-USD'].map(symbol => [symbol, { price: 100, changePercent: 1, fetchedAt: now - 30000, quoteTime: (now - 3600000)/1000 }]));
  await mockChrome(page, { popup: true, initial: { marketOverview } });
  await expect(page.locator('#dashboard-freshness')).toHaveText('Updated 30 seconds ago');
  await page.clock.runFor(10000); await expect(page.locator('#dashboard-freshness')).toHaveText('Updated 40 seconds ago');
  const calls = () => page.evaluate(() => window.testCalls.filter(call => call.action === 'refreshDashboard').length);
  expect(await calls()).toBe(0);
  await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Market', exact: true }).click(); await page.locator('#auto-refresh').check();
  await page.clock.runFor(1); await expect.poll(calls).toBe(1); await page.locator('#close-settings').click();
  await page.evaluate(() => { window.testHidden = true; Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.testHidden }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(120000); expect(await calls()).toBe(1); await expect(page.locator('#refresh-countdown')).toHaveText('Paused');
  await page.evaluate(() => { window.testHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(1); await expect.poll(calls).toBe(2);
  await page.clock.runFor(15000); await expect.poll(calls).toBe(3);
  await page.locator('#open-settings').click(); await page.locator('#auto-refresh').uncheck(); await page.clock.runFor(120000); expect(await calls()).toBe(3);
});
test('window restores saved bounds, supports fit/full height, and remembers manual resizing', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1000 }); await page.clock.install();
  await mockChrome(page, { popup: true, url: 'https://x.com/popup.html?expanded=1', initial: { dashboardPreferences: { autoRefresh: false, windowMode: 'remember' }, windowBounds: { width: 420, height: 640, left: 12, top: 22 } } });
  await expect.poll(() => page.evaluate(() => window.resizedWindow?.height)).toBe(640);
  expect(await page.evaluate(() => window.resizedWindow)).toMatchObject({ width: 420, height: 640, left: 12, top: 22 });
  await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Market', exact: true }).click(); await page.locator('#window-mode').selectOption('full'); await page.locator('#close-settings').click();
  const maximum = await page.evaluate(() => Math.max(300, screen.availHeight - 40)); await expect.poll(() => page.evaluate(() => window.resizedWindow?.height)).toBe(maximum);
  await page.locator('#fit-window').click(); await page.clock.runFor(200);
  await expect.poll(() => page.evaluate(() => window.resizedWindow?.height)).toBeLessThan(maximum);
  await page.clock.runFor(1000);
  await page.evaluate(() => { Object.assign(window.testCurrentWindow, { width: 460, height: 700 }); window.dispatchEvent(new Event('resize')); }); await page.clock.runFor(301);
  await expect.poll(() => page.evaluate(() => window.testCalls.filter(call => call.action === 'saveWindowBounds' && call.manual).length)).toBe(1);
  await page.locator('#open-settings').click(); await expect(page.locator('#window-mode')).toHaveValue('remember');
});

test('refresh icon supports manual updates and configurable automatic countdown defaults to 15 seconds', async ({ page }) => {
  await page.clock.install({ time: Date.parse('2026-10-23T17:00:00Z') });
  await mockChrome(page, { popup: true, initial: { dashboardPreferences: {} } });
  await page.clock.runFor(1);
  const calls = () => page.evaluate(() => window.testCalls.filter(call => call.action === 'refreshDashboard'));
  await expect.poll(async () => (await calls()).length).toBe(1);
  await expect(page.locator('#refresh-countdown')).toHaveText('Refresh in 15s'); expect((await calls())[0].force).toBe(false);
  await page.clock.runFor(5000); await expect(page.locator('#refresh-countdown')).toHaveText('Refresh in 10s');
  await page.locator('#open-settings').click(); await page.getByRole('tab', { name: 'Market', exact: true }).click();
  await expect(page.locator('#auto-refresh')).toBeChecked(); await expect(page.locator('#refresh-interval')).toHaveValue('15');
  await page.locator('#refresh-interval').selectOption('30'); await expect(page.locator('#refresh-countdown')).toHaveText('Refresh in 30s');
  await page.locator('#close-settings').click();
  await page.evaluate(() => { window.blockRefresh = true; });
  const refresh = page.getByRole('button', { name: 'Refresh market quotes', exact: true }); await refresh.click();
  await expect(refresh).toHaveAttribute('aria-busy', 'true'); await expect(refresh).toHaveClass(/is-refreshing/); await expect(page.locator('#refresh-countdown')).toHaveText('Refreshing…');
  expect((await calls()).at(-1).force).toBe(true);
  await page.evaluate(() => { window.blockRefresh = false; window.releaseRefresh(); });
  await expect(refresh).toBeEnabled(); await expect(page.locator('#refresh-countdown')).toHaveText('Refresh in 30s');
  await page.clock.runFor(30000); await expect.poll(async () => (await calls()).length).toBe(3);
  expect((await calls()).at(-1).force).toBe(false);
});

test('auto refresh is visible on first opening, has a direct enable shortcut, and settings tabs support keyboards', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.clock.install({ time: Date.parse('2026-10-23T17:00:00Z') });
  await mockChrome(page, { popup: true, initial: { dashboardPreferences: { autoRefresh: false, refreshInterval: 30 } } });
  await expect(page.locator('#refresh-countdown')).toHaveText('Auto off · Enable');
  await page.getByRole('button', { name: 'Configure automatic refresh', exact: true }).click();
  const toggle = page.getByRole('switch', { name: 'Auto-refresh', exact: true });
  await expect(toggle).toBeVisible(); await expect(toggle).toBeFocused(); await expect(toggle).not.toBeChecked();
  await expect(page.locator('#auto-refresh-status')).toHaveText('Off'); await expect(page.locator('#refresh-interval')).toBeDisabled();
  await page.keyboard.press('Space'); await page.clock.runFor(1);
  await expect(toggle).toBeChecked(); await expect(page.locator('#auto-refresh-status')).toHaveText('On');
  await expect(page.locator('#refresh-interval')).toBeEnabled(); await expect(page.locator('#auto-refresh-summary')).toContainText('30 seconds');
  await page.locator('#refresh-interval').selectOption('15'); await expect(page.locator('#auto-refresh-summary')).toContainText('15 seconds');
  await page.screenshot({ path: 'test-results/settings-refresh-narrow.png' });
  await page.getByRole('tab', { name: 'Market', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Cards', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#enabled')).toBeVisible(); await expect(page.locator('#auto-refresh')).toBeHidden();
  await page.keyboard.press('End'); await expect(page.getByRole('tab', { name: 'Backup', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#export-backup')).toBeVisible();
  await page.keyboard.press('Home'); await expect(toggle).toBeVisible();
  expect(await page.locator('#settings-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true);
  await toggle.uncheck(); await expect(page.locator('#auto-refresh-status')).toHaveText('Off');
  await page.locator('#close-settings').click();
  await page.locator('#open-settings').click(); await expect(toggle).toBeVisible(); await expect(toggle).not.toBeChecked();
  await expect(page.getByRole('tab', { name: 'Market', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('watchlist disclosure, local filter, undo, notes, and percentage hierarchy', async ({ page }) => {
  await mockChrome(page, { popup: true, initial: {
    watchlist: ['AAPL', 'MSFT', 'GOOG'],
    tickerNotes: { AAPL: { text: 'Research', revision: '1' } },
    quoteSnapshots: { AAPL: { name: 'Apple Inc.', price: 123, currency: 'USD', change: 2, changePercent: 1.65 } }
  } });
  await expect(page.locator('#add-symbol')).toBeHidden();
  await page.locator('#toggle-add').click();
  await expect(page.locator('#symbol')).toBeFocused();
  await page.locator('#symbol').press('Escape');
  await expect(page.locator('#add-symbol')).toBeHidden();
  await expect(page.locator('#toggle-add')).toBeFocused();
  await expect(page.locator('.note-marker')).toHaveCount(1);
  expect(await page.locator('.watch-change').first().evaluate(el => el.firstElementChild.className)).toContain('watch-change-percent');
  await page.locator('#watch-filter').fill('apple');
  await expect(page.locator('.watch-row')).toHaveCount(1);
  await expect(page.locator('#watch-count')).toHaveText('1/3');
  await page.locator('#refresh-watchlist').click();
  await expect(page.locator('#refresh-watchlist')).toBeEnabled();
  await expect(page.locator('#refresh-feedback')).toBeEmpty();
  await expect(page.locator('#watch-filter')).toHaveValue('apple');
  await page.locator('#watch-filter').fill('nothing');
  await expect(page.locator('#watchlist')).toHaveText('No matching symbols');
  await page.locator('#clear-filter').click();
  await page.getByRole('button', { name: 'Remove MSFT', exact: true }).click();
  await expect(page.locator('#undo-remove')).toBeFocused();
  await page.evaluate(() => window.updateStorage({ watchlist: ['AAPL', 'GOOG', 'NVDA'] }));
  await page.locator('#undo-remove').click();
  await expect(page.locator('.watch-identity strong')).toHaveText(['AAPL', 'MSFT', 'GOOG', 'NVDA']);
  await page.evaluate(() => window.updateStorage({ tickerNotes: {} }));
  await expect(page.locator('.note-marker')).toHaveCount(0);
  await page.evaluate(() => window.updateStorage({ tickerNotes: { GOOG: { text: 'New note', revision: '2' } } }));
  await expect(page.locator('.note-marker')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove GOOG', exact: true }).click();
  await page.evaluate(() => window.updateStorage({ watchlist: Array.from({ length: 100 }, (_, i) => `SYM${i}`) }));
  await page.locator('#undo-remove').click();
  await expect(page.locator('#watch-action')).toContainText('Watchlist limit');
  await page.locator('#dismiss-undo').click();
  await expect(page.locator('#watch-action')).toBeHidden();
});

test('card section preferences restore across symbols and preserve drafts during refresh', async ({ page }) => {
  await mockChrome(page, { popup: true, initial: { watchlist: ['AAPL', 'MSFT'], cardSections: { fundamentals: false, valuation: false, note: true } } });
  await page.getByRole('button', { name: 'Open AAPL stock card', exact: true }).click();
  await expect(page.locator('.tv-fundamentals')).not.toHaveAttribute('open', '');
  await expect(page.locator('.tv-valuation')).not.toHaveAttribute('open', '');
  await expect(page.locator('#tv-note-text')).toBeEnabled();
  await page.locator('#tv-note-text').fill('Draft survives');
  await page.locator('.tv-news > summary').click();
  await expect.poll(() => page.evaluate(() => window.testCalls.filter(call => call.action === 'setCardSection' && call.section === 'news').at(-1)?.open)).toBe(true);
  await page.locator('[data-action="refresh"]').click();
  await expect(page.locator('#tv-note-text')).toHaveValue('Draft survives');
  await page.locator('[data-action="close"]').click();
  await page.locator('[data-action="note-discard"]').click();
  await page.getByRole('button', { name: 'Open MSFT stock card', exact: true }).click();
  await expect(page.locator('.tv-news')).toHaveAttribute('open', '');
  await expect(page.locator('.tv-fundamentals')).not.toHaveAttribute('open', '');
  await page.locator('[data-action="close"]').click();
  const stored = await page.evaluate(() => chrome.storage.local.get());
  await mockChrome(page, { popup: true, initial: stored });
  await page.getByRole('button', { name: 'Open AAPL stock card', exact: true }).click();
  await expect(page.locator('.tv-news')).toHaveAttribute('open', '');
});

test('responsive market window keeps controls usable from narrow to wide', async ({ page }) => {
  await mockChrome(page, { popup: true, url: 'https://x.com/popup.html?expanded=1', initial: {
    watchlist: Array.from({ length: 100 }, (_, i) => `SYM${i}`), recent: ['AAPL', 'MSFT'],
    quoteSnapshots: { SYM0: { name: 'A very long company name that should remain inside its table column', price: 123456.78, currency: 'USD', change: 1234.56, changePercent: 12.34 } }
  } });
  for (const width of [320, 420, 640, 900]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.locator('.watch-row')).toHaveCount(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const watch = await page.locator('.watch-section').boundingBox(), recent = await page.locator('.recent-section').boundingBox();
    if (width === 900) expect(recent.x).toBeGreaterThan(watch.x + watch.width);
    else expect(recent.y).toBeGreaterThan(watch.y);
    await page.screenshot({ path: `test-results/market-${width}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#toggle-add').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#symbol')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#toggle-add')).toBeFocused();
});

test('filter shortcut respects editors and dialogs and Escape clears only the filter', async ({ page }) => {
  await mockChrome(page, { popup: true, initial: { watchlist: ['AAPL', 'MSFT'] } });
  await page.locator('#toggle-add').focus(); await page.keyboard.press('/');
  await expect(page.locator('#watch-filter')).toBeFocused();
  await page.keyboard.type('aapl'); await expect(page.locator('.watch-row')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(page.locator('#watch-filter')).toHaveValue('');
  await expect(page.locator('#watch-filter')).toBeFocused(); await expect(page.locator('.watch-row')).toHaveCount(2);
  await page.locator('#search-symbol').focus(); await page.keyboard.press('/');
  await expect(page.locator('#search-symbol')).toHaveValue('/');
  await page.locator('#open-settings').click(); await page.keyboard.press('/');
  await expect(page.locator('#watch-filter')).not.toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#settings-dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Open AAPL stock card', exact: true }).click();
  await page.keyboard.press('/'); await expect(page.locator('#watch-filter')).not.toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#tickerview-modal')).toBeHidden();
});

test('retry quotes targets only failures, preserves good rows, and restores refresh focus on recovery', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await mockChrome(page, { popup: true, initial: { watchlist: ['AAPL', 'FAIL'] } });
  await page.locator('#refresh-watchlist').click(); await expect(page.locator('#refresh-watchlist')).toBeEnabled();
  await expect(page.locator('#retry-quotes')).toHaveText('Retry quotes (1)');
  await page.evaluate(() => { window.recoverQuotes = true; window.blockRefresh = true; });
  await page.locator('#retry-quotes').click();
  await expect(page.locator('#retry-quotes')).toBeDisabled(); await expect(page.locator('#refresh-watchlist')).toBeDisabled();
  const call = await page.evaluate(() => window.testCalls.filter(call => call.action === 'refreshDashboard').at(-1));
  expect(call.symbols).toEqual(['FAIL']); expect(call.force).toBe(true);
  await expect(page.locator('.watch-row').first()).toContainText('200');
  await page.screenshot({ path: 'test-results/retry-quotes-narrow.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.releaseRefresh());
  await expect(page.locator('#retry-quotes')).toBeHidden();
  await expect(page.locator('#refresh-feedback')).toBeEmpty();
  await expect(page.locator('#refresh-watchlist')).toBeFocused();
  await expect(page.locator('.watch-warning')).toHaveCount(0);
});

test('watchlist drag reordering saves manual order and keyboard moves preserve focus', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 420, height: 800 });
  await mockChrome(page, { popup: true, initial: { watchlist: ['AAPL', 'MSFT', 'GOOG'], watchSort: 'symbol' } });
  await page.locator('#watch-filter').fill('aapl');
  await page.locator('#reorder-watchlist').click();
  await expect(page.locator('#watch-filter')).toHaveValue(''); await expect(page.locator('#watch-filter')).toBeDisabled();
  await expect(page.locator('[data-sort-key="symbol"]')).toBeDisabled();
  await expect(page.locator('.watch-identity strong')).toHaveText(['AAPL', 'MSFT', 'GOOG']);
  const last = page.locator('.watch-row').last(), box = await last.boundingBox();
  await page.getByRole('button', { name: 'Move AAPL', exact: true }).dragTo(last, { targetPosition: { x: 80, y: box.height - 2 } });
  await expect(page.locator('.watch-identity strong')).toHaveText(['MSFT', 'GOOG', 'AAPL']);
  await expect(page.locator('#reorder-feedback')).toHaveText('Moved AAPL after GOOG');
  await expect(page.getByRole('button', { name: 'Move AAPL', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.watch-identity strong')).toHaveText(['MSFT', 'AAPL', 'GOOG']);
  await expect(page.getByRole('button', { name: 'Move AAPL', exact: true })).toBeFocused();
  await page.evaluate(() => window.updateStorage({ quoteSnapshots: { AAPL: { price: 99 } } }));
  await expect(page.getByRole('button', { name: 'Move AAPL', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/watchlist-reorder-narrow.png' });
  await page.keyboard.press('Escape'); await expect(page.locator('#reorder-watchlist')).toHaveText('Reorder');
  await expect(page.locator('#reorder-watchlist')).toBeFocused(); await expect(page.locator('#watch-filter')).toBeEnabled();
  await page.getByRole('button', { name: 'Sort by symbol', exact: true }).click();
  await expect(page.locator('.watch-identity strong')).toHaveText(['AAPL', 'GOOG', 'MSFT']);
  await page.locator('#reorder-watchlist').click();
  await expect(page.locator('.watch-identity strong')).toHaveText(['MSFT', 'AAPL', 'GOOG']);
  await page.evaluate(() => { window.failMove = true; });
  await page.getByRole('button', { name: 'Move AAPL', exact: true }).press('ArrowDown');
  await expect(page.locator('#reorder-feedback')).toHaveText('Could not save order');
  await expect(page.locator('.watch-identity strong')).toHaveText(['MSFT', 'AAPL', 'GOOG']);
  expect(errors).toEqual([]);
});

test('drag cancellation and quote updates do not change order or interrupt a drag', async ({ page }) => {
  await mockChrome(page, { popup: true, initial: { watchlist: ['AAPL', 'MSFT'] } });
  await page.locator('#reorder-watchlist').click();
  await page.getByRole('button', { name: 'Move AAPL', exact: true }).evaluate(handle => {
    window.dragHandle = handle; window.dragData = new DataTransfer();
    handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.dragData }));
  });
  await page.evaluate(() => window.updateStorage({ quoteSnapshots: { AAPL: { price: 123 } } }));
  expect(await page.evaluate(() => window.dragHandle.isConnected)).toBe(true);
  await page.evaluate(() => window.dragHandle.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.dragData })));
  await expect(page.locator('.watch-identity strong')).toHaveText(['AAPL', 'MSFT']);
  await expect(page.locator('.watch-price').first()).toContainText('123');
  expect(await page.evaluate(() => window.testCalls.filter(call => call.action === 'moveWatch'))).toEqual([]);
  await page.getByRole('button', { name: 'Remove AAPL', exact: true }).click();
  await page.locator('#reorder-watchlist').click();
  await expect(page.locator('#reorder-help')).toBeHidden();
});

test('watchlist indicators show values, missing and cached states with hover and keyboard column descriptions', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  const sessionDate = '2026-10-23', fetchedAt = Date.now();
  await mockChrome(page, { popup: true, url: 'https://x.com/popup.html?expanded=1', initial: {
    watchlist: ['AAPL', 'ZERO', 'STALE', 'OLD', 'FAIL'], quoteSnapshots: {
      AAPL: { price: 100, currency: 'USD', sessionDate, quickIndicators: { rsi: 55.12, ytdVwap: 95.123, sessionDate, fetchedAt } },
      ZERO: { price: 1, currency: 'USD', sessionDate, quickIndicators: { rsi: 0, ytdVwap: 0, sessionDate, fetchedAt } },
      STALE: { price: 10, currency: 'EUR', sessionDate, quickIndicators: { rsi: 70, ytdVwap: 11, sessionDate, fetchedAt, stale: true } },
      OLD: { price: 10, sessionDate, quickIndicators: { rsi: 99, ytdVwap: 100, sessionDate: '2025-12-31', fetchedAt } },
      FAIL: { price: 10, sessionDate, quickIndicators: { rsi: null, ytdVwap: null, sessionDate, error: 'History offline' } }
    }
  } });
  await expect(page.locator('.watch-rsi')).toHaveText(['55.1', '0.0', '70.0Cached', '—', '—Unavailable']);
  await expect(page.locator('.watch-ytd-vwap')).toHaveText(['95.12', '0.00', '11.00Cached', '—', '—Unavailable']);
  await expect(page.locator('.watch-ytd-vwap').first()).toHaveAttribute('title', /Anchored 2026-01-01.*USD.*Daily close/);
  await page.getByRole('button', { name: 'About YTD anchored VWAP estimate' }).hover();
  await expect(page.getByRole('tooltip')).toContainText('sum(daily close × volume)');
  await page.screenshot({ path: 'test-results/watchlist-indicators-wide.png' });
  await page.getByRole('button', { name: 'About RSI (14)' }).focus();
  await expect(page.getByRole('tooltip')).toContainText('Wilder');
  await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toBeHidden();
  await page.getByRole('button', { name: 'Sort by price', exact: true }).hover();
  await expect(page.getByRole('tooltip')).toContainText('quote currency');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole('button', { name: 'About YTD anchored VWAP estimate' }).focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.getByRole('button', { name: 'About YTD anchored VWAP estimate' }).focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  const tooltipBox = await page.getByRole('tooltip').boundingBox();
  expect(tooltipBox.x).toBeGreaterThanOrEqual(0); expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: 'test-results/watchlist-indicators-narrow.png' });
});

test('VWAP distance uses estimate as baseline, preserves zero and missing data, and labels cached values', async ({ page }) => {
  const sessionDate = '2026-10-23';
  const snapshot = (price, ytdVwap, extra = {}) => ({ price, currency: 'USD', sessionDate, quickIndicators: { ytdVwap, sessionDate, ...extra } });
  await mockChrome(page, { popup: true, initial: { watchlist: ['UP', 'DOWN', 'FLAT', 'ZERO', 'NOVOL', 'MISSING', 'OLD'], quoteSnapshots: {
    UP: snapshot(110, 100), DOWN: snapshot(90, 100, { stale: true }), FLAT: snapshot(100, 100),
    ZERO: snapshot(0, 100), NOVOL: snapshot(10, 0), MISSING: snapshot(null, 100), OLD: snapshot(110, 100, { sessionDate: '2025-12-31' })
  } } });
  await expect(page.locator('.watch-vwap-diff-percent')).toHaveText(['+10.00%', '-10.00%', '+0.00%', '-100.00%', '—', '—', '—']);
  await expect(page.locator('.watch-vwap-diff-amount')).toHaveText(['+10.00', '-10.00', '0.00', '-100.00', '+10.00', '—', '—']);
  await expect(page.locator('.watch-vwap-diff-percent').first()).toHaveClass(/positive/);
  await expect(page.locator('.watch-vwap-diff-percent').nth(1)).toHaveClass(/negative/);
  await expect(page.locator('.watch-vwap-diff').nth(1)).toContainText('Cached');
  await expect(page.locator('.watch-vwap-diff-amount').first()).toHaveAttribute('title', /USD/);
  await page.getByRole('button', { name: 'About distance from YTD VWAP', exact: true }).focus();
  await expect(page.getByRole('tooltip')).toContainText('price − VWAP');
  await page.screenshot({ path: 'test-results/watchlist-vwap-diff.png' });
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
