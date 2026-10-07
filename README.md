# PR EM Helper

Personal Chrome extension (Manifest V3) for the triage of new submissions to
*Pattern Recognition* in Elsevier Editorial Manager. Read-only toward EM; all
data stays in `chrome.storage.local`. See `CLAUDE.md` for the full brief and
`docs/em-structure.md` for the EM page structure.

## Install (unpacked)
1. chrome://extensions → enable Developer mode → **Load unpacked** → select this folder.
2. Run `scripts/stamp.sh` once (creates `dev-stamp.txt`, used by hot reload).
3. Extension popup → tick **Dev mode** to enable hot reload (`scripts/stamp.sh` reloads the extension and EM tabs).

## Extension ID and data
`manifest.json` contains a public `key`, so the extension ID is always
`fbkicjijhemocomjpliolhjlmfmeaplc`, wherever the folder is. Notes live in
`chrome.storage.local` of that ID: moving the folder keeps them, but
**removing** the extension from chrome://extensions deletes them. Export a
JSON backup from the popup first.

## Tests
- `node --test test/*.test.js` — parser tests, no dependencies. The DOM tests
  run only if Playwright can be loaded: `NODE_PATH="$(npm root -g)" node --test test/*.test.js`.
- `NODE_PATH="$(npm root -g)" node test/e2e/smoke.mjs` — loads the extension in
  Chromium against synthetic fixtures (no request reaches EM).
