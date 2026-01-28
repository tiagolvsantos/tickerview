// background.js - Native Fetch Version (Technical Indicators)

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchStockData") {
    const ticker = request.ticker;

    // Global Cache for Ticker Data to prevent spam checks
    // This Map will persist across calls to the listener.
    if (!globalThis.tickerCache) {
      globalThis.tickerCache = new Map();
    }
    const tickerCache = globalThis.tickerCache;

    const fetchData = async () => {
      // 1. Check Cache (60s TTL)
      const now = Date.now();
      if (tickerCache.has(ticker)) {
        const c = tickerCache.get(ticker);
        if (now - c.time < 60000) { // 60 seconds
          return c.data;
        }
      }

      try {
        // 2. Parallel: Fetch Chart (Techs), Intra (VWAP), Summary (Cap/Earn), SPY (RS)
        const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2y`;
        const intraUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=5m&range=1d`;
        // Use v7 which is often more stable
        // Institutional Modules: Chart, Intra, Profiles, Stats, and Financials
        const sumUrl = `https://query1.finance.yahoo.com/v7/finance/quoteSummary/${ticker}?modules=summaryDetail,price,calendarEvents,summaryProfile,assetProfile,defaultKeyStatistics,financialData`;
        const newsUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${ticker}`;

        // SPY Cache Logic
        if (!globalThis.spyCache) globalThis.spyCache = { change: null, time: 0 };
        const fetchSpy = async () => {
          // const now = Date.now(); // 'now' is already defined above
          if (globalThis.spyCache.change !== null && (now - globalThis.spyCache.time < 300000)) {
            return globalThis.spyCache.change;
          }
          try {
            const r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1d');
            const d = await r.json();
            const m = d.chart.result[0].meta;
            const change = ((m.regularMarketPrice - m.chartPreviousClose) / m.chartPreviousClose) * 100;
            globalThis.spyCache = { change: change, time: now };
            return change;
          } catch (e) { return null; }
        };

        const [chartRes, intraRes, sumRes, spyChange, newsRes] = await Promise.all([
          fetch(chartUrl),
          fetch(intraUrl),
          fetch(sumUrl),
          fetchSpy(),
          fetch(newsUrl)
        ]);

        const chartData = await chartRes.json();
        const intraData = await intraRes.json();
        // Handle sumRes errors gracefully
        let sumData = {};
        try { sumData = await sumRes.json(); } catch (e) { }
        let newsData = {};
        try { newsData = await newsRes.json(); } catch (e) { }

        let quote = {};
        let meta = {};
        let volumes = [];
        let closes = [];
        let highs = [];
        let lows = [];
        let timestamps = []; // Need timestamps for Gap verification
        // opens array is now only used for fallback gap calculation, declared locally if needed

        // Parse Chart Data
        if (chartData.chart && chartData.chart.result && chartData.chart.result[0]) {
          const result = chartData.chart.result[0];
          meta = result.meta;
          timestamps = result.timestamp || [];

          if (result.indicators && result.indicators.quote && result.indicators.quote[0]) {
            const indicators = result.indicators.quote[0];
            closes = indicators.close || [];
            highs = indicators.high || [];
            lows = indicators.low || [];
            // opens = indicators.open || [];
            volumes = indicators.volume || [];
          }

          // --- Techs ---

          // 1. Simple Moving Average (SMA)
          const calculateSMA = (data, p) => {
            const c = data.filter(v => v != null && v != undefined); if (c.length < p) return null;
            return c.slice(-p).reduce((a, b) => a + b, 0) / p;
          };

          // 2. Relative Strength Index (RSI)
          const calculateRSI = (prices, p = 14) => {
            const c = prices.filter(v => v != null && v != undefined); if (c.length < p + 1) return null;
            let g = 0, l = 0; for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l += Math.abs(d); }
            let ag = g / p, al = l / p;
            for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = ((ag * (p - 1)) + (d > 0 ? d : 0)) / p; al = ((al * (p - 1)) + (d < 0 ? Math.abs(d) : 0)) / p; }
            if (al === 0) return 100; return 100 - (100 / (1 + ag / al));
          };

          // 3. Average True Range (ATR)
          const calculateATR = (h, l, c, p = 14) => {
            const t = []; for (let i = 1; i < c.length; i++) {
              if (h[i] == null || l[i] == null || c[i - 1] == null) continue;
              t.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
            }
            if (t.length < p) return null; return t.slice(-p).reduce((a, b) => a + b, 0) / p;
          };

          // 4. Standard Deviation
          const calculateStdDev = (data, p) => {
            const c = data.filter(v => v != null && v != undefined).slice(-p);
            if (c.length < p) return null;
            const mean = c.reduce((a, b) => a + b, 0) / p;
            const variance = c.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / p;
            return Math.sqrt(variance);
          };

          // 5. ADR % (Average Daily Range)
          const calculateADR = (h, l, p = 20) => {
            const t = [];
            for (let i = 0; i < h.length; i++) {
              if (h[i] == null || l[i] == null || l[i] === 0) continue;
              t.push((h[i] / l[i] - 1) * 100);
            }
            if (t.length < p) return null;
            return t.slice(-p).reduce((a, b) => a + b, 0) / p;
          };

          const ma20 = calculateSMA(closes, 20);
          const ma50 = calculateSMA(closes, 50);
          const ma200 = calculateSMA(closes, 200);
          const rsi = calculateRSI(closes, 14);
          const atr = calculateATR(highs, lows, closes, 14);
          const stdDev20 = calculateStdDev(closes, 20);

          // Mean Reversion & BB
          let zScore = null;
          let bbPct = null;
          const price = meta.regularMarketPrice;
          if (ma20 && stdDev20 && stdDev20 > 0) {
            zScore = (price - ma20) / stdDev20;
            const upper = ma20 + (2 * stdDev20);
            const lower = ma20 - (2 * stdDev20);
            bbPct = ((price - lower) / (upper - lower)) * 100;
          }

          // ADR
          const adrPct = calculateADR(highs, lows, 20);

          // New: ATR Percent
          const atrPct = (atr && price) ? (atr / price) * 100 : null;

          // New: RVOL
          const avgVol50 = calculateSMA(volumes, 50);
          const rvol = (avgVol50 && avgVol50 > 0) ? ((meta.regularMarketVolume || 0) / avgVol50) : null;

          // New: Distance to 200MA %
          const dist200 = (ma200 && price) ? ((price - ma200) / ma200) * 100 : null;

          // Shared vars for summary
          let marketCap = null, earningsDate = null, gapPct = null, officialChange = null, officialChangePct = null;
          let extendedPrice = null, extendedChangePct = null, sector = null, industry = null, longName = meta.symbol;
          let shortFloatPct = null, shortRatio = null;

          // New: Key Levels (Yesterday High/Low)
          let keyLevelStatus = null, yHigh = null, yLow = null;
          if (highs.length >= 2 && lows.length >= 2) {
            yHigh = highs[highs.length - 2];
            yLow = lows[lows.length - 2];

            if (price > yHigh) keyLevelStatus = "Breakout";
            else if (price < yLow) keyLevelStatus = "Breakdown";
            else keyLevelStatus = "Inside";
          }

          // --- VWAP & Intraday Chart Data ---
          let vwap = null, vwapDist = null;
          let intraCloses = [];
          let intraVolumes = []; // For Volume Bars

          if (intraData.chart?.result?.[0]?.indicators?.quote?.[0]) {
            const q = intraData.chart.result[0].indicators.quote[0];
            let cpv = 0;
            let cv = 0;
            const icloses = q.close || [];
            const ivols = q.volume || [];

            // Capture Intraday Series
            intraCloses = icloses.filter(x => x !== null);
            intraVolumes = ivols.filter(x => x !== null);

            for (let i = 0; i < icloses.length; i++) {
              if (icloses[i] !== null && ivols[i] !== null) {
                cpv += icloses[i] * ivols[i];
                cv += ivols[i];
              }
            }

            if (cv > 0) {
              vwap = cpv / cv;
              vwapDist = ((meta.regularMarketPrice - vwap) / vwap) * 100;
            }
          }

          // Failsafe mappings for the most common tickers to avoid "N/A"
          const failsafeMap = {
            'MSFT': { sector: 'Technology', name: 'Microsoft Corporation' },
            'AAPL': { sector: 'Technology', name: 'Apple Inc.' },
            'NVDA': { sector: 'Technology', name: 'NVIDIA Corporation', industry: 'Semiconductors' },
            'ORCL': { sector: 'Technology', name: 'Oracle Corporation' },
            'AMD': { sector: 'Technology', name: 'Advanced Micro Devices', industry: 'Semiconductors' },
            'AVGO': { sector: 'Technology', name: 'Broadcom Inc.', industry: 'Semiconductors' },
            'CRM': { sector: 'Technology', name: 'Salesforce, Inc.' },
            'TSLA': { sector: 'Consumer Cyclical', name: 'Tesla, Inc.' },
            'GOOGL': { sector: 'Communication Services', name: 'Alphabet Inc.' },
            'GOOG': { sector: 'Communication Services', name: 'Alphabet Inc.' },
            'AMZN': { sector: 'Consumer Cyclical', name: 'Amazon.com, Inc.' },
            'META': { sector: 'Communication Services', name: 'Meta Platforms, Inc.' }
          };

          if (sumData.quoteSummary?.result?.[0]) {
            const s = sumData.quoteSummary.result[0];

            // Better extraction of Company Profile
            const profile = s.summaryProfile || s.assetProfile;
            if (profile) {
              sector = profile.sector || null;
              industry = profile.industry || null;
            }

            if (s.price) {
              longName = s.price.longName || s.price.shortName || s.summaryDetail?.longName || meta.symbol;
              if (s.price.regularMarketChange?.raw !== undefined) officialChange = s.price.regularMarketChange.raw;
              if (s.price.regularMarketChangePercent?.raw !== undefined) officialChangePct = s.price.regularMarketChangePercent.raw * 100;

              // Extended Hours
              if (s.price.marketState === 'PRE' && s.price.preMarketPrice?.raw) {
                extendedPrice = s.price.preMarketPrice.raw;
                extendedChangePct = s.price.preMarketChangePercent?.raw ? s.price.preMarketChangePercent.raw * 100 : null;
              } else if ((s.price.marketState === 'POST' || s.price.marketState === 'CLOSED') && s.price.postMarketPrice?.raw) {
                extendedPrice = s.price.postMarketPrice.raw;
                extendedChangePct = s.price.postMarketChangePercent?.raw ? s.price.postMarketChangePercent.raw * 100 : null;
              }
            }

            if (s.defaultKeyStatistics) {
              const k = s.defaultKeyStatistics;
              // Fix: 0 is falsy, check for undefined instead
              if (k.shortPercentOfFloat?.raw !== undefined) shortFloatPct = k.shortPercentOfFloat.raw * 100;
              if (k.shortRatio?.raw !== undefined) shortRatio = k.shortRatio.raw;
            }

            marketCap = s.summaryDetail?.marketCap?.fmt || s.price?.marketCap?.fmt;

            // Aggressive Earnings Detection (Check all modules)
            const e1 = s.calendarEvents?.earnings?.earningsDate?.[0]?.fmt;
            const e2 = s.summaryDetail?.nextEarningsDate?.fmt;
            const e3 = s.financialData?.earningsAnnouncement?.fmt;
            earningsDate = e1 || e2 || e3 || null;

            if (!earningsDate && (s.summaryDetail?.lastEarningsDate || s.summaryDetail?.previousEarningsDate)) {
              // If we have a past date, it helps determine 'Just Reported'
              earningsDate = s.summaryDetail.lastEarningsDate?.fmt || s.summaryDetail.previousEarningsDate?.fmt;
            }

            if (s.price?.regularMarketOpen?.raw && s.price?.regularMarketPreviousClose?.raw) {
              gapPct = ((s.price.regularMarketOpen.raw - s.price.regularMarketPreviousClose.raw) / s.price.regularMarketPreviousClose.raw) * 100;
            }
          }

          // Apply Failsafe if API failed or returned empty
          if (!sector && failsafeMap[ticker]) {
            sector = failsafeMap[ticker].sector;
            industry = failsafeMap[ticker].industry || industry;
          }
          if ((!longName || longName === ticker) && failsafeMap[ticker]) {
            longName = failsafeMap[ticker].name;
          }

          // Earnings Logic (Failsafe & Status)
          let earningsStatus = null;
          let earningsDays = null;
          if (earningsDate) {
            try {
              const eDate = new Date(earningsDate);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const diffTime = eDate - today;
              earningsDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

              if (earningsDays === 0) earningsStatus = "Today";
              else if (earningsDays === -1) earningsStatus = "Yesterday (Just Reported)";
              else if (earningsDays < -1 && earningsDays > -5) earningsStatus = "Just Reported";
            } catch (e) { }
          }

          // Fallback Gap with strict Date Checking
          if (gapPct === null && result.indicators.quote && result.indicators.quote[0] && meta.chartPreviousClose) {
            const opens = result.indicators.quote[0].open || [];
            if (timestamps.length > 0 && opens.length > 0) {
              const lastTs = timestamps[timestamps.length - 1];
              const lastOpen = opens[opens.length - 1];

              // Check if last candle is from Today (or same day as meta.regularMarketTime)
              if (lastOpen) {
                const candleDate = new Date(lastTs * 1000).toDateString();
                const todayDate = new Date().toDateString();
                // Only show Gap if the candle is FRESH (Today).
                // If it's Saturday and last candle Fri, we show Fri Gap? Yes, that's standard.
                // If it's Monday morning Pre-market and last candle Fri? Then NO Gap.
                // Simple heuristic: Is candle 'Today'?
                if (candleDate === todayDate) {
                  gapPct = ((lastOpen - meta.chartPreviousClose) / meta.chartPreviousClose) * 100;
                }
              }
            }
          }

          // Fallback Scraping for Market Cap if Null
          if (!marketCap) {
            const webUrl = `https://finance.yahoo.com/quote/${ticker}`;
            try {
              const webRes = await fetch(webUrl);
              const webHtml = await webRes.text();
              const extract = (patterns) => {
                if (!Array.isArray(patterns)) patterns = [patterns];
                for (let p of patterns) {
                  const match = webHtml.match(p);
                  if (match && match[1]) return match[1];
                }
                return null;
              };
              marketCap = extract([
                /data-test="MARKET_CAP-value"[^>]*>([^<]+)</,
                /Market Cap(?:.|[\r\n])*?value="([^"]+)"/,
                />Market Cap<.*?<span[^>]*>([^<]+)<\/span>/
              ]);
            } catch (e) { console.log("Scrape fallback failed"); }
          }

          // Resolve Final Change (Official vs Manual)
          // Fallback: Use Chart Data [Last - 1] as Previous Close if Official is missing
          let manualChange = meta.regularMarketChange; // Default from meta
          let manualChangePct = meta.regularMarketChangePercent;

          // Stronger Manual Calculation if meta is weird (e.g. range=2y meta might be skewed)
          if (closes.length >= 2) {
            const lastClose = closes[closes.length - 2]; // Previous Day Close
            if (lastClose) {
              const current = meta.regularMarketPrice;
              manualChange = current - lastClose;
              manualChangePct = ((current - lastClose) / lastClose) * 100;
            }
          }

          const finalChange = officialChange !== null ? officialChange : manualChange;
          const finalChangePct = officialChangePct !== null ? officialChangePct : manualChangePct;

          // Sector Benchmark Intelligence (Cached & Robust)
          const sectorMap = {
            'technology': 'XLK',
            'information technology': 'XLK',
            'software': 'XLK',
            'software—infrastructure': 'XLK',
            'software—application': 'XLK',
            'semiconductors': 'SMH',
            'semiconductor': 'SMH',
            'communication services': 'XLC',
            'communication': 'XLC',
            'consumer cyclical': 'XLY',
            'consumer discretionary': 'XLY',
            'financial services': 'XLF',
            'financials': 'XLF',
            'healthcare': 'XLV',
            'energy': 'XLE',
            'industrials': 'XLI',
            'real estate': 'XLRE',
            'utilities': 'XLU',
            'basic materials': 'XLB',
            'materials': 'XLB',
            'consumer defensive': 'XLP',
            'consumer staples': 'XLP'
          };

          const sKey = (sector || "").trim().toLowerCase();
          const iKey = (industry || "").trim().toLowerCase();

          // Debugging Log (Visible in Extension Background Console)
          console.log(`[TickerView] ${ticker} | Sector: ${sector} | Industry: ${industry}`);

          let sectorEtf = sectorMap[sKey] || (iKey.includes('semiconductor') ? 'SMH' : null);
          if (iKey.includes('semiconductor') || sKey.includes('semiconductor')) sectorEtf = 'SMH';
          if (iKey.includes('software') || sKey.includes('software')) sectorEtf = 'XLK';

          // Sector Performance Cache (5m)
          if (!globalThis.sectorEtfCache) globalThis.sectorEtfCache = new Map();
          const fetchSectorPerformance = async (etf) => {
            if (!etf) return null;
            const now = Date.now();
            if (globalThis.sectorEtfCache.has(etf)) {
              const c = globalThis.sectorEtfCache.get(etf);
              if (now - c.time < 300000) return c.change;
            }
            try {
              const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${etf}?interval=1d&range=1d`);
              const d = await r.json();
              if (d.chart?.result?.[0]?.meta) {
                const m = d.chart.result[0].meta;
                const change = ((m.regularMarketPrice - m.chartPreviousClose) / m.chartPreviousClose) * 100;
                globalThis.sectorEtfCache.set(etf, { change, time: now });
                return change;
              }
            } catch (e) { }
            return null;
          };

          const sectorChange = await fetchSectorPerformance(sectorEtf);
          const relStrengthSector = (sectorChange !== null) ? (finalChangePct - sectorChange) : null;
          const relStrengthFinal = (spyChange !== null) ? (finalChangePct - spyChange) : null;

          // Extract basic price data
          quote = {
            symbol: meta.symbol,
            longName: longName,
            sector: sector,
            industry: industry,
            regularMarketPrice: meta.regularMarketPrice,
            regularMarketChange: finalChange,
            regularMarketChangePercent: finalChangePct,
            regularMarketVolume: meta.regularMarketVolume || 0,
            fiftyTwoWeekRange: (meta.fiftyTwoWeekLow && meta.fiftyTwoWeekHigh) ?
              `${meta.fiftyTwoWeekLow.toFixed(2)} - ${meta.fiftyTwoWeekHigh.toFixed(2)}` : null,

            // Extended Hours
            extendedPrice,
            extendedChangePct,

            // Calculated values
            fiftyDayAverage: ma50,
            twoHundredDayAverage: ma200,
            dist200, rvol, rsi, atr, atrPct, relStrength: relStrengthFinal, relStrengthSector, sectorEtf, keyLevelStatus, vwap, vwapDist, gapPct,
            zScore, bbPct, adrPct,

            marketCap: marketCap || null,
            earningsDate: earningsDate || null,
            earningsDays: earningsDays,
            earningsStatus: earningsStatus,
            shortFloatPct: shortFloatPct,
            shortRatio: shortRatio,
            categorySentiment: (() => {
              const items = newsData.news || [];
              const categories = {
                auction: { keywords: ['auction', 'treasury', 'yield', 'bond', 'bid', 'cover', 'debt', 'fixed income', 'notes'], score: 0, count: 0 },
                politics: { keywords: ['politics', 'election', 'trump', 'harris', 'biden', 'congress', 'senate', 'voting', 'diplomatic', 'washington', 'white house', 'legislation', 'geopolitical'], score: 0, count: 0 },
                weather: { keywords: ['weather', 'hurricane', 'storm', 'climate', 'drought', 'flood', 'temperature', 'commodity', 'agriculture', 'energy', 'oil', 'gas'], score: 0, count: 0 },
                macro: { keywords: ['macro', 'gdp', 'inflation', 'cpi', 'unemployment', 'rates', 'fed', 'central bank', 'economy', 'retail sales', 'consumer', 'labor', 'jobs', 'interest'], score: 0, count: 0 },
                policy: { keywords: ['policy', 'regulation', 'sec', 'antitrust', 'law', 'bill', 'tariff', 'tax', 'litigation', 'ftc', 'doj', 'court', 'lawsuit', 'legal', 'compliance'], score: 0, count: 0 }
              };

              const posWords = ['bull', 'surge', 'growth', 'gain', 'buy', 'positive', 'upbeat', 'beat', 'climb', 'higher', 'profit', 'expansion', 'outperform', 'upgrade', 'optimistic', 'recovery', 'strong', 'momentum'];
              const negWords = ['bear', 'drop', 'slump', 'loss', 'sell', 'negative', 'downbeat', 'miss', 'fall', 'lower', 'risk', 'contraction', 'underperform', 'downgrade', 'pessimistic', 'crash', 'fears', 'inflation', 'recession', 'weak', 'headwind'];

              items.forEach(item => {
                const title = (item.title || "").toLowerCase();
                let itemScore = 0;
                posWords.forEach(w => { if (title.includes(w)) itemScore++; });
                negWords.forEach(w => { if (title.includes(w)) itemScore--; });

                Object.keys(categories).forEach(cat => {
                  if (categories[cat].keywords.some(k => title.includes(k))) {
                    categories[cat].score += itemScore;
                    categories[cat].count++;
                  }
                });
              });

              const results = {};
              Object.keys(categories).forEach(cat => {
                const avg = categories[cat].count > 0 ? categories[cat].score / categories[cat].count : 0;
                results[cat] = {
                  score: avg,
                  label: avg > 0.05 ? 'Bullish' : (avg < -0.05 ? 'Bearish' : 'Neutral'),
                  count: categories[cat].count
                };
              });
              return results;
            })()
          };

          // Determine which chart to send
          // User requested "Intraday Chart Mode".
          // If we have intraday data, send it. Else fallback to daily.
          const visualChart = (intraCloses.length > 0) ? { closes: intraCloses, volumes: intraVolumes, interval: '5m' } : { closes: closes, volumes: volumes, interval: '1d' };

          const payload = {
            success: true,
            quote: quote,
            chart: visualChart
          };

          // 4. Cache Result
          tickerCache.set(ticker, { data: payload, time: Date.now() });

          return payload;
        }

        return { success: false, error: "No chart data found" };

      } catch (err) {
        console.error("[Native-Bg] Error:", err);
        return { success: false, error: err.message };
      }
    };

    fetchData().then(data => {
      sendResponse(data);
    });

    return true;
  }
});
