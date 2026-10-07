# PR EM Helper — Chrome extension for triage in Elsevier Editorial Manager

## What this is

A personal, unpublished Chrome extension (Manifest V3) for Antonino Furnari, Associate Editor in Chief (AEiC) of the journal **Pattern Recognition**. It makes the triage of new submissions in Elsevier **Editorial Manager (EM)** at `https://www.editorialmanager.com/pr/` faster and less error-prone.

EM is an old ASP.NET WebForms app: every check lives in a different popup, and nothing remembers where Antonino left off. The extension adds three things on top of EM:

1. **Notes and status per manuscript**, shown directly on EM's folder lists and kept across sessions.
2. **A triage cockpit**: one click on a manuscript opens a full-screen view inside EM with the relevant pages side by side (similarity report and PDF on the left, Duplicate Submission Check, Author Status and Evaluate Manuscript stacked on the right).
3. **The triage checklist** (5 steps, below) next to the panels, with ticks saved per manuscript and a "to send back" notes box, plus buttons that open EM's own Assign Editor and Decision pages.

The technical structure of every EM page involved is documented in `docs/em-structure.md`. **Read it before touching any selector.** It was obtained by inspecting the live site on 2026-10-07 and is sanitized: it contains no manuscript data.

## Hard rules (non-negotiable)

- **Read-only toward EM.** The extension must never submit, save or post anything to EM, and never trigger a state-changing action by itself. It may only open EM pages (navigation, popups, iframes) and do same-origin **GET** requests to read pages. State-changing elements are marked ⚠ in `docs/em-structure.md` (Unassign Editor, Save/Proceed/sendDefaults/sendCustom buttons, Ignore Score checkbox, email Save links, ChangeVerificationLink…). Never click them programmatically.
  - Buttons like "Assign Editor" or "Decision" only **open** the corresponding EM page. Antonino does the rest himself.
- **No data leaves the browser.** No external network calls, no analytics, no CDNs, no remote fonts, no AI calls. All notes and checklist state stay in `chrome.storage.local`. Manuscript content is confidential under Antonino's editor contract.
- **No real data in the repository.** No manuscript numbers, titles, author names, emails, PDFs or screenshots of real pages. Test fixtures must be synthetic or sanitized (`<MS>`, `<TITLE>`, `<NAME>` placeholders as in `docs/em-structure.md`).
- **Minimal permissions.** Host permission only for `https://www.editorialmanager.com/pr/*`. Add a permission only when a feature needs it, and say why in the commit message.
- **Keep it simple.** Vanilla JavaScript (ES modules where possible), plain CSS, **no build step and no framework**. This keeps the hot-reload loop trivial and the code easy to audit.

## Key facts about EM (summary of `docs/em-structure.md`)

- The top document is always `/pr/default2.aspx`. All navigation happens inside **`iframe#content`** (same origin). Popups (Similarity, Duplicate, Details, Author Status, Assign Editor) are separate windows opened by `window.open` through helpers like `openCenterWin(...)` and `popupDetailsWindow(...)`.
  - Content scripts need `all_frames: true` and must work both in the top window and in `iframe#content`.
- **Embedding:** every EM page sends `Content-Security-Policy: frame-ancestors 'self' https://*.editorialmanager.com ...` and no X-Frame-Options.
  - EM pages **can** be iframed by another EM page, so the cockpit must be an overlay injected into the EM page itself (top window, `default2.aspx`).
  - EM pages **cannot** be iframed by a `chrome-extension://` page, so no separate extension tab with iframes.
