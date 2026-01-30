# TickerView ![Version](https://img.shields.io/badge/version-1.1.1-blue.svg)

**Single Purpose Description:** TickerView is a Chrome extension that provides real-time technical and fundamental stock data in a hover modal when a user interacts with stock tickers on any webpage.

## 🛠 Permission Justification

In accordance with the Single Purpose Policy, TickerView only requests the following essential permissions:
- **Host Permissions (`query1.finance.yahoo.com`, `query2.finance.yahoo.com`)**: Strictly scoped to fetch real-time price, technical indicators, and chart data directly from the Yahoo Finance API.
- **Content Scripts**: Explicitly limited to major financial and social platforms (Twitter, Reddit, Yahoo Finance, etc.) to automatically detect tickers where they are most relevant.
- **activeTab Permission**: Grants the extension temporary access to the current tab when the user interacts with it, ensuring a privacy-first integration.

---

**TickerView** is a high-performance, aesthetically stunning Google Chrome extension designed for traders and investors. It provides real-time technical stats, fundamental data, and interactive sparkline charts directly on any webpage when you hover over a stock ticker.

Built with an **"Obsidian Glass"** design philosophy, TickerView delivers professional-grade market intelligence with a premium, glassmorphism-inspired UI.

---

## 🚀 Key Features

- **Instant Intraday Insights**: Hover over any highlighted ticker (e.g., `$AAPL`, `$TSLA`) to see a live-updating modal with key price data.
- **Dynamic Sparklines**: Beautiful, high-frequency charts that automatically toggle between intraday (5m) and daily (1d) intervals based on market availability.
- **Price Target Compass**: A visual valuation track mapping Analyst Low, Mean, and High price targets relative to the current price.
- **Research Dock**: A row of quick-access links to TradingView (Charts), Finviz (Fundamentals), and OpenInsider (Insider Trading).
- **Pro Dashboard Support**: Full compatibility with **X.com Pro (TweetDeck)** and other high-density trading layouts.
- **Advanced Technical Indicators**:
  - **RVOL (Relative Volume)**: Compare current volume against the 50-day average.
  - **RS (Relative Strength)**: Benchmark performance against both the S&P 500 (SPY) and the stock's specific Sector ETF (e.g., XLK, SMH).
  - **Volatility & Range**: Real-time ATR and ADR % calculation.
  - **Mean Reversion Tools**: Z-Score (Stretch) and Bollinger Band % position.
  - **Momentum**: 14-day RSI and VWAP distance.
- **Earnings Radar**: Smart alerts for upcoming or recently reported earnings to help you navigate volatility.
- **Contextual Intelligence**: Automatic detection of Sector/Industry and key levels (Breakout/Inside/Breakdown vs. Yesterday's High/Low).
- **Interactive Legend**: Hover over the `?` icon to view detailed definitions of every indicator.

---

## 🧠 Advanced Sentiment Engine

The TickerView Sentiment Radar uses a sophisticated trader-centric algorithm to gauge market mood from news headlines:

### How it Works:
1.  **Time Decay (Recency Bias)**: The engine uses a linear decay function. News from 1 hour ago carries maximum weight (1.0), while news from 24-48 hours ago decays to 0.1 weight. This ensures the sentiment reflects current market conditions, not stale news.
2.  **Weighted Intensity**: The engine analyzes word intensity rather than just count. Extreme words (e.g., "CRASH", "PLUNGE", "SURGE") have 2.5x the mathematical impact on the score compared to neutral terms (e.g., "drop", "climb").
3.  **Overall Verdict**: An aggregate "Total" score is calculated across all news, providing an instant **[BULLISH]**, **[BEARISH]**, or **[NEUTRAL]** badge at the top of the modal.

### Sentiment Thresholds & Banner Logic:
The "Sentiment Badge" (visible next to the ticker symbol) is triggered based on the final calculated average score:
- **[BULLISH] (Green)**: Score > `+0.1`. Requires fresh positive catalysts like earnings beats, upgrades, or major partnerships.
- **[BEARISH] (Red)**: Score < `-0.1`. Triggered by heavy negative news such as earnings misses, lawsuits, layoffs, or analyst downgrades.
- **[NEUTRAL] (Orange)**: Score between `-0.1` and `+0.1`. This is the default state when news is balanced or "stale" (older than 48 hours).

### Analyzed Categories:
- **Corporate**: Earnings beats/misses, M&A activity, Guidance, and CEO changes.
- **Macro**: Inflation (CPI), Fed interest rates, GDP, and Treasury yields.
- **Regulation**: SEC filings, Lawsuits, Fines, and Antitrust investigations.
- **Retail**: Social hype, Reddit "rocket" sentiment, and short squeeze heat.

---

## 🎨 Design Aesthetics: "Obsidian Glass"

TickerView doesn't just provide data; it looks professional while doing so:
- **Glassmorphism**: A sleek, translucent backdrop with high-blur (20px) and saturation (180%).
- **Monospace Typography**: optimized for data readability using `SF Mono` or `JetBrains Mono`.
- **Vibrant Orange Highlights**: Tickers are subtly highlighted with a vibrant orange, making it easy to identify actionable symbols without cluttering the page.
- **Premium Color Palette**: Curated colors for price action (`#00ffa3` for gains, `#ff4d4d` for losses) and signals.

## 🛠️ Tech Stack

- **Core**: Vanilla JavaScript (ES6+), HTML5, CSS3.
- **Data Engine**: Native fetch integrations with Yahoo Finance V8/V7 APIs with automated Search API fallbacks for metadata reliability.
- **Calculation Engine**: Custom technical indicator library (SMA, RSI, ATR, StdDev).
- **Graphics**: Lightweight, performant SVG-based sparkline renderer.
- **Chrome Extension API**: Manifest V3, Service Workers, Content Scripts, and Cross-Origin Host Permissions.

## 📦 Installation

1. Clone this repository: `git clone https://github.com/tiagolvsantos/tickerview.git`
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top right).
4. Click **Load unpacked** and select the `tickerview` directory.
5. Enjoy professional market data on every site!

---

*Powered by Scap Cerberus*

---

[View Changelog](CHANGELOG.md)
