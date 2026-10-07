# M0 findings

Status of the Milestone 0 spikes (CLAUDE.md). "Local" = verified with
`test/e2e/smoke.mjs` (unpacked extension in Chromium, EM replaced by the
synthetic fixtures in `test/fixtures/`). "Live" = must be confirmed by
Antonino on the real site with the spike panel (popup → Dev mode → "PREH · M0
spikes" in the bottom-right corner of EM → "Copy log").

| # | Spike | Local | Live |
|---|---|---|---|
| 1 | Extension loads; hot reload | Stamp change detected in ~1.5 s, `chrome.runtime.reload()` called. Chrome serves the updated `dev-stamp.txt` without caching. Tab reload not verifiable under Playwright (see below). | **OK** (2026-10-07): loads, hot reload works end to end with Load unpacked. |
| 2 | Iframe of `DuplicateSubmissionCheckResults.aspx` from the top window | Renders, same-origin, table readable from the parent. GET + DOMParser summary works. | **OK**, renders. Slow: ~15 s for a page with several hundred candidates. GET and iframe gave different row counts (387 vs 476): see below. |
| 3 | Iframe of `CrossCheckResults.aspx` → Turnitin | Redirect is followed inside the iframe (fake Turnitin page renders). | **OK: Turnitin renders inside the iframe.** The left-half popup fallback also works but is not needed. |
| 4 | Iframe of `ViewEvaluateManuscript.aspx` incl. inner `mfe-ux` iframe | Wrapper renders, `#iframe_msa` found. | **OK**, inner `mfe-ux` panel renders. |
| 5 | Open Assign Editor from an extension button | **Click dispatch does not work** (see below). MAIN-world bridge calls `editorAssignment(...)` correctly. | 5a: nothing opens (as expected). **5b: works**, but EM's page opens in a new tab instead of a popup window (see below). |

## Details

### 1. Hot reload
- Content scripts cannot `fetch()` extension files that are not web-accessible,
  so the build stamp shown in the panel is read through the service worker
  (`preh:stamp` message).
- Under Playwright the extension is loaded with `--load-extension`; after
  `chrome.runtime.reload()` Chromium does not bring it back, so the
  "reload EM tabs on next start" half could not be tested here. With
  chrome://extensions → "Load unpacked" this is the standard reload path.
  Live (Load unpacked): running `scripts/stamp.sh` reloads the extension and
  the EM tab. No `commands` fallback needed.
- `dev-stamp.txt` is git-ignored. After a `git pull`, run `scripts/stamp.sh`
  (or reload the extension by hand).

### 2. Duplicate Submission Check
- First live run on one manuscript: the GET copy parsed 387 candidate rows,
  the rendered iframe 476. The parser then took every `tr` with ≥ 9 cells,
  including rows of nested tables. It now only takes the table's direct rows
  that carry a `span[id$="_SubPubNumberValue"]`.
- The spike logs `duplicatePageStats()` (counts only) for both copies, to tell
  whether the two copies differ (EM scripts or server) or it was only nested
  rows. Re-run spike 2 on the same manuscript and compare the two lines.
- Load time ~15 s: the cockpit should start the GET as soon as it opens and
  show the summary badge while the iframe is still loading.

### 5. Assign Editor
- `a.click()` from a content script on a `javascript:` link does nothing:
  Chrome does not execute `javascript:` URLs for navigations started from an
  extension's isolated world. The same click from the page's MAIN world works.
- So the cockpit will use `src/content/main-world.js`: the isolated world sends
  `{type:'preh:editorAssignment', args}` via `window.postMessage`, the MAIN
  world validates the 7 arguments (parsed from the row's `a.assignEditor` href)
  and calls `window.editorAssignment(...)` in the top window, which only opens
  EM's popup.
- Live: 5a opens nothing; 5b opens EM's Assign Editor page, but **in a new tab**,
  not in a popup window. Open question: does EM's own "Assign Editor" link
  open a tab too on Antonino's Chrome? If yes, nothing to fix. If not, the
  difference comes from calling it through the bridge (e.g. the window
  features computed by `openCenterWinPct` from the top window).

### Evaluate Manuscript warning icon
Still unknown (docs/em-structure.md §2). `detectEvaluateWarning()` reports any
`img`/`svg`/`i` next to the Evaluate link; the spike panel logs `evalIcon=` per
row and prints the icon markup to the DevTools console only (not to the log).
When a flagged manuscript appears, copy that markup (sanitized) into
`docs/em-structure.md`.
