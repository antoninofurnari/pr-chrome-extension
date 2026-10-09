# CRediT check — rules for the triage cockpit

Implemented in `src/content/em-parse.js` (`classifyRole`, `creditAuthor`,
`creditAssessment`, `creditAuthorFlags`; message generator `creditIssues`,
`creditCommentsText` (A), `creditEmail` (B), `creditAeNote` (C)) and shown in
`src/content/cockpit.js` (Author Status panel: badge, one line per author,
outputs with preview and Copy; the outputs not relevant to the level are
under "Other texts"). The recipient name and signature of (B) are set in the
extension popup. Test cases A–G and the golden texts of §7.5 are in
`test/em-parse.test.js`. Texts name the authors, never their order numbers.

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
- The texts of §7, each with its own Copy button (only those relevant to the level).
- Pre-fill (do not tick) the Step 3 checklist item with the result; Antonino confirms it himself. (Implemented as the badge mirrored next to step 3, plus an "Insert CRediT text" button that appends the same text to the manuscript note.)

## 7. Message generator (deterministic, no AI, all local)

The cockpit generates ready-to-copy texts from the flags of §4–5. Same input → same text. Never paraphrase, never call any external service. Antonino copies the text himself; the extension never sends it.

Three outputs, each with its own "Copy" button. Show only those relevant to the level:

| Level | Outputs shown |
|---|---|
| RED | (A) Comments to authors · (B) Email to the Journal Manager (wraps A) |
| YELLOW | (C) Note to the AE |
| GREEN | none ("CRediT OK") |

Antonino can still open the other outputs manually (e.g. (C) for a RED case he decides not to send back).

### 7.1 Building the issue sentences (shared by A and C)

This is a **template system, not an LLM**: every sentence below is fixed text with slots filled from the parsed data. Write in **plain, conversational prose** (no bullet points), always with the **authors' names and actual roles** — never generic placeholders, never "and/or".

**Opening.** `We noticed an issue with the author contribution (CRediT) statement of your manuscript.` — use "some issues" when there is more than one issue (an issue = one group in step 1, `noOriginalDraft`, `allRoles` or `noRoles`).

**Step 1 — authors without a substantial contribution (`noSubstantive`).** Group authors that have **exactly the same set of roles**. For each group build a clause:
- one author: `{Name} is listed only under {roles}`
- several authors: `{Name1}, {Name2} and {Name3} are listed only under {roles}`
Join the clauses into one sentence: the first clause in full, the following ones with the verb omitted, the last introduced by ", and":
- 1 group: `<NAME6> is listed only under "Writing – review & editing".`
- 2 groups: `<NAME5> is listed only under "Funding acquisition" and "Resources", and <NAME6> only under "Writing – review & editing".`
- 3+ groups: `A is listed only under …, B only under …, and C only under ….`
`{roles}` = actual roles, each in double quotes, joined English-style (`"A"`, `"A" and "B"`, `"A", "B" and "C"`). Order groups by the lowest author order in the group.

**Step 2 — `allRoles`** (only if `deficientCount ≥ 2`): `At the same time, {Name} is listed under almost all contributor roles, including {up to 2 SUPPORT roles held, quoted}.`

**Step 3 — `noOriginalDraft`:** `In addition, no author is listed under "Writing – original draft".` (drop "In addition, " and capitalise if it is the only issue).

**Step 4 — `noRoles`:** `No contributor roles are listed for {names}.` `noCredit` replaces everything with: `We noticed that the author contribution (CRediT) statement is missing.`

Use the en dash in "Writing – original draft" and "Writing – review & editing". Names exactly as shown in Author Status.

### 7.2 (A) Comments to authors — RED

Two paragraphs. The **first** is built from the data (7.1: names and actual roles). The **second** is **fixed text** — no names, no variables — that restates the training criteria. Only two optional fixed sentences may be appended to it. This keeps the generator a simple template, with no grammar to compute.

```
{Opening} {sentences from 7.1}

{FIXED_PARAGRAPH}{OPTIONAL_SENTENCES}
```

`FIXED_PARAGRAPH` (verbatim, always the same):
```
Authors are free to choose their CRediT roles, but these should reflect each author's actual contribution. According to the journal's authorship criteria, each author should have made a substantial contribution to the conception or design of the work, or to the acquisition, analysis or interpretation of data, and should have drafted the work or revised it critically for important intellectual content. Could you please check the contributor roles of all authors against these criteria and update the statement where needed, both in Editorial Manager and in the manuscript?
```

`OPTIONAL_SENTENCES` (verbatim, each preceded by a space, in this order, only if the flag is set):
- `noOriginalDraft` → `Please also make sure that the author(s) who drafted the manuscript are listed under "Writing – original draft".` (not added when `noCredit`: the statement is missing altogether)
- `noRoles` or `noCredit` → `Please also make sure that contributor roles are provided for all authors.`

