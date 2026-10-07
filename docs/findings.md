# M0 findings

Status of the Milestone 0 spikes (CLAUDE.md). "Local" = verified with
`test/e2e/smoke.mjs` (unpacked extension in Chromium, EM replaced by the
synthetic fixtures in `test/fixtures/`). "Live" = must be confirmed by
Antonino on the real site with the spike panel (popup → Dev mode → "PREH · M0
spikes" in the bottom-right corner of EM → "Copy log").

| # | Spike | Local | Live |
|---|---|---|---|
| 1 | Extension loads; hot reload | Stamp change detected in ~1.5 s, `chrome.runtime.reload()` called. Chrome serves the updated `dev-stamp.txt` without caching. Tab reload not verifiable under Playwright (see below). | _to test_ |
| 2 | Iframe of `DuplicateSubmissionCheckResults.aspx` from the top window | Renders, same-origin, table readable from the parent. GET + DOMParser summary works. | _to test_ |
| 3 | Iframe of `CrossCheckResults.aspx` → Turnitin | Redirect is followed inside the iframe (fake Turnitin page renders). Whether real Turnitin allows framing is unknown. | _to test_ |
| 4 | Iframe of `ViewEvaluateManuscript.aspx` incl. inner `mfe-ux` iframe | Wrapper renders, `#iframe_msa` found. Inner render unknown. | _to test_ |
| 5 | Open Assign Editor from an extension button | **Click dispatch does not work** (see below). MAIN-world bridge calls `editorAssignment(...)` correctly. | _to test (5b)_ |

## Details

### 1. Hot reload
- Content scripts cannot `fetch()` extension files that are not web-accessible,
  so the build stamp shown in the panel is read through the service worker
  (`preh:stamp` message).
- Under Playwright the extension is loaded with `--load-extension`; after
  `chrome.runtime.reload()` Chromium does not bring it back, so the
  "reload EM tabs on next start" half could not be tested here. With
  chrome://extensions → "Load unpacked" this is the standard reload path.
  **Live check:** with Dev mode on and an EM tab open, run `scripts/stamp.sh`:
  within ~2 s the tab should reload and the panel should show the new stamp.
  If it doesn't, fall back to a `commands` shortcut (CLAUDE.md).
- `dev-stamp.txt` is git-ignored. After a `git pull`, run `scripts/stamp.sh`
  (or reload the extension by hand).

### 5. Assign Editor
- `a.click()` from a content script on a `javascript:` link does nothing:
  Chrome does not execute `javascript:` URLs for navigations started from an
  extension's isolated world. The same click from the page's MAIN world works.
- So the cockpit will use `src/content/main-world.js`: the isolated world sends
  `{type:'preh:editorAssignment', args}` via `window.postMessage`, the MAIN
  world validates the 7 arguments (parsed from the row's `a.assignEditor` href)
  and calls `window.editorAssignment(...)` in the top window, which only opens
  EM's popup.
- **Live check:** the popup must open (popup blocker: the call happens inside
  the button's click handler, so user activation should still be valid).
  Close it without confirming anything.

### Evaluate Manuscript warning icon
Still unknown (docs/em-structure.md §2). `detectEvaluateWarning()` reports any
`img`/`svg`/`i` next to the Evaluate link; the spike panel logs `evalIcon=` per
row and prints the icon markup to the DevTools console only (not to the log).
When a flagged manuscript appears, copy that markup (sanitized) into
`docs/em-structure.md`.
