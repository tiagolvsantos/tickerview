# Changelog

All notable changes to this project will be documented in this file.

## [2.1.1] - 2026-10-24

### Fixed

- Cache the logo URL at startup so extension reloads cannot interrupt card replacement and leave a previous ticker or empty border visible; disconnected cards show a page-refresh message.
- Render stock cards through a scoped Trusted Types policy so enforcing host pages do not leave an empty card border.
- Capture ticker hover events before host handlers intercept them and read the current cashtag text when opening a card.

### Added

- Project-specific `AGENTS.md` covering extension architecture, behavior, privacy, validation, and Conventional Commits.

## [2.1.0] - 2026-10-23

Minor release adding market overview, configurable refresh, portable backups, ticker aliases, personal notes, and clearer settings.

### Added
- Reorganized gear settings into Market, Cards, Aliases, and Backup tabs with keyboard navigation. Auto-refresh is immediately visible on the default Market tab with an On/Off switch, interval, and status; the main countdown/“Auto off · Enable” button opens it directly. Separated website highlighting from quote refresh controls.
- Compact SPY, QQQ, VIX, and BTC market overview with canonical card links, shared cached requests, partial-failure handling, and a shared three-request refresh queue.
- Clickable Symbol, Price, and Change column headers with ascending/descending sorting and accessible sort states; moved the sort dropdown into gear settings.
- Retrieval-age freshness indicator, circular-arrow manual refresh button with a loading animation, and a live countdown. Automatic refresh defaults to 15 seconds, supports configurable 15/30-second or 1/2/5-minute intervals, pauses while hidden, and avoids overlapping refreshes. Dashboard cache freshness follows the configured interval; manual refresh requests fresh data while preserving failure cooldowns.
- Content-fitted initial window, remembered manual dimensions, and Fit to content / Full height controls; market preferences travel in backups while window bounds stay local, with older backups still supported.
- Show daily price change in quote-currency amount alongside percentage change in the watchlist table, with directional colors and preserved zero values.
- Market-first extension window with aligned Symbol/company, Price, and Change watchlist columns. Centralized extension controls, appearance, indicators, aliases, and export/import in an accessible gear-button settings dialog.
- Export/import JSON backups covering settings, watchlists, recents, sort order, custom aliases, notes, and valuation assumptions, with a preview, Merge/Replace choices, strict validation, and offline restores that preserve open drafts. Quotes and caches are excluded.
- Direct ticker/alias search and configurable Alt+Shift+T shortcut; reuse the existing window without reloading or losing drafts.
- Built-in Yahoo aliases for common indices and BTC/ETH, plus provider-verified local custom overrides and reset controls. Canonical symbols share saved data; alias changes never redirect existing saved instruments.
- Resolve aliases when hovering or keyboard-opening cashtags, searching, and manually adding watchlist symbols, including `$VIX` → `^VIX`, `$BTC` → `BTC-USD`, `$ETH` → `ETH-USD`, and `$SPX` → `^GSPC`. Preserve original page text and native link destinations while showing the resolved symbol in the card.
- Apply custom alias changes to already-open pages without requiring a page refresh.
- Watchlist quote refresh with three-request concurrency, progress and partial failure labels, plus persistent symbol/company/daily-change sorting.
- Local per-ticker notes with explicit saves, draft protection, revision conflicts, deletion, and bounded storage.
- Canonical Yahoo research links and instrument-appropriate index/crypto fundamentals messaging.

## [2.0.0] - 2026-10-23

Major release introducing the Cerberus redesign, expanded market data, and X Pro / OldTweetDeck support.

### Changed
- Replaced the repository screenshots with seven 1280 × 800 feature images covering the stock card, watchlist, fundamentals, controls, news and research, TweetDeck highlighting, and valuation scenarios; refreshed the README gallery and reproducible screenshot generator.
- Bumped the Chrome manifest, popup, and development package versions to 2.0.0.
- Keep Node.js and npm limited to development tools; the extension runs directly in Chrome without a build step.