Never suggest moving authors to the Acknowledgements (Antonino's choice: keep the request neutral).

### 7.3 (B) Email to the Journal Manager — RED

Antonino's send-back template (Oct 2026: the Journal Manager performs the send back with the comments he receives). `{ISSUE_TOPIC}` = `author contribution (CRediT) statement`.

Subject: `{MS} – Send back to authors (CRediT statement)`

```
Dear {JM_NAME},

During the initial assessment of manuscript {MS_NUMBER}, I noticed an issue with the {ISSUE_TOPIC} that should be addressed before the manuscript can proceed to peer review. Could you please send it back to the authors with the comments below?

--- Comments to authors ---
{AUTHOR_MESSAGE = text of (A)}
---

Once the authors resubmit, please assign the manuscript back to me so that I can complete the assessment.

Thank you very much,
{SIGNATURE}
```

`{JM_NAME}`, the recipient email and `{SIGNATURE}` are settings in the extension popup (defaults: Sami, the Journal Manager's address, Antonino). The **"Open email draft"** button opens a new email in Antonino's mail program through a `mailto:` link (To, Subject and Body filled in) and also copies the body, in case the mail program truncates long `mailto:` links. Nothing is sent by the extension: Antonino reviews and sends the email himself.

### 7.4 (C) Note to the AE — YELLOW (or RED not sent back)

For the custom assignment letter (Assign Editor → "Confirm Selections and Send Custom Letters") or the Manuscript Notes:

```
A note on the CRediT statement, not blocking at triage: {sentences from 7.1, without the Opening}. It would be good to ask the authors to complete it at the first revision.
```

### 7.5 Examples (golden tests; names here are placeholders)

Case B of §8 → RED, output (A):
```
We noticed some issues with the author contribution (CRediT) statement of your manuscript. <NAME5> is listed only under "Funding acquisition" and "Resources", and <NAME6> only under "Writing – review & editing". In addition, no author is listed under "Writing – original draft".

Authors are free to choose their CRediT roles, but these should reflect each author's actual contribution. According to the journal's authorship criteria, each author should have made a substantial contribution to the conception or design of the work, or to the acquisition, analysis or interpretation of data, and should have drafted the work or revised it critically for important intellectual content. Could you please check the contributor roles of all authors against these criteria and update the statement where needed, both in Editorial Manager and in the manuscript? Please also make sure that the author(s) who drafted the manuscript are listed under "Writing – original draft".
```

Case A of §8 → RED, output (A):
```
We noticed some issues with the author contribution (CRediT) statement of your manuscript. <NAME2>, <NAME3>, <NAME4>, <NAME5> and <NAME6> are listed only under "Writing – review & editing". At the same time, <NAME1> is listed under almost all contributor roles, including "Funding acquisition" and "Supervision".

Authors are free to choose their CRediT roles, but these should reflect each author's actual contribution. According to the journal's authorship criteria, each author should have made a substantial contribution to the conception or design of the work, or to the acquisition, analysis or interpretation of data, and should have drafted the work or revised it critically for important intellectual content. Could you please check the contributor roles of all authors against these criteria and update the statement where needed, both in Editorial Manager and in the manuscript?
```

Case D of §8 → YELLOW, output (C):
```
A note on the CRediT statement, not blocking at triage: <NAME5> is listed only under "Funding acquisition" and "Supervision". It would be good to ask the authors to complete it at the first revision.
```

## 8. Test cases (sanitized; use them as fixtures in `test/`)

| Case | Authors and roles | Expected |
|---|---|---|
| A | 1: all 14 roles · 2–6: Writing – review & editing only | RED (deficientCount = 5; allRoles pattern) |
| B | 1: Data curation, Formal analysis, Methodology, Software · 2 (corresponding): Funding acquisition, Validation, Visualization · 3: Conceptualization · 4: Investigation · 5: Funding acquisition, Resources · 6: Writing – review & editing · 7: Conceptualization, Project administration | RED (deficientCount = 2: author 5 supportOnly, author 6 writingOnly) + noOriginalDraft |
| C | 1 (corresponding): Methodology, Writing – original draft · 2: Formal analysis · 3: Formal analysis · 4: Investigation, Writing – review & editing · 5: Methodology | GREEN (noWriting on 2, 3, 5 is informational only) |
| D | as C, but author 5: Funding acquisition, Supervision | YELLOW (deficientCount = 1) |
| E | as C, but nobody has Writing – original draft | YELLOW (noOriginalDraft) |
| F | 1: Conceptualization, Writing – original draft · 2: (empty) | RED (noRoles) |
| G | single author: Writing – original draft only | RED (single author without a substantial role) |
