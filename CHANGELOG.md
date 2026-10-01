# Changelog

## Teams Transcript Extractor

### v1.2.0 (2026-10-01)
- Export directly from each Teams meeting recap list item, without opening the recording.
- Add an export button beside Share / Watch in browser in the Teams recap toolbar.
- Pin requests to the selected meeting's transcript ID; use authenticated GM requests across SharePoint origins and DOM-created SVG for Teams Trusted Types.
- Add real ScriptCat/Ego regression tests for both entry points and selection isolation.

### v1.1.2 (2026-09-29)
- Trigger button now clones the native primary ("Share") button item and is repainted Fluent orange `#d83b01` with white text — more visible next to the purple Share button

### v1.1.1 (2026-09-29)
- Trigger button clones a native `ms-OverflowSet-item` instead of hand-styling, inheriting the generated Fluent classes (font, height, hover) — fixes the button looking off
- Result UI rebuilt as a Fluent-style centered dialog (overlay + white card + Segoe UI) instead of the dark right-anchored panel

### v1.1.0 (2026-09-29)
- Trigger moved into the SharePoint command bar, injected before the Teams/Share button group; zh/ja/en label
- Floating-button fallback when no command bar exists (e.g. inside the recap OOPIF)

### v1.0.2 (2026-09-29)
- Fix: also match `_layouts/15` under site-collection path prefixes — OneDrive recording pages live at `<tenant>-my.sharepoint.com/personal/<user>/_layouts/15/stream.aspx`
- Add `streamembed.aspx` (the recap player OOPIF) to the matches

### v1.0.1 (2026-09-29)
- Match `/_layouts/15/` path on any host instead of `*.sharepoint.com` — the recap iframe may load from `teams.cloud.microsoft`; the Teams top page itself cannot be used (iframe src unset, contentWindow cross-origin)

### v1.0.0 (2026-09-29)
- Initial release — userscript port of the `teams-transcript-extract` agent skill
- Pull the full transcript from the page's own OneDrive v2.1 transcript API (two same-origin fetches, exact offsets, speaker ids, room attribution, system events); works even when the recording download button is blocked
- Fallback: scroll-harvest the virtualized transcript list when the API fails (ja/zh/en aria-label time parsing)
- Floating result panel: Copy TXT / Download TXT / Download JSON (JSON includes identityHints for mapping anonymized speakers)
- 6-locale UserScript metadata

---

## Tripo3D Model Downloader (Lite)

### v1.0.0 (2026-08-30)
- Initial release
- Passively capture model (GLB/GLTF) download URLs on Tripo3D Studio via fetch hook + PerformanceObserver
- Prefer PBR model URL when available; fall back to plain GLB / base model
- One-click download button with Shadow DOM UI, multi-URL dropdown when several models are captured
- 4-locale UserScript metadata (en/ja/zh-CN)

---

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

### v0.1.3 (2026-04-20)
- Add floating action button entry for batch renaming
- Support draggable button position for better placement on different layouts

### v0.1.2 (2026-04-07)
- Add debug logging for troubleshooting rename workflow issues

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

## Manebi Learning Helper

### v1.1.7 (2026-07-24)
- Rename the script and file from Manebi Learning Unblocker to Manebi Learning Helper
- Update localized names, UserScript metadata, console log prefixes, and README entry
- Add one-click automatic browsing for unfinished PDF lessons
- Skip completed lessons, browse every PDF page, wait for the completion mark, and continue to the next unfinished PDF
- Resume PDF automation after full-page lesson navigation
- Replace PDF Stop with Pause, preserve progress in session storage, and resume from the next unvisited page
- Start video playback automatically when Skip to End is used on a paused video
- Detect PDF and video content during SPA navigation, keep both controllers mutually exclusive, and rebind replaced video nodes
- Support course URLs without `lessonId`, paused Video.js players, and delayed video content in accessible same-origin iframes
- Match PDF Auto styling and drag behavior to Speed Control
- Localize controller labels, PDF progress, and error messages in Chinese, Japanese, and English; use English for other browser languages
- Remove unused commented-out anti-reset implementations

### v1.0.0 (2026-03-24)
- Initial release
- Prevent background-tab and page-focus detection
- Enable native video controls, playback speed adjustment, and seek shortcuts
- Handle videos loaded dynamically

---

## Zoom Recording CC Extractor

### v1.0 (2026-06-09)
- Initial release
- Extract closed captions (VTT) from Zoom cloud recording playback pages
- Intercept both XMLHttpRequest and fetch requests for CC resources
- Provide in-page UI for previewing captured subtitles
- Support downloading subtitles as VTT or plain text
- Support copying extracted plain text to clipboard
- Add manual extraction button as fallback when auto-capture misses the request

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
