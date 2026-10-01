# Userscripts

Personal userscripts for improving practical web workflows.

## Featured Script

**PikPak Aria2 Helper**

Push files and folders from PikPak to Aria2 for downloading.

- Source: [pikpak-aria2-helper.user.js](./pikpak-aria2-helper.user.js)
- Install: [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/pikpak-aria2-helper.user.js)

## Script Index

### Work

| Script | Description | Sites | Install |
| --- | --- | --- | --- |
| RecoRu Work Clock | Show scheduled end time, working/labor time, and an analog clock on RecoRu. Auto-select workplace when accessed from office IPs. | RecoRu | [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/recoru-work-clock.user.js) |
| AWS - Default Page Redirector | Redirect AWS service dashboards to your preferred default page. | AWS Console | [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/aws-default-page.user.js) |
| Confluence Jira Title Copy | Copy page title and link, or copy as filename. | Confluence / Jira | [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/confluence-jira-title-copy.user.js) |
| Manebi Learning Helper | Remove video playback restrictions and automatically browse unfinished PDF lessons on manebi-learning.com. | Manebi Learning | [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/manebi-learning-helper.user.js) |
| Zoom Recording CC Extractor | Extract closed captions (VTT) from Zoom cloud recording playback pages. | Zoom Recording | [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/zoom-recording-cc-extractor.user.js) |
| Teams Transcript Extractor | Export full transcripts from the Teams recap list, the recap toolbar, or SharePoint Stream. | Teams / SharePoint Stream | [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/teams-transcript-extractor.user.js) |

### Personal

| Script | Description | Sites | Install |
| --- | --- | --- | --- |
| PikPak Aria2 Helper | Push PikPak files and folders to Aria2 for downloading. | PikPak | [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/pikpak-aria2-helper.user.js) |
| PikPak Batch Renamer Assistant | Batch rename video files and folders in PikPak. | PikPak | [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/pikpak-batch-renamer.user.js) |
| Emby Show Fields Persistence Fix | Prevent Emby from resetting show fields when switching views. | Emby | [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/emby-fields-persistence-fix.user.js) |
| ChatGPT Conversation Depth | Show conversation depth badges in the ChatGPT sidebar. | ChatGPT | [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/chatgpt-conversation-depth.user.js) |
| Line Sticker Downloader | Download stickers from LINE Store pages. | LINE Store | [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/line-sticker-downloader.user.js) |
| Tripo3D Model Downloader (Lite) | Passively capture and download model (GLB/GLTF) URLs on Tripo3D Studio. | Tripo3D Studio | [Install](https://raw.githubusercontent.com/CheerChen/userscripts/master/tripo3d-model-downloader-lite.user.js) |

## Installation

Recommended userscript managers:

- Tampermonkey
- Violentmonkey
- Greasemonkey

How to install:

1. Install a userscript manager extension.
2. Click any `Install` link in the table above.
3. Confirm installation in your userscript manager.

## Automated development in Ego + ScriptCat

Local changes can be tested without copying code into a userscript manager.
The development bridge implements ScriptCat's official VSCode WebSocket protocol;
ScriptCat itself installs and executes the scripts, including real GM APIs and
cross-origin iframe injection. Ego drives and checks the browser.

```sh
npm --prefix dev ci
npm --prefix dev run serve
```

In ScriptCat → Tools → Development Tool, set the VSCode address to
`ws://127.0.0.1:8642`, enable automatic connection, and click Connect once.
Allow user scripts in the browser's extension settings if necessary.
Only one ScriptCat instance can connect to this bridge at a time.

```sh
# Synchronize this file now and automatically on subsequent local edits.
node dev/scriptcat.mjs sync teams-transcript-extractor.user.js --watch
node dev/scriptcat.mjs status

# Full browser regression: install v1, verify exact source, change the local
# generated file to v2, wait for automatic sync, reload and test both versions.
npm --prefix dev run test:ego -- <ego-space-id>

# Synchronize the actual Teams script, verify its installed source, reload
# the current recap's transcript iframe, click Export and check the API modal.
npm --prefix dev run test:teams -- <ego-space-id>

# Test list-item export without navigation, a second meeting's selection,
# and the export button next to Share / Watch in browser.
npm --prefix dev run test:teams:entries -- <ego-space-id>

node dev/scriptcat.mjs unwatch teams-transcript-extractor.user.js
```

The fixture checks the top document and a cross-site iframe, `unsafeWindow`, GM
storage, a real `GM_xmlhttpRequest`, and the export modal. The Teams test requires
an open meeting recap and ScriptCat options tab in the same agent-controlled Ego
space. It reports counts only, without writing meeting text into the repository.
The entry test navigates through the Chinese Teams recap list and detail toolbar,
checks exact meeting titles and complete API results, and leaves the recording's
detail page open. It also downloads TXT and JSON, checks their contents, and
removes the private temporary files. Items with no accessible transcript have no
export button.
Source verification
reads the ScriptCat 1.4 editor's React `code` prop, so a future editor change may
require adjusting that diagnostic.

Teams entry buttons read the selected meeting's current React props, pin its
transcript ID, and make authenticated cross-origin requests using ScriptCat's
`GM_xmlhttpRequest`. They do not need a dedicated recording URL or iframe access.
If Teams changes its internal recap props, the entry integration may need updating.

WebSocket delivery is not an installation acknowledgement. The browser tests
verify the installed source's SHA-256 and the resulting behavior. Watching alone
syncs code; run the browser test to reload and validate it. Test artifacts are
generated under ignored `dev/.generated/`. ScriptCat uses a stable ID derived
from the local file URI, so updates to the same file replace that development
script. Avoid installing a second copy of the same production script separately.

The bridge listens only on loopback. It accepts the stable/Beta ScriptCat
extension origins; local HTTP control requires a token stored in the private
`~/.local/state/userscripts-scriptcat/` directory. Watched paths persist there,
and are resent after ScriptCat reconnects. No source or token is logged. This
development channel is intended for a trusted local machine, not remote access.

On CheerChen's Mac the bridge is installed as the login service
`com.cheerchen.userscripts-scriptcat`, so a terminal does not need to stay open.
Its configuration is `~/Library/LaunchAgents/com.cheerchen.userscripts-scriptcat.plist`.
To stop it:

```sh
launchctl bootout gui/$(id -u)/com.cheerchen.userscripts-scriptcat
```

Official references: [ScriptCat's development workflow](https://docs.scriptcat.org/docs/use/vscode/),
[VSCode connection E2E test](https://github.com/scriptscat/scriptcat/blob/v1.4.0/e2e/vscode-connect.spec.ts),
[protocol receiver](https://github.com/scriptscat/scriptcat/blob/v1.4.0/src/app/service/offscreen/vscode-connect.ts).
ScriptCat Beta 1.5 also offers the separate [sctl CLI/MCP channel](https://docs.scriptcat.org/docs/use/external-access/);
it is not required for this stable-version development bridge.

## Feedback and Support

- Issues: [GitHub Issues](https://github.com/CheerChen/userscripts/issues)

If these scripts are useful to you, consider starring the repository.