- **Folder list (e.g. New Assignments, `/pr/NewAssignments.aspx`):** frozen grid with two `table#datatable` (duplicate ids).
  - `[0]` holds the action rows `tr#fr<n>`, `[1]` the data rows `tr#nfr<n>`. Pair them by `data-rowindex`. `data-identity` is the **docId**.
  - Manuscript number = text of `tr#nfr<n> > td:nth-child(1)` (format `PR-D-YY-NNNNN`).
  - The action cell `div.al-menu > div.al-expanded` contains `<a>` links with `javascript:` hrefs. Parse their arguments as strings; no need to hook `window.open`:
    - Similarity: `openCenterWin('DotNetPopUps/SimilarityCheckResults.aspx?docID=<docId>&msid=<msid>', …)` plus a sibling `span` "(N%)".
    - Duplicate: `openCenterWin('DuplicateSubmissionCheckResults.aspx?docID=<docId>', …)` plus a sibling `span.warning[title="EM Duplicate Score"]` "(N%)".
    - Details: `popupDetailsWindow(<docId>, '<MS>', '<sectionID>')` → `EMDetails.aspx?docid=&ms_num=&sectionID=`
    - Evaluate Manuscript: plain href `ViewEvaluateManuscript.aspx?displayName=&docId=`. The page wraps an external iframe (`mfe-ux.triage.elsevier.com`).
    - Assign Editor: `a.assignEditor` → `editorAssignment(<docId>, …)` → popup `selectEditor2.aspx?...`
    - Decision: plain href `EditorDecision.aspx?docid=&msid=&CurrentRow=&CurrentPage=` (same frame)
    - Possible-duplicate icon in the data row: `img[src$="dupdoc.gif"]`.
  - **Unknown:** the markup of the Evaluate Manuscript warning icon. No flagged manuscript was available when inspecting. Detect it defensively (any `img`/icon element adjacent to the Evaluate link), log what you find, and update the docs when one appears.
- **Main Menu folders** are web components `aries-folder-item` (open shadow DOM). The target URL is in the `nvgurl` attribute; counts are in `green`/`orange`/`red`.
- **Similarity "Completed" report** → `../CrossCheckResults.aspx?docID=&msid=&APISubmissionID=` → **302 to `https://elsevier.turnitin.com/viewer/submissions/...`** (external). Whether Turnitin allows being framed is **unknown**: test in Milestone 0. Fallback: open it as a positioned popup window on the left half of the screen.
  - The `APISubmissionID` comes from the Similarity popup: `a#gridResults_ctl02_lnkReportStatus` → `openV2ReportWindow(docID, msid, APISubmissionID)`.
- **Duplicate Submission Check page:** `table#gridResults.datatable`, one row per candidate (can be 200+). Similarity cells contain `<N>%`. High values are `span.redtextBold` with a red bar.
- **Author Status:** reached from the Details page link `ViewOtherAuthorStatusPopUp('ContributingAuthorStatus.aspx?docID=&msid=&revision=')`. Tables: `table#CorrAuthorGridView` and `table#OtherAuthorsGridView`.
- jQuery 1.12.4 is on the page. **Don't rely on it** from content scripts, which run in an isolated world. If page functions must be called (e.g. `editorAssignment`), use a small script with `"world": "MAIN"` and communicate via `window.postMessage`, or simply dispatch a real click on EM's own link.

## The triage workflow the UI must support

Antonino's operative workflow, in order. The checklist in the cockpit mirrors it exactly. Item texts can be shortened, but keep the order and the outcomes.

**Step 0 — Before opening** (on the list):
- Is it a revision (number ends with R1, R2…)? → reassign to the previous AE, no triage.
- Conflict of interest: is Antonino, a recent co-author, a colleague from Catania or an AE of his team among the authors? → if Antonino himself: don't open it; otherwise return it to the EiC.

**Step 1 — Similarity Check Results → "Completed"** (Turnitin view with overlap + full PDF; left panel):
- Overlap: isolated phrases, common terminology and the authors' own preprint are fine. Long blocks, mosaic patterns, or overlap in methods/results from others → Reject (ethics).
- In scope and correct article type → otherwise Reject and offer transfer.
- Looks like a scientific article (sensible abstract, English, sections, plausible length) → otherwise Reject without transfer.
- Skim the PDF (~15 min, not a review): experimental setup, results shown, figures not duplicated, no leftover AI prompts, no systematic tortured phrases, no evident citation stacking.
- Final sections present: CRediT, declaration of competing interests, generative-AI disclosure (if used), ethics statement (only for data on people). Missing → note for send back.

