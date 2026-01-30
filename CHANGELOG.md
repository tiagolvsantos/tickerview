# Changelog

All notable changes to this project will be documented in this file.

## [1.1.1] - 2026-01-30
### Fixed
- **Cursor Jumping Fix**: Resolved an issue where typing tickers (e.g., $SPY) in content-editable fields (such as X/Twitter composers or Reddit comments) would cause the cursor to jump back to the beginning or reset current input. The extension now correctly identifies and skips text nodes within `contentEditable` elements during the highlight scan.

## [1.1]
### Added
- Initial public release version.
