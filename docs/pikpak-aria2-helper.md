# PikPak Aria2 Helper

## Usage

1. Select files or folders in PikPak's own list or grid.
2. Open **aria2 settings** in the top-right gear menu or userscript-manager
   menu. Set the RPC URL/token and optional download directory
   and options. Test the connection and save. The download directory is on the
   aria2 machine, not necessarily the browser machine.
3. Choose **Send to aria2** in the right-click menu or selected-items toolbar.
   No second file picker opens. Sending two or more selected items asks for one
   confirmation (with the folder count) first; Cancel submits nothing. A
   non-blocking panel shows submission counts, failures, Stop, and Retry unsent
   items, with a success, warning (stopped/unconfirmed), or error icon.
   "Submitted" means aria2 accepted the task, not that the download finished.

The selected-items toolbar shows only a send icon (paper plane) as its first
entry; settings are not mixed into file operations. The context menu has a
separate leading aria2 group with the same hover treatment as native items, and
choosing it closes the menu like a native item while keeping the selection.
Settings open in a modal using PikPak's two-column settings layout, centering,
input/button sizes, and theme tokens, with focus containment, Escape/backdrop
close, and labelled inputs.

Successful connection testing is bound to the saved RPC address and token.
Changing either invalidates validation. Before submitting a batch (or retry),
the helper also checks `aria2.getVersion` again. Missing/invalid configuration,
an untested connection, or an unavailable RPC refuses all submissions and shows
a PikPak-style notice explaining why. Settings open only from its **Open
settings** button, carrying the reason; Cancel/Escape just dismisses it. Saving
settings never automatically starts the refused batch. Select/send again after
testing and saving. Legacy settings from earlier versions must be tested once
under this validation flow.

Right-clicking an unselected item uses PikPak's updated selection; right-clicking
an already selected item preserves the native multi-selection. Each click takes
an immutable snapshot, so later selection changes do not change an active batch.
Only one batch runs at a time.

Folders are fully scanned before submission, including pagination. Nested paths
are preserved even without a configured base directory. Overlapping selected
files/folders are deduplicated by ID. If a folder scan fails, no partial directory
batch is submitted; retry rescans it. Unsupported pages or unavailable native
selection state fail closed rather than sending the entire visible directory.

Stop prevents additional submissions, but cannot remove tasks already accepted
by aria2. A timeout, interrupted RPC, or invalid acknowledgement may mean a task
was accepted: these items are marked **unconfirmed** and are not retried. Check
aria2 before sending them again. Retry submits only pending/definitively failed
items and reads current settings, allowing a rejected RPC configuration to be
corrected without resending successful items.

Extra options use `key=value;key=value`. Values may contain `=`. `out` and `dir`
are managed by the script to preserve filenames and paths. Unsafe filename
characters are replaced for cross-platform compatibility. RPC settings live in
userscript-manager storage; legacy settings are copied on first use. Credentials
and signed links are never written to console logs.

Version history is in the [changelog](../CHANGELOG.md#pikpak-aria2-helper).

Run `npm run test:pikpak -- <ego-space-id>` with PikPak and ScriptCat options
open in the authorized space. Tests do not contact a real aria2 service or
download files. See [the development manual](userscript-development.md).