**Step 2 — Duplicate Submission Check:**
- OK if EM Duplicate Score ≤ 50% **and** no row with Article Title or Abstract Similarity > 70%.
- Otherwise open Details of the old manuscript → Editors section:
  - "Reject - invitation to resubmit" by a Managing Editor with no reviewers → legitimate resubmission;
  - same paper not revised, or still under review → Reject (ethics).

**Step 3 — Details → Author Status:**
- Names and order match the PDF; emails plausible for the names; affiliations consistent with the topic.
- Each author has at least one substantial contribution role (not only "Writing – review & editing") → otherwise note for send back. "Confirmed? No Response" is not a problem.

**Step 4 — Evaluate Manuscript:** only if the warning icon is present.
- Same paper at another Elsevier journal with the same authors → Reject (ethics).
- Different authors → report to the Publisher.

**Step 5 — Decide:** Reject (Potential ethics concern) / Reject and offer transfer / Send back to author (with the noted items; for now via the Managing Editor) / Assign Editor.

## Features and UX

### F1. Notes and status on folder lists
- On every EM folder list using the frozen grid (start with `NewAssignments.aspx`; make the selector logic generic), inject a small badge into each data row: a status chip and a note icon.
- Click → inline popover with:
  - **status**: `—`, `In triage`, `Waiting (reply)`, `Send back requested`, `Ready to assign`, `Done`;
  - **free-text note**, autosaved;
  - **last-updated date**.
- Storage key: manuscript number (stable across folders). Value: `{status, note, updatedAt, checklist: {...}, sendBackNotes}`.
- A "Waiting" status shows the age in days ("Waiting · 4d").
- Main Menu (optional, later): a small floating panel listing manuscripts with status `Waiting` or `In triage`.

### F2. Triage cockpit
- A "Triage" button on each row (next to the badge) opens a full-viewport overlay in the **top window**:
  - header bar with MS number, status selector, close button (Esc);
  - **left ~55%**: Similarity report.
    - Load `DotNetPopUps/SimilarityCheckResults.aspx?...` in an iframe, find the "Completed" link, extract `APISubmissionID` and load `CrossCheckResults.aspx?...` in the same iframe.
    - If Turnitin refuses framing, show a button "Open report (left half)" that opens a popup sized and positioned on the left half.
  - **right ~45%**: vertically stacked, individually scrollable, collapsible panels:
    1. **Duplicate Submission Check.** iframe of `DuplicateSubmissionCheckResults.aspx?docID=…`, plus a computed summary badge on the panel header: EM Duplicate Score, max title similarity, max abstract similarity, green/red against the 50% / 70% thresholds. Compute it with a same-origin GET + DOMParser.
    2. **Author Status.** Fetch `EMDetails.aspx?...` (GET), extract the `ContributingAuthorStatus.aspx?...` URL, show it in an iframe. Optionally add a compact summary of roles per author, with a warning when an author has only "Writing – review & editing".
    3. **Evaluate Manuscript.** Collapsed by default. Header shows "warning: yes/no/unknown". Expanding loads `ViewEvaluateManuscript.aspx?...` in an iframe.
  - **Checklist drawer** (right side or bottom): the 5 steps above as checkboxes, saved per manuscript, plus a "Send back notes" textarea and a "Copy" button.
  - **Footer buttons:**
    - "Open Assign Editor" opens EM's own assignment popup by dispatching a click on the row's `a.assignEditor`, or calling `editorAssignment` from the MAIN world.
    - "Open Decision page" navigates `iframe#content` to `EditorDecision.aspx?...` and closes the overlay.
    - These only open pages, they never confirm anything.
- Closing the cockpit returns to the list exactly as it was.

### F3. Export/import
- A button in the extension popup to export all notes/checklists as JSON (local download) and re-import them. This is the backup, since there is no sync.

## Architecture

