# Working on TickerView

## Project and runtime

TickerView is a Manifest V3 Chrome extension branded as Cerberus TickerView. It highlights stock cashtags on supported sites and provides market cards and a separate market/watchlist window. Chrome loads the repository files directly: there is no build step, production Node runtime, backend, account system, or runtime npm dependency. Keep that deployment model unless the task explicitly changes it.

Read `README.md` for current behavior and `PRIVACY_POLICY.md` before changing data collection, storage, networking, or permissions. Use the implementation as the source of truth when documentation differs.

## File map

| File | Responsibility |
| --- | --- |
| `manifest.json` | MV3 configuration, supported sites, permissions, script order, bundled resources, shortcut, version |
| `shared.js` | Shared `TickerView` global: settings/defaults, indicators, normalization, aliases, sorting, valuation and market-window preferences |
| `background.js` | Module service worker: message handling, Yahoo requests, resource orchestration, storage writes, refresh queue and window lifecycle |
| `market.js` | Market-data parsing, exchange-local dates, technical calculations, benchmarks and keyword sentiment |
| `cache.js` | Persistent bounded resource cache, shared in-flight requests, expiry, stale fallback and retry cooldown |
| `fundamentals.js` | Extract validated fundamentals from structured data in Yahoo public HTML |
| `content.js` | Cashtag scanning, host-page integration, hover/keyboard cards, progressive rendering, charts, notes and valuations; reused inside the extension window |
| `popup.html`, `popup.js`, `popup.css` | Separate extension window: search, overview, watchlist, recents, settings, aliases and backup UI |
| `backup.js` | Versioned backup export, validation, merge/replace preparation and limits |
| `brand.css`, `styles.css` | Shared scoped brand tokens and injected card/highlight styles |
| `icons/`, `fonts/`, `images/` | Bundled branding, licensed fonts and repository screenshots/promotional assets |
| `tests/*.test.js` | Node unit and worker integration tests with simulated extension/network APIs |
| `tests/ui.spec.js` | Playwright content-script and window tests with mocked Chrome APIs/provider responses |
| `tests/fixtures/` | Deterministic provider fixtures |
| `scripts/` | Demo screenshots and promotional-image generation |

## Implementation conventions

- Follow the existing plain JavaScript, HTML and CSS style: two-space indentation, single-quoted JavaScript strings, semicolons and small focused functions. Avoid introducing frameworks, bundlers or dependencies for routine changes.
- Preserve runtime boundaries. `shared.js` is loaded before `content.js` as a classic script and also imported by modules; do not convert it to an export-only module. Keep provider networking and authoritative storage operations in the worker.
- Reuse shared normalization, settings and validation helpers instead of duplicating rules between the window, cards and worker. Validate incoming messages and imported data at their boundaries.
- Keep changes scoped to the task and preserve unrelated working-tree changes. Do not edit `node_modules/`, test outputs or generated images unless the task calls for them.

## Behavior to preserve

### Symbols and host pages

- Resolve aliases at user entry points; saved instruments use canonical Yahoo symbols. Alias targets are literal symbols and never chain. Editing aliases must not redirect existing saved entries.
- Preserve share-class mapping (`BRK.B` → `BRK-B`), exchange suffixes (`VOD.L`, `7203.T`) and index/crypto mappings. Do not guess exchanges or treat currency amounts such as `$1B` and `$5.8B` as stocks.
- Support split native cashtags, recycled feed rows, text mutations and replaced page bodies, especially X Pro/OldTweetDeck. Preserve native markup, link destinations and host interactions; disabling scanning restores extension decorations.
- Keep scanning deduplicated and chunked (currently at most 250 nodes or about 6 ms per chunk). Exclude editable fields, code blocks, extension UI and other existing excluded surfaces. Do not expand scanning to arbitrary sites or frames accidentally.
- Exercise hover transitions between symbols and nested spans. Host event interception, delayed hovers and late provider responses must not display another ticker or reopen a closed card. Preserve pin, scrolling and keyboard behavior.

