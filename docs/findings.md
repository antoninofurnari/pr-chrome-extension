# M0 findings

**M0 closed on 2026-10-07**: all spikes pass on the live site. The spike
panel (`src/content/spikes.js`) was removed afterwards; it is in the git
history (commit 52d6057) if a spike needs re-running.

Status of the Milestone 0 spikes (CLAUDE.md). "Local" = verified with
`test/e2e/smoke.mjs` (unpacked extension in Chromium, EM replaced by the
synthetic fixtures in `test/fixtures/`). "Live" = must be confirmed by
Antonino on the real site with the spike panel (popup → Dev mode → "PREH · M0
spikes" in the bottom-right corner of EM → "Copy log").

| # | Spike | Local | Live |
|---|---|---|---|
| 1 | Extension loads; hot reload | Stamp change detected in ~1.5 s, `chrome.runtime.reload()` called. Chrome serves the updated `dev-stamp.txt` without caching. Tab reload not verifiable under Playwright (see below). | **OK** (2026-10-07): loads, hot reload works end to end with Load unpacked. |
| 2 | Iframe of `DuplicateSubmissionCheckResults.aspx` from the top window | Renders, same-origin, table readable from the parent. GET + DOMParser summary works. | **OK**, renders. Slow: ~15 s for a page with several hundred candidates. EM repeats candidate rows: count distinct manuscripts (see below). |
| 3 | Iframe of `CrossCheckResults.aspx` → Turnitin | Not testable locally: Playwright does not intercept the redirect target inside an iframe (the "cross-origin" frame seen in M0 was Chrome's error page). The test now checks the CrossCheckResults URL instead. | **OK: Turnitin renders inside the iframe.** The left-half popup fallback also works but is not needed. |
| 4 | Iframe of `ViewEvaluateManuscript.aspx` incl. inner `mfe-ux` iframe | Wrapper renders, `#iframe_msa` found. | **OK**, inner `mfe-ux` panel renders. |
| 5 | Open Assign Editor from an extension button | **Click dispatch does not work** (see below). MAIN-world bridge calls `editorAssignment(...)` correctly. | 5a: nothing opens (as expected). **5b: works** (opens in a new tab, same as EM's own link). |

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
- Second live run (same manuscript): iframe 325 rows, GET 476 rows, both
  **238 distinct** manuscript numbers, no nested tables, no hidden rows. So EM
  repeats candidate rows a varying number of times per request (387 / 476 /
  325 across three loads). Maxima are unaffected; `summarizeDuplicates()` now
  counts and flags distinct manuscripts.
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
- Live: 5a opens nothing; 5b opens EM's Assign Editor page in a new tab, which
  is also what EM's own link does on Antonino's Chrome. Nothing to fix.

### Evaluate Manuscript warning icon
Still unknown (docs/em-structure.md §2). `detectEvaluateWarning()` reports any
`img`/`svg`/`i` next to the Evaluate link; the spike panel logs `evalIcon=` per
row and prints the icon markup to the DevTools console only (not to the log).
When a flagged manuscript appears, copy that markup (sanitized) into
`docs/em-structure.md`.

### Turnitin viewer inside the cockpit
The sources sidebar of the Turnitin viewer collapses by clicking the active
"Overall Similarity" item in its right rail (Turnitin's own UI). The extension
can't style Turnitin (different origin, no host permission), and doesn't need to.