```
manifest.json            MV3; content scripts on https://www.editorialmanager.com/pr/*, all_frames: true
src/
  content/
    router.js            detects which EM page/frame we are in, dispatches to the right module
    list.js              F1: badges + popover on frozen-grid folder lists
    cockpit.js           F2: overlay (top window only), panels, checklist
    em-parse.js          pure functions: parse action-cell hrefs, duplicate table, author table (unit-testable)
    main-world.js        tiny MAIN-world bridge, only if needed for editorAssignment
    styles.css           all UI styles, namespaced (prefix .preh-), never style EM's own elements
  background/
    service-worker.js    storage helpers if needed; dev hot-reload watcher
  popup/                 export/import, dev toggle
  storage.js             wrapper around chrome.storage.local
docs/
  em-structure.md        page structure (source of truth for selectors)
test/
  fixtures/              synthetic/sanitized HTML only
  em-parse.test.js       node --test, no dependencies
```

- The list module runs inside `iframe#content` and asks the top window to open the cockpit via `window.top.postMessage` (same origin) with `{type:'preh:openCockpit', ms, docId, urls}`. All URLs are extracted from the action cell by `em-parse.js`.
- **Debounce on navigation:** EM reloads `iframe#content` on every folder change, so the content scripts must be idempotent. Use a MutationObserver for late-rendered grids.

## Development loop and hot reload

- Load the repository folder as an unpacked extension (chrome://extensions → Developer mode → Load unpacked).
- **Dev hot reload (Milestone 0 deliverable).** In dev mode (a flag in `chrome.storage.local`, toggled from the popup):
  - the service worker polls `chrome.runtime.getURL('dev-stamp.txt')` every ~1.5 s;
  - when the content changes, it calls `chrome.runtime.reload()` and then reloads EM tabs (`chrome.tabs.reload` for tabs matching the host).
  - No npm tooling: a tiny shell script `scripts/stamp.sh` writes the current timestamp to `dev-stamp.txt`, and Claude Code runs it after each edit.
  - **Verify** that Chrome serves the updated file for an unpacked extension. If it doesn't, fall back to a keyboard shortcut (`commands` API) that reloads the extension and the tab.
- Keep the service worker free of long-lived state (MV3 workers are killed when idle).

## Milestones

**M0 — Spikes (do first, report findings in `docs/findings.md`)**
1. Unpacked extension loads; dev hot-reload works end to end.
2. From the top window, an injected iframe loads `DuplicateSubmissionCheckResults.aspx?docID=<docId>` and renders. Expected to work given the CSP.
3. An injected iframe pointed at `CrossCheckResults.aspx?...` either renders Turnitin or is refused. Record which.
4. An injected iframe of `ViewEvaluateManuscript.aspx?...` renders including its inner `mfe-ux` iframe.
5. Opening EM's Assign Editor popup from an extension button works (click dispatch vs MAIN world), without confirming anything.

**M1 — Notes on the New Assignments list (F1)**, with storage and export/import (F3).

**M2 — Cockpit with panels (F2)**: Similarity on the left (iframe or popup fallback), Duplicate + Author Status + Evaluate on the right.

**M3 — Checklist + computed summaries** (duplicate thresholds, author-role warning).

**M4 — Polish**: other folder lists, Main Menu "waiting" panel, keyboard shortcuts.

Each milestone is done when Antonino has used it on real manuscripts without errors. Ask him to test after each milestone and adjust selectors from his feedback, never from guesses.

## Working with Antonino

- He speaks Italian. UI labels can be in English (they match EM), but explain changes to him in Italian, briefly.
- He prefers simple solutions over configurable ones. Don't add options he didn't ask for.
- When a selector fails on the live site, ask him to run a small sanitized inspection snippet in the console (or via Claude in Chrome with the confidentiality rules of `docs/em-structure.md`) rather than asking for page dumps.
- Risk to keep in mind: Elsevier is migrating journals to the new **Peer Review Service** (`peer-review.elsevier.com`). If Pattern Recognition moves, this extension stops being useful. Keep the code small.
