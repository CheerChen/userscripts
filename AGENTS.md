# Repository instructions

## Userscript development

- Before changing userscript behavior or browser automation, read
  `docs/userscript-development.md`. Use Ego's authenticated browser and ScriptCat
  as the default execution path; do not ask the user to repeatedly paste code
  into their userscript manager.
- Inspect `node tools/scriptcat.mjs status` before starting a bridge. Reuse the
  running service when connected; do not start competing servers or install a
  duplicate copy of the same script.
- Iterate through local edit → ScriptCat sync → installed-source SHA-256 check
  → real document reload → browser interaction → result verification. WebSocket
  delivery is not an installation acknowledgement, and watching is not a test.
- Add or extend repeatable browser regression coverage for changed features.
  Test the real userscript-manager sandbox and GM APIs rather than injecting
  source into the page as a substitute for installation.
- Check target identity and complete results, not just button visibility. For
  export features, validate actual downloaded files and remove temporary data.
  Test cross-origin frames and SPA navigation when relevant to the change.
- Use only the authorized Ego task space. Read Ego's installed browser skill
  before operating it, follow its ownership rules, and hand back necessary
  result pages when done. Never hard-code a user's space ID or profile.
- If the browser, authentication, or extension is unavailable, report the exact
  blocker and which checks remain unrun. Do not claim browser verification from
  syntax checks or a successful sync alone.

## Commands and layout

- `npm ci`: install the bridge dependency at the repository root.
- `npm run test:ego -- <space-id>`: bridge, watcher, source hash, real GM APIs,
  cross-site iframe, and modal fixture regression.
- `npm run test:teams:entries -- <space-id>`: Teams recap list, meeting selection,
  detail toolbar, and actual TXT/JSON downloads (Chinese Teams UI).
- `npm run test:teams -- <space-id>`: existing Teams recap transcript iframe.
- `npm --prefix tests ci` then `npm run test:smoke`: existing Manebi smoke tests.
  These do not replace browser tests for other scripts.
- Keep runnable bridge utilities in `tools/`, browser tests and fixtures in
  `tests/browser/`, and detailed instructions in `docs/`. Root README should
  link to the manual rather than duplicate it.

## Privacy and delivery

- Never commit credentials, cookies, control tokens, internal tenant URLs,
  meeting titles/text, employee identifiers, or browser dumps. Choose test
  meetings dynamically, without company-specific title fragments.
- Keep generated fixture scripts in ignored `tests/browser/.generated/`.
  Validate real exports only in private temporary directories and clean them
  up even on test failure. Test output should contain status/counts, not content.
- Before committing, inspect the exact staged files and diff for confidential
  identifiers and secret patterns; keep generated files and local service
  configuration out of the commit. Preserve unrelated user changes.
- Update relevant documentation and version/changelog for user-visible changes.
  Commit or push only when requested; report tests performed and remaining gaps.
