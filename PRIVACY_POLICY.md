# Privacy Policy for TickerView

**Last updated: October 26, 2026**

## Local operation

TickerView scans text on supported websites locally to identify stock cashtags. It does not send page text or the visited page URL to the market-data provider. No account is required, and the extension has no analytics or developer-operated data collection service.

## Market-data requests

Search and cashtags resolve aliases locally. Opening a ticker card sends the resolved symbol to Yahoo Finance to retrieve quotes, historical bars, news, and fundamentals. Fundamentals are read from structured JSON in Yahoo’s public key-statistics page. Third-party page scripts are not executed. Parsed snapshot fields are cached locally. Benchmark requests send the SPY or relevant sector ETF symbol. Visible cards refresh periodically; selecting another chart range requests that symbol and timeframe. Requests omit browser credentials and page referrers.

As with any direct internet request, the provider can receive connection information such as your IP address and user agent. Yahoo Finance handles requests under its own privacy practices. The extension does not send your watchlist or recent-symbol list as a batch. Opening a visible extension window requests SPY, QQQ, ^VIX, and BTC-USD for the market overview, reusing the quote cache. Refresh requests the overview and saved symbols separately through a three-request queue. Retry quotes requests only unavailable, stale, or failed symbols from that overview and watchlist, using the same queue and cooldowns. Saved-symbol refreshes also retrieve daily history for RSI (14) and estimated year-to-date anchored VWAP, reusing the six-hour history cache. Calculations run locally and failures leave successful quotes available. Auto-refresh is enabled by default every 15 seconds while the window is visible and pauses while hidden. The interval can be changed to 15/30 seconds or 1/2/5 minutes, or disabled, under Settings → Market. Automatic quote-cache freshness follows this interval; manual refresh bypasses fresh cache entries while preserving shared requests and failure cooldowns. If an overview symbol is also saved, its watchlist snapshot is updated too; other watchlist symbols remain cached until refreshed.

## Local storage

TickerView stores the following in Chrome's local extension storage on this browser:

- Up to 100 personal notes (4,000 characters each), stored by canonical symbol independently of watchlist membership. Notes are never sent to Yahoo or the developer. Saving an empty note deletes it.
- Up to 100 custom ticker aliases and your watchlist sort preference. Alias keys and mappings remain local; saving a mapping sends its target symbol to Yahoo for verification.
- Expanded/collapsed card-section preferences, shared across tickers and stored only on this browser. These preferences are excluded from backups. Watchlist filtering and Undo state last only for the current window session.
- Settings, including the hostnames of sites where you disabled the extension.
- P/E valuation assumptions for up to 100 stock symbols. Calculations run locally; assumptions are not sent to a provider.
- Up to 100 watchlist symbols and the 12 most recently opened symbols.
- Up to 100 last-viewed quote summaries (company name, price/change, currency, timestamps, and daily RSI/YTD VWAP estimates with source status) for the popup watchlist. Opening the popup reads these local summaries without sending a watchlist batch to a provider.
- Four market overview quote snapshots, auto-refresh and window-height preferences, and remembered window dimensions/position. Window bounds remain local to this browser and are excluded from backups.
- A bounded market-data cache (up to 80 resources and approximately 2 MB of serialized data).

These values survive extension worker and browser restarts. They are not synced through a TickerView account or transmitted to the developer. Old cache entries are evicted; entries older than seven days are discarded when the cache restores. You can remove watchlist symbols and clear recent ticker history in the popup. Old currency false positives are removed from these symbol lists on upgrade. Removing the extension clears its local extension storage.

## Export and import

Export downloads a JSON file containing your saved settings, disabled-site hostnames, watchlist, recent symbols, sort and market-window preferences, custom aliases, notes, and valuation assumptions. It excludes cached quotes and other market-data caches. The downloaded file contains saved note text and is stored wherever your browser saves downloads. TickerView does not upload it anywhere.

Import reads a file you select locally, validates it, and previews the result before you apply it. Merge keeps local-only entries and gives imported entries precedence on conflicts; Replace removes entries absent from the backup. Settings, sort order, and market-window preferences are replaced in both modes. Validation and restoring storage do not contact providers; restoring enabled auto-refresh resumes quote requests in a visible window. Chrome-managed keyboard shortcuts are not transferred.

## External links

Opening research or news links navigates to the selected third-party website. That website's privacy practices then apply.

## Permissions

The extension uses local storage, temporary active-tab access to identify the current site when you open the popup, and host access to the two Yahoo Finance API domains and `finance.yahoo.com`. Automatic content scripts run only on the supported sites listed in the manifest.

## Updates and contact

Changes to this policy are published in this file. Contact the maintainer through the project's GitHub repository with privacy questions.
