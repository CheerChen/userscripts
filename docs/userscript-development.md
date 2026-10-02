# Automated development in Ego + ScriptCat

This workflow lets an agent edit and test userscripts without asking the user
to copy code into an extension after each change. ScriptCat owns installation,
sandbox execution, real GM APIs, and iframe injection; Ego drives the user's
authenticated browser. Agent requirements live in [AGENTS.md](../AGENTS.md).

## Layout and setup

- `tools/scriptcat.mjs`: loopback bridge using ScriptCat's official VSCode protocol.
- `tests/browser/`: real browser regressions and synthetic fixtures.
- Root `package.json`: shared tooling dependency and commands.
- `tests/package.json`: existing Manebi smoke-test dependencies, kept separate.

Run commands from the repository root:

```sh
npm ci
node tools/scriptcat.mjs status
# Default: start on demand, keep this terminal open, stop with Ctrl-C afterward.
# Skip this when an existing bridge is already running.
npm run serve
```

In ScriptCat → Tools → Development Tool, set the VSCode address to
`ws://127.0.0.1:8642`, enable automatic connection, and click Connect once.
Allow user scripts in the browser's extension settings if necessary.
Only one ScriptCat instance can connect to this bridge at a time.

For browser work, read Ego's installed `ego-browser` skill and use its ownership
and task-space APIs. Reuse the authorized space; do not launch a separate
Playwright profile or assume that another space has the same login state.
Keep ScriptCat's options page open in that space for installed-source checks.

## Iteration and verification

```sh
# Push the current file once; repeat after every edit you want installed.
node tools/scriptcat.mjs sync teams-transcript-extractor.user.js
node tools/scriptcat.mjs status

# Synthetic end-to-end regression: install v1, verify source, test top document
# and cross-site iframe, then sync v2 and verify the same installation updated.
npm run test:ego -- <ego-space-id>

# Teams list-item export without navigation, another meeting's selection,
# export beside Share / Watch in browser, and actual TXT/JSON downloads.
npm run test:teams:entries -- <ego-space-id>

# Legacy SharePoint transcript iframe in the current Teams recap.
npm run test:teams -- <ego-space-id>

# Another production userscript: real Jira/linked Confluence clipboard checks,
# plus synthetic SPA, remount, same-origin/srcdoc and cross-site iframe cases.
npm run test:atlassian -- <ego-space-id>
```

Use local edit → sync → installed-source verification → document reload →
interaction → result checks. Repair failures and repeat the relevant test.
WebSocket delivery is not an installation acknowledgement. Tests compare the
installed source's SHA-256 with the repository source and then validate behavior.
The bridge deliberately has no file watcher: a local edit reaches the browser
only through an explicit sync, so half-finished files and other branches never
install themselves. Each test syncs its script once, waits until the installed
source hash matches, and removes any generated fixture from ScriptCat afterward.

The fixture checks `unsafeWindow`, real GM storage and `GM_xmlhttpRequest`,
cross-site iframe injection, and the export modal for both source revisions.
Generated scripts live in ignored `tests/browser/.generated/`. ScriptCat uses
a stable ID derived from the local file URI: keep the production userscript's
path stable and avoid installing a second copy separately.

When migrating from the former `dev/` layout, the generated fixture's file URI
changes. Remove any old Watched E2E Fixture copy from ScriptCat before running
the new fixture test; otherwise both copies inject into the fixture page. The
production userscript paths are unchanged, so their installed IDs stay stable.
If the optional login service is configured, update its script path as below.

Teams tests require an authenticated Teams page and ScriptCat options tab in
the same agent-controlled space. The entry test expects the Chinese recap UI,
at least two accessible transcripts, and one meeting with a recording. It
selects meetings dynamically, checks exact titles and complete API results,
verifies the downloaded TXT/JSON, and removes private temporary files in a
`finally` block. It leaves the recording detail page open. Run the iframe test
after the entry test, or open a recording recap first. Results report counts
and status, not meeting content. Tests do not finish the task space themselves;
the calling agent must hand it back according to Ego's skill when done.

The Atlassian regression installs and hashes the actual title-copy userscript,
copies from the authenticated Jira issue, follows a different read-only issue
link, and tests a linked Confluence page when one is available. It restores the
original Jira URL afterward and never edits business content. It also installs
a generated copy of the same source (only fixture metadata differs) through
ScriptCat for public-data SPA, remount, nested frame, srcdoc, and cross-site
tests. These synthetic cases supplement rather than replace authenticated tests.

