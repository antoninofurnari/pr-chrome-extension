# CRediT check — rules for the triage cockpit

Implemented in `src/content/em-parse.js` (`classifyRole`, `creditAuthor`,
`creditAssessment`, `creditAuthorFlags`, `creditRedText`, `creditYellowText`)
and shown in `src/content/cockpit.js`. Test cases A–G are in
`test/em-parse.test.js`.

**Deviation from the original spec (Antonino's request, 2026-10-09):** the
texts for the authors name the authors ("Author NAME is listed only under…")
instead of using their order numbers ("Author 6").

Purpose: in the triage cockpit (Step 3 — Author Status), automatically classify the author contribution (CRediT) statement of a manuscript as GREEN / YELLOW / RED, explain why per author, and for RED prepare a clarification text. The extension only **reads and displays** — it never sends anything (see hard rules in `CLAUDE.md`).

## 1. Where the data comes from

Page: `/pr/ContributingAuthorStatus.aspx?docID=&msid=&revision=` (see `docs/em-structure.md` §3.3b).
- `table#CorrAuthorGridView` → the corresponding author (one row). Columns: Order, Author Name, Contributor Roles, Email Address, ORCID Identifier, Academic Degree(s), Affiliation.
- `table#OtherAuthorsGridView` → all co-authors. Columns: Order, Author Name, Added in Revision, Contributor Roles, Email Address, ORCID Identifier, Academic Degree(s), Institution, Confirmed?
- Merge both tables into one list sorted by **Order** (the corresponding author can have any order, e.g. 2).
- **Contributor Roles** cell: roles separated by `<br>` (or newlines in innerText). Normalize: trim, collapse whitespace, treat `–` (en dash), `—` and `-` as the same character, case-insensitive match against the 14 roles below. Unknown strings → keep them, show them, and flag "unrecognized role" (do not count them as substantive).
- Ignore "Confirmed?" for this check (an unconfirmed co-author is not a triage problem).

## 2. The rule from the Elsevier training

The Elsevier editor training (Triage module, "Authorship") states that every author must meet **both** criteria:

1. **Substantial contribution** to the conception or design of the work, **or** to the acquisition, analysis or interpretation of data for the work; **and**
2. **Drafting** the work or **reviewing it critically** for important intellectual content.

The training gives the example: authors who only provided writing and editing do not qualify — the editor should ask whether they belong in the Acknowledgements. Following ICMJE (on which the training is based), funding acquisition, general supervision of a group and administrative support **alone** do not qualify for authorship either.

The Journal Manager (Oct 2026) clarified that authors may pick roles freely from the CRediT list and there is no strict rule on how many — the editor intervenes only when in doubt. Hence the graded (green/yellow/red) approach below: strict where the training is clear, tolerant on common harmless patterns.

## 3. Role classes (the 14 CRediT roles)

| Role | Class |
|---|---|
| Conceptualization | SUBSTANTIVE (criterion 1) |
| Methodology | SUBSTANTIVE |
| Investigation | SUBSTANTIVE |
| Data curation | SUBSTANTIVE |
| Formal analysis | SUBSTANTIVE |
| Software | SUBSTANTIVE |
| Validation | SUBSTANTIVE |
| Visualization | SUBSTANTIVE |
| Writing – original draft | WRITING (criterion 2) |
| Writing – review & editing | WRITING (criterion 2) |
| Funding acquisition | SUPPORT (does not satisfy criterion 1 alone) |
| Resources | SUPPORT |
| Supervision | SUPPORT |
| Project administration | SUPPORT |

## 4. Per-author flags

For each author compute:
- `noRoles` — the Contributor Roles cell is empty.
- `noSubstantive` — the author has no SUBSTANTIVE role (e.g. only "Writing – review & editing", or only SUPPORT roles, or a mix of WRITING + SUPPORT). Sub-type for the explanation:
  - `writingOnly` — only WRITING roles;
  - `supportOnly` — only SUPPORT roles (typical: senior professor with Funding acquisition / Resources / Supervision);
  - `writingAndSupport` — WRITING + SUPPORT, no SUBSTANTIVE.
- `noWriting` — the author has no WRITING role. **Informational only**: it is very common (co-authors implicitly approve the final version) and never raises the level by itself.
- `allRoles` — the author holds ≥ 12 of the 14 roles (informational; relevant for the RED pattern below).

Paper-level flags:
- `deficientCount` = number of authors with `noRoles` or `noSubstantive`.
- `noOriginalDraft` — no author has "Writing – original draft".
- `noCredit` — every author has an empty roles cell (no CRediT statement at all in EM).

## 5. Classification

Evaluate in this order; the first match wins.

**RED — ask for clarification (send back via the Journal Manager, or "Reject – invitation to resubmit")**
- `noCredit` (no CRediT statement at all), **or**
- any author with `noRoles`, **or**
- `deficientCount ≥ 2` — two or more authors without any substantial contribution. This covers the "one author does everything, the others only review & editing" pattern.

**YELLOW — acceptable, at most a note**
- `deficientCount == 1` — exactly one author without a substantial contribution (typically the senior professor with SUPPORT roles only, or one co-author with only review & editing), **or**
- `noOriginalDraft` — nobody is credited with writing the first draft.

**GREEN — OK**
- Everything else.

Single-author papers: the author must have at least one SUBSTANTIVE role, otherwise RED.

## 6. What to show in the cockpit

- A badge on the Author Status panel header: `CRediT: GREEN | YELLOW | RED`.
- Under it, one line per author: order, name (as shown on the page, never stored outside chrome.storage), roles as small chips coloured by class (SUBSTANTIVE / WRITING / SUPPORT), and the flags in plain words, e.g. "no substantial contribution (writing only)", "support roles only", "no roles".
- One line with paper-level notes: "No author credited with Writing – original draft".
- For RED: a "Copy clarification text" button producing the text in §7 with the relevant authors filled in. For YELLOW: a "Copy note" button producing the short note in §7.
- Pre-fill (do not tick) the Step 3 checklist item with the result; Antonino confirms it himself. (Implemented as the badge mirrored next to step 3, plus an "Insert CRediT text" button that appends the same text to the manuscript note.)

## 7. Text templates (English, as sent to authors)

**RED — clarification request** (include only the paragraphs that apply):

```
Before your manuscript can be considered further, please revise the author contribution (CRediT) statement, both in Editorial Manager and in the manuscript.

[if deficient authors] Author(s) {names} are listed only under {their roles, e.g. "Writing – review & editing" / "Funding acquisition and Resources"}. According to the journal's authorship criteria, each author must have made a substantial contribution to the conception or design of the work, or to the acquisition, analysis or interpretation of data, in addition to drafting or critically revising the manuscript. Please specify the substantial contribution of each of these authors or, if they do not meet the criteria, consider moving them to the Acknowledgements section.

[if noOriginalDraft] No author is listed under "Writing – original draft". Please indicate which author(s) drafted the manuscript.

[if an author has allRoles while others are deficient] Author {name} is listed under all contributor roles, including Supervision and Funding acquisition. Please verify that the roles are correctly assigned to each author.

[if noRoles / noCredit] No contributor roles are provided for author(s) {names}. Please complete the CRediT statement for all authors.
```

**YELLOW — note** (for Antonino's own records, or for the custom letter to the AE when assigning):

```
CRediT note: {e.g. "NAME has support roles only (Funding acquisition, Resources)" / "no author credited with Writing – original draft"}. Not blocking; the authors may be asked to complete the statement at revision.
```

## 8. Test cases (sanitized; in `test/em-parse.test.js`)

| Case | Authors and roles | Expected |
|---|---|---|
| A | 1: all 14 roles · 2–6: Writing – review & editing only | RED (deficientCount = 5; allRoles pattern) |
| B | 1: Data curation, Formal analysis, Methodology, Software · 2 (corresponding): Funding acquisition, Validation, Visualization · 3: Conceptualization · 4: Investigation · 5: Funding acquisition, Resources · 6: Writing – review & editing · 7: Conceptualization, Project administration | RED (deficientCount = 2: author 5 supportOnly, author 6 writingOnly) + noOriginalDraft |
| C | 1 (corresponding): Methodology, Writing – original draft · 2: Formal analysis · 3: Formal analysis · 4: Investigation, Writing – review & editing · 5: Methodology | GREEN (noWriting on 2, 3, 5 is informational only) |
| D | as C, but author 5: Funding acquisition, Supervision | YELLOW (deficientCount = 1) |
| E | as C, but nobody has Writing – original draft | YELLOW (noOriginalDraft) |
| F | 1: Conceptualization, Writing – original draft · 2: (empty) | RED (noRoles) |
| G | single author: Writing – original draft only | RED (single author without a substantial role) |
