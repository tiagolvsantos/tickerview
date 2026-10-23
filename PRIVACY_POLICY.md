# Privacy Policy for TickerView

**Last updated: October 23, 2026**

## Local operation

TickerView scans text on supported websites locally to identify stock cashtags. It does not send page text or the visited page URL to the market-data provider. No account is required, and the extension has no analytics or developer-operated data collection service.

## Market-data requests

Opening a ticker card sends the requested symbol to Yahoo Finance to retrieve quotes, historical bars, news, and fundamentals. Fundamentals are read from structured JSON in Yahoo’s public key-statistics page. Third-party page scripts are not executed. Parsed snapshot fields are cached locally. Benchmark requests send the SPY or relevant sector ETF symbol. Visible cards refresh periodically; selecting another chart range requests that symbol and timeframe. Requests omit browser credentials and page referrers.

As with any direct internet request, the provider can receive connection information such as your IP address and user agent. Yahoo Finance handles requests under its own privacy practices. The extension does not send your watchlist or recent-symbol list as a batch.

## Local storage

TickerView stores the following in Chrome's local extension storage on this browser:

- Settings, including the hostnames of sites where you disabled the extension.
- Up to 100 watchlist symbols and the 12 most recently opened symbols.
- Up to 100 last-viewed quote summaries (company name, price/change, currency, and timestamps) for the popup watchlist. Opening the popup reads these local summaries without sending a watchlist batch to a provider.
- A bounded market-data cache (up to 80 resources and approximately 2 MB of serialized data).

These values survive extension worker and browser restarts. They are not synced through a TickerView account or transmitted to the developer. Old cache entries are evicted; entries older than seven days are discarded when the cache restores. You can remove watchlist symbols and clear recent ticker history in the popup. Old currency false positives are removed from these symbol lists on upgrade. Removing the extension clears its local extension storage.

## External links

Opening research or news links navigates to the selected third-party website. That website's privacy practices then apply.

## Permissions

The extension uses local storage, temporary active-tab access to identify the current site when you open the popup, and host access to the two Yahoo Finance API domains and `finance.yahoo.com`. Automatic content scripts run only on the supported sites listed in the manifest.

## Updates and contact

Changes to this policy are published in this file. Contact the maintainer through the project's GitHub repository with privacy questions.
