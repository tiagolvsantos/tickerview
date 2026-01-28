# TickerView

**Single Purpose Description:** TickerView is a Chrome extension that provides real-time technical and fundamental stock data in a hover modal when a user interacts with stock tickers on any webpage.

## 🛠 Permission Justification

In accordance with the Single Purpose Policy, TickerView only requests the following essential permissions:
- **Host Permissions (`yahoo.com`)**: Required to fetch real-time price, technical indicators, and chart data directly from the API.
- **Content Scripts**: Explicitly limited to major financial and social platforms (Twitter, Reddit, Yahoo Finance, etc.) to automatically detect tickers where they are most relevant.
- **activeTab Permission**: Allows the user to manually trigger TickerView on any other website by clicking the extension icon, providing a privacy-first fallback.

---

**TickerView** is a high-performance, aesthetically stunning Google Chrome extension designed for traders and investors. It provides real-time technical stats, fundamental data, and interactive sparkline charts directly on any webpage when you hover over a stock ticker.

Built with an **"Obsidian Glass"** design philosophy, TickerView delivers professional-grade market intelligence with a premium, glassmorphism-inspired UI.

---

## 🚀 Key Features

- **Instant Intraday Insights**: Hover over any highlighted ticker (e.g., `$AAPL`, `$TSLA`) to see a live-updating modal with key price data.
- **Dynamic Sparklines**: Beautiful, high-frequency charts that automatically toggle between intraday (5m) and daily (1d) intervals based on market availability.
- **Advanced Technical Indicators**:
  - **RVOL (Relative Volume)**: Compare current volume against the 50-day average.
  - **RS (Relative Strength)**: Benchmark performance against both the S&P 500 (SPY) and the stock's specific Sector ETF (e.g., XLK, SMH).
  - **Volatility & Range**: Real-time ATR and ADR % calculation.
  - **Mean Reversion Tools**: Z-Score (Stretch) and Bollinger Band % position.
  - **Momentum**: 14-day RSI and VWAP distance.
- **Earnings Radar**: Smart alerts for upcoming or recently reported earnings to help you navigate volatility.
- **Sentiment Radar**: Real-time analytical engine that parses recent news headlines to categorize sentiment across five dimensions:
  - **Auction**: Treasury, yield, and bond market sentiment.
  - **Politics**: Geopolitical and legislative impacts.
  - **Weather**: Climate and seasonal influences on assets.
  - **Macro**: GDP, inflation, and interest rate trends.
  - **Policy**: Regulatory and legal landscape (SEC, Antitrust).
- **Contextual Intelligence**: Automatic detection of Sector/Industry and key levels (Breakout/Inside/Breakdown vs. Yesterday's High/Low).
- **Interactive Legend**: Hover over the `?` icon to view detailed definitions of every indicator.

## 🎨 Design Aesthetics: "Obsidian Glass"

TickerView doesn't just provide data; it looks professional while doing so:
- **Glassmorphism**: A sleek, translucent backdrop with high-blur (20px) and saturation (180%).
- **Monospace Typography**: optimized for data readability using `SF Mono` or `JetBrains Mono`.
- **Golden Glow Highlights**: Tickers are subtly highlighted with a golden glow, making it easy to identify actionable symbols without cluttering the page.
- **Premium Color Palette**: Curated colors for price action (`#00ffa3` for gains, `#ff4d4d` for losses) and signals.

## 🛠️ Tech Stack

- **Core**: Vanilla JavaScript (ES6+), HTML5, CSS3.
- **Data Engine**: Native fetch integrations with Yahoo Finance API.
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
