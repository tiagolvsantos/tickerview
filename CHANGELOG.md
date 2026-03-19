# Changelog

All notable changes to this project will be documented in this file.

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
