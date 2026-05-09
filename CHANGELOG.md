# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-05-09

### Added
- **Clean Capture Engine**: Automatic hiding of extension UI (toasts and indicator pills) during screenshot capture to ensure artifacts are not included in the final image.

### Fixed
- **Metadata Embedding**: Resolved `ReferenceError` and `TypeError` in Service Worker by switching from dynamic `import()` to static ES modules for `embedMetadata` logic.
- **Permission Resilience**: Added error handling to script and CSS injection to prevent crashes on protected extension pages (e.g., `chrome-extension://`).
- **Canvas Performance Warnings**: Eliminated "willReadFrequently" console warnings by enabling optimized 2D context configurations across the codebase.

### Changed
- Bumped version to 2.1.0 for production release.

## [2.0.0] - 2026-05-09

### Added
- **Full-Page Stitching**: High-performance capture engine for long scrollable pages.
- **Annotation Engine**: Rich toolset (Arrows, Highlights, Blur, Sticky Notes, Text).
- **Visual Library**: Brand new full-tab dashboard with grid view and search.
- **Folder & Tag Management**: Advanced organization system.
- **Export Power**: ZIP, PDF, and Markdown export capabilities.
- **Broken Link Checker**: Automatic verification of saved bookmark health.
- **Privacy Policy**: Dedicated transparency page and in-app links.

### Changed
- Migrated to **Manifest V3** for modern security and performance standards.
- Re-architected storage to use **IndexedDB** for high-resolution blobs.
- Optimized UI for a premium, dark-mode aesthetic (Linear/Arc inspired).

### Removed
- Legacy Google Drive sync (replaced with local-first, privacy-focused architecture).
- Firefox-only manifest keys (now Chrome-first, port-ready).

---

## [1.0.0] - 2024-xx-xx
- Initial private release.
- Basic screenshot capture and storage.