Clipboard tests currently require macOS. `clipboard-guard.mjs` snapshots each
native pasteboard item's typed data in memory using
[NSPasteboardItem](https://developer.apple.com/documentation/appkit/nspasteboarditem),
and restores it when the child test succeeds or fails. A fresh sentinel prevents
stale clipboard content from passing. The target page must be brought to the
foreground before activating Copy: checking ScriptCat's editor can leave the
options tab active, and the Clipboard API requires the target document to have
focus. No clipboard contents or internal page identities are printed or saved.

Existing Manebi smoke tests can be run separately:

```sh
npm --prefix tests ci
npm run test:smoke
```

When adding another script or feature, extend or add a browser test under
`tests/browser/` and a root npm command. A passing Teams or synthetic fixture
test does not establish another script's behavior. Include selection isolation,
SPA transitions, permissions, frames, and download checks where relevant.

## Integration details and troubleshooting

- **Disconnected:** inspect bridge status, then ScriptCat's Development Tool
  connection and extension permissions. Do not start a second bridge when the
  existing port is occupied. The bridge pings the socket every 10 seconds and
  drops one that stops answering (sleep/wake, network change), so a reconnect
  is accepted within about 20 seconds. Check the optional service logs on macOS.
- **Sync succeeded but behavior is stale:** compare installed source first,
  then reload the actual document that owns the script, including the iframe.
  For same-URL reloads, wait for `performance.timeOrigin` to change before
  accepting selectors that could still belong to the old document.
- **Source verification fails:** ScriptCat 1.4 does not expose `window.monaco`;
  the test reads the editor's React `code` prop. Future editor versions may
  require updating this diagnostic, not bypassing the manager's installation.
- **Cross-origin iframe:** Teams iframe `src` can be unset. The iframe test
  discovers the actual target through CDP and uses a bounded child session,
  detaching it in `finally`. Reload the child through its own runtime;
  top-level Page reload commands cannot reload an out-of-process child target.
- **Teams top-page entry points:** current React props provide the meeting's
  transcript identity. Requests pin that ID and use authenticated ScriptCat
  `GM_xmlhttpRequest` across SharePoint origins. A changed internal Teams prop
  shape may require an integration update; never fall back to another meeting.
- **Trusted Types:** create DOM/SVG nodes instead of assigning HTML strings.
- **Missing browser/login/extension:** report the blocker and unrun checks;
  do not treat syntax checks or source delivery as full verification.

## Privacy and local state

The bridge listens only on loopback and accepts stable/Beta ScriptCat extension
origins. HTTP control requires a token in the private
`~/.local/state/userscripts-scriptcat/` directory. No source or token is
logged; browser-test failures redact page URLs and titles from Ego diagnostics.
This channel is for a trusted local machine, not remote access.

Do not commit tokens, browser state, real transcript downloads, tenant links,
employee identifiers, or hard-coded internal meeting names. Keep tests generic
and clean temporary exports on success and failure. Review staged changes
before a commit even if automated privacy checks pass.

## Optional macOS login service

A LaunchAgent is a macOS per-user login service. It is not required for testing:
the default is to run `npm run serve` on demand and stop it when finished. A
resident bridge only accepts the ScriptCat connection and explicit sync
requests; it does not watch files or run browser tests in the background. Use
the optional service only to avoid reconnecting ScriptCat each session.

A local LaunchAgent can keep the bridge running without an open terminal. Its
`ProgramArguments` must use the absolute Node executable and the repository's
`tools/scriptcat.mjs` path, followed by `serve`; use the repository as its
working directory. Keep the machine-specific plist and paths out of Git.

The existing local service is `com.cheerchen.userscripts-scriptcat`, configured
at `~/Library/LaunchAgents/com.cheerchen.userscripts-scriptcat.plist`. Logs are
`service.log` and `service-error.log` in the private state directory. After
changing the script path, reload the service:

```sh
launchctl bootout gui/$(id -u)/com.cheerchen.userscripts-scriptcat
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.cheerchen.userscripts-scriptcat.plist"
node tools/scriptcat.mjs status
```

On machines without this service, use `npm run serve` in a dedicated terminal.
To switch an existing machine back to on-demand operation, boot out the
service and move its plist outside `~/Library/LaunchAgents/` so it will not
start at the next login. Change that startup preference only when requested.

## Official references

- [ScriptCat development workflow](https://docs.scriptcat.org/docs/use/vscode/)
- [VSCode connection E2E test](https://github.com/scriptscat/scriptcat/blob/v1.4.0/e2e/vscode-connect.spec.ts)
- [Protocol receiver](https://github.com/scriptscat/scriptcat/blob/v1.4.0/src/app/service/offscreen/vscode-connect.ts)
- ScriptCat Beta 1.5 has a separate [sctl CLI/MCP channel](https://docs.scriptcat.org/docs/use/external-access/);
  it is not needed for this stable-version bridge.