### Added
- Clicking the toolbar icon now directly opens a resizable window fitted to the available screen height, bypassing Chrome’s 600-pixel toolbar-panel limit. The original website context is retained, and watchlists and recent symbols use the extra height.
- Value estimate panel with editable EPS × P/E bear/base/bull scenarios, quote comparisons, locally saved assumptions for up to 100 stocks, and separate analyst targets. Defaults are explicitly illustrative; ineligible instruments and currency mismatches show an explanation.
- Expanded Fundamentals section with valuation multiples, EPS, revenue, growth, margins, return on equity, cash flow, cash, and debt; reporting currency is shown separately from the stock quote currency.
- Reorganized popup with master/site switches, collapsible appearance controls, indicator presets and groups, cached company/price watchlist rows, inline symbol validation, direct popup cards, recent-symbol saving, and Clear history.
- Cerberus Terminal branding: original three-headed logo in all Chrome icon sizes, navy/silver/orange theme, bundled Montserrat and IBM Plex Mono fonts, and redesigned popup and stock card.
- Pin, save, refresh, close, keyboard opening, Escape dismissal, and keyboard chart inspection.
- Interactive chart timeframes, crosshair, aligned volume bars, and timestamps.
- Settings popup with per-site controls, hover delay, compact mode, reduced effects, and indicator selection.
- Persistent local watchlist, recent symbols, source freshness labels, and explainable headline sentiment.
- Developer-only calculation, cache, service-worker, and Chrome UI tests.

### Performance
- Progressive quote, technical, and detail loading; optional request failures preserve usable data.
- Shared in-flight requests, separate resource TTLs, bounded persistent cache, request timeouts, and failure cooldowns.
- Batched, time-budgeted DOM scanning with text-change detection and editable-area exclusions.
- Reuse daily history and rebuild the current session from fresh intraday bars; parse fundamentals from inert structured JSON on the public statistics page.
- Pause quote refresh in hidden tabs and avoid duplicate scanning inside embedded frames.

### Fixed
- Retain the analyst recommendation label and original colored low/mean/high/current-price target graphic alongside the earnings valuation scenarios.
- Keep native TweetDeck cashtag links and their nested dollar-sign/ticker spans orange when host link styles override their color.
- Detect split-span cashtag links in X Pro / OldTweetDeck without replacing their markup, handle recycled rows and body replacement, and retain pinned cards during column scrolling.
- Clean legacy currency false positives from saved/recent symbols and preserve focus when cached watchlist rows update.
- Restore fundamentals through the structured payload on Yahoo’s public statistics page, identify the source and short-interest date, and render available analyst mean targets.
- Omit mixed-currency ADR price-to-sales ratios instead of displaying misleading multiples.
- Preserve last-session VWAP when premarket trading-period metadata advances to the following day.
- Use Cerberus orange for every chart line and list unavailable metrics explicitly instead of repeated N/A cells.
- Stop highlighting currency amounts such as `$1B`, `$5B`, and `$5.8B` as stock tickers while preserving exchange-qualified numeric symbols such as `$7203.T`.
- Ignore stale responses after closing or switching cards.
- Align price/volume data by timestamp and preserve valid zero values.
- Use exchange-local session dates for gaps, prior-session levels, and benchmark comparisons.
- Exclude current session from average-volume baseline and label volume ratio accurately.
- Correct headline decay, expire old evidence, match whole words, and filter duplicate/unrelated headlines.
- Replace inline click handlers with native controls and safe event listeners.

## [1.1.2] - 2026-03-19
### Fixed
- **Percentage Display Fallbacks**: Fixed UI bug where `+N/A(N/A%)` rendered when partial Yahoo Finance data is present. It now gracefully falls back to raw daily percentage calculation if the official previous market close change is broken.
- **RS SPY & Relative Sector Nullity**: Hardened `fetchSpy` and `fetchSectorPerformance` background API calls to eliminate `N/A` errors for Relative Strength metrics during off-market hours by increasing chart range logic.

## [1.1.1] - 2026-01-30
### Fixed
- **Cursor Jumping Fix**: Resolved an issue where typing tickers (e.g., $SPY) in content-editable fields (such as X/Twitter composers or Reddit comments) would cause the cursor to jump back to the beginning or reset current input. The extension now correctly identifies and skips text nodes within `contentEditable` elements during the highlight scan.

## [1.1]
### Added
- Initial public release version.