### Market data and refresh

- Keep quote/chart loading independent of optional details. Failures in fundamentals, news or benchmarks must leave successful card data usable.
- Preserve symbol verification, request coalescing, timeouts, bounded persistent caching, cooldowns and visibly labeled stale fallbacks. Dashboard refresh currently allows at most three concurrent symbol requests; manual refresh bypasses freshness without bypassing shared requests or failure cooldowns.
- Pause automatic refresh while hidden and avoid overlapping refreshes. Card and dashboard refresh schedules are distinct; preserve the user's market-window preferences.
- Distinguish provider quote time from retrieval time and use exchange-local session dates. Compare benchmark returns only for matching sessions. Preserve zero values; missing or non-finite data must not become fabricated prices or metrics.
- Keep estimated VWAP, full-day volume comparisons, heuristic sentiment and illustrative EPS × P/E scenarios accurately labeled. Analyst targets remain separate. Respect instrument type and currency compatibility for fundamentals and valuation.

### Saved data, accessibility and design

- Preserve note drafts during refreshes and timeframe changes, explicit saves, leave prompts and revision-conflict handling. Do not silently overwrite unsaved work.
- Respect saved-data limits and versioned backup compatibility. Validate imports before writing; preserve documented Merge/Replace semantics. Caches, note revisions and machine-specific window bounds are excluded from backups.
- Keep keyboard access, focus restoration, Escape dismissal, dialog semantics, visible focus states and reduced-motion behavior.
- Follow the existing Cerberus navy/silver palette, `#FF6600` accent, compact layout, bundled Montserrat headings and IBM Plex Mono data text. Scope injected CSS and fonts to extension surfaces so host pages retain their styling.

## Privacy and extension security

- Keep user settings and saved data local. Do not add telemetry or transmit page text, visited-page URLs, notes or watchlists to providers.
- Provider requests omit credentials and referrers. Parse public structured data without executing downloaded scripts; treat provider strings and imported content as untrusted. Escape interpolated HTML and validate external link protocols.
- Maintain narrowly scoped manifest permissions, site matches and web-accessible resources. Changes to those scopes must be intentional and reflected in the privacy documentation.
- Keep assets local and retain font licenses. Do not introduce remote executable code or external font services.

## Validation and delivery

Always use Conventional Commits for commit messages: `<type>(<optional scope>): <description>` (for example, `fix(content): handle invalidated extension contexts` or `docs: update agent instructions`). Use a type that matches the change, such as `feat`, `fix`, `docs`, `refactor`, `test`, or `chore`; mark breaking changes with `!` and explain them in a `BREAKING CHANGE:` footer.

Install developer dependencies with `npm ci` when needed. There is no build command.

```sh
npm run check       # Syntax checks for runtime JavaScript
npm test            # Node unit and worker integration tests
npm run test:ui     # Playwright UI suite
```

- For JavaScript changes, run syntax checks and relevant tests. For shared data, worker, cache or storage changes, run the Node suite. For host-page, card or window behavior, run the affected Playwright tests; run the full UI suite when changes span multiple flows.
- Add focused regression coverage for behavioral fixes using deterministic fixtures and mocked APIs. Avoid live Yahoo dependencies in automated tests and avoid tests for documentation-only changes.
- Playwright uses the macOS Google Chrome executable by default; set `CHROME_PATH` on other systems. These tests simulate extension APIs and do not prove live-provider availability or a complete installed-extension integration.
- For visible UI changes, inspect the affected layout and keyboard interaction. `npm run screenshots` regenerates repository feature images with illustrative demo data; run it only when those assets need updating.
- Update `README.md` and `PRIVACY_POLICY.md` when their documented behavior changes; record user-facing changes in `CHANGELOG.md` as appropriate. When releasing, keep versions in `manifest.json`, `package.json` and `package-lock.json` aligned. Do not bump versions for unrelated work.
- Report what changed, checks run and any verification limits. Installed-extension changes require reloading the extension at `chrome://extensions` and refreshing existing supported-site tabs.
