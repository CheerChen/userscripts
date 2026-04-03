# Changelog

## Emby Show Fields Persistence Fix

### v1.3.0 (2026-04-03)
- Add cross-library field config copy feature with modal UI panel
- Inject copy button (content_copy icon) next to the view settings button on library pages
- Source list shows libraries with saved config; target list shows all existing libraries
- Support "Apply to All" shortcut to select all target libraries at once
- Fetch library names from Emby API (VirtualFolders), compatible with both `ItemId` and `Id` fields
- Filter out deleted libraries (stale localStorage entries) from source list
- Bilingual UI (Chinese/English), auto-switches based on browser language

### v1.0.0 (2026-04-03)
- Initial release
- Intercept localStorage setItem to prevent Emby from resetting Show Fields to defaults
- Backup and restore field settings automatically on page load
- 10-locale UserScript metadata

---

## PikPak Batch JAV Renamer Assistant

### v0.1.1 (2026-04-03)
- Add bilingual UI (Chinese/English), auto-switches based on browser language
- Persist sort settings across sessions
- Replace gear icon with text button for settings
- Fix folder size displaying NaN

### v0.1.0 (2026-04-03)
- Full rewrite: React replaced with Preact + htm, dependency size reduced from 140KB to 5KB
- Rewrite JAV code parser, ported from bangou/parser (Go), adding heyzo, mgstage, site prefix, part, and tag support
- Remove DMM API related code and config UI
- Remove build pipeline (build.js/Makefile/template), switch to single-file maintenance
- Remove MIME type mapping table and test environment proxy logic
- Codebase reduced from 1275 lines to 519 lines

### v0.0.35 (2026-04-02)
- Add 10-locale UserScript metadata (name/description)
- Add DMM API query support and config panel

### v0.0.32 (2026-01-22)
- Add mypikpak.net and pikpak.me match patterns

### v0.0.21 (2025-09-14)
- Fix config dialog and sorting issues
- Add folder analysis tool

### v0.0.20 (2025-09-14)
- Initial release using React 18
- Integrate core JAV code recognition logic and build pipeline
- Add config panel (date prefix, extension fix)
- Add batch scanning with AV-wiki direct access + search fallback

---

## PikPak Aria2 Helper

### v0.1.0 (2026-04-03)
- Full rewrite: React replaced with Preact + htm, dependency size reduced from 140KB to 5KB
- Add bilingual UI (Chinese/English), auto-switches based on browser language
- Consolidate duplicated connection test logic, simplify config form code
- Remove fetch fallback, use GM_xmlhttpRequest exclusively
- Fix folder size displaying NaN
- Codebase reduced from 948 lines to 480 lines

### v0.0.4 (2026-04-03)
- Persist sort settings across sessions

### v0.0.3 (2026-04-02)
- Add 10-locale UserScript metadata

### v0.0.2 (2026-01-22)
- Add mypikpak.net and pikpak.me match patterns

### v0.0.1 (2025-12-14)
- Initial release using React 18
- Support pushing files and folders recursively to Aria2
- Aria2 RPC connection testing
- Configurable RPC URL, token, download path, and custom parameters
- Integrated into PikPak native toolbar

---

## PikPak JAV Renamer Assistant (Deprecated)

> This script has been fully superseded by PikPak Batch JAV Renamer Assistant v0.1.0 and is no longer maintained.

### v0.8.1 (2026-01-22)
- Add mypikpak.net and pikpak.me match patterns

### v0.7.1 (2025-08-29)
- Initial release
- Monitor PikPak rename dialog, inject smart rename button
- Extract JAV codes from filenames, query AV-wiki and auto-fill
- Preserve file extensions
