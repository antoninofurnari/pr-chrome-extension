# em-structure.md — Elsevier Editorial Manager (Pattern Recognition) — technical structure
Inspected: 2026-10-07 · Origin: https://www.editorialmanager.com · Path prefix: /pr/
Sanitized: <MS>, <TITLE>, <NAME>, <EMAIL>, <VAL> replace all real values. ⚠ = state-changing element, never trigger programmatically.

## 0. Embedding headers (same for every same-origin page tested)
All EM pages tested (default2.aspx, EditorsMainMenu.aspx, NewAssignments.aspx, SimilarityCheckResults.aspx,
DuplicateSubmissionCheckResults.aspx, EMDetails.aspx, ContributingAuthorStatus.aspx, ViewEvaluateManuscript.aspx,
selectEditor2.aspx, EditorDecision.aspx) returned:
- status: 200
- x-frame-options: (none)
- content-security-policy: `frame-ancestors 'self' https://*.editorialmanager.com http://*.editorialmanager.com https://*.ariessc.com http://*.ariessc.com;`
→ Any EM page can be iframed by another EM page (e.g. an injected iframe from a content script). It can NOT be framed by a chrome-extension:// page.

---

## 1. Main Menu
- Top document: `/pr/default2.aspx` (shell with header and nav)
- Frame structure (top):
  - `<iframe id="content" name="content" src="https://www.editorialmanager.com/pr/EditorsMainMenu.aspx?fromLogin=<VAL>">`
  - All navigation happens INSIDE this iframe. The top URL stays `/pr/default2.aspx`.
- Inside `EditorsMainMenu.aspx`: one hidden `<iframe class="ot-text-resize">` (OneTrust, no src). There are no other frames.
- Top nav links (in default2.aspx): `<a id="MainMenu" href="manuscript_status.asp" onclick="return checkLinkState(this,"<VAL>");">`, plus the same pattern for Home, SubmitaManuscript, Submissions and People. Other links: `openHelp(this,"<VAL>")` and `openPrivacyWindow(this,"<VAL>")`. Logout is `#logoutLink` → `logout.asp`.
- Folder links are **web components**, not plain `<a>`:
  - Container: `<aries-accordion id="accordion<VAL>" accord-title="Editor 'To-Do' List">` > `<aries-accordion-item>` > `<aries-folder-item …>`
  - Attributes of each `<aries-folder-item>`:
    `link-id`, `folder-url`, `nvgurl`, `sign-post-id`, `signpost-enabled`, `show-signpost`, `active-link`,
    `green`, `orange`, `red` (counts), `greenlabel`, `orangelabel`, `redlabel`, `folderstatuslabel`
  - The real `<a href="{folder-url}">` lives inside the item's **open shadowRoot**. The visible text is "<Folder name> (<count>)".
  - Example: `<aries-folder-item link-id="lnkNewAssignments" folder-url="NewAssignments.aspx" nvgurl="NewAssignments.aspx" sign-post-id="idNewEditorAssignments" green="<VAL>" orange="<VAL>" red="<VAL>">`
  - When a folder has 0 items, `folder-url="javascript:void(0);"` and the real target is still in `nvgurl`.
  - Folders present for this account (link-id → nvgurl):
    - lnkNewAssignments → NewAssignments.aspx
    - lnkSubmissionsWithRequiredReviewsComplete → SubmssionsWithRequiredReviewsComplete.aspx (sic)
    - lnkSubmissionsRequiringAdditionalReviewers → SubmissionsRequiringAdditionalReviewers.aspx
    - lnkSubmissionsWithOneOrMoreLateReviews → SubmissionsWithLateReviews.aspx
    - lnkReviewersInvitedNoResponse → SubmissionsWithNoReviewersResponse.aspx
    - lnkSubmissionsUnderReview → editorUnderReview.asp
    - lnkGroupbyEditorsIAssigned → editorSubByAssign.asp
    - lnkGroupbyEditorWithCurrentResponsibility → editorSubByCurEd.asp
    - lnkGroupbyManuscriptStatus → editorSubByStatus.asp
    - lnkMyAssignmentsWithDecision → editor_complete.asp
    - lnkMyAssignmentsWithFinalDisposition → MyAssignmentsWithFinalDisposition.aspx
    - lnkActiveLinkedSubmissionGroups / lnkInactiveLinkedSubmissionGroups → LinkedSubmissionGroups.aspx?active=<true|false>
    - lnkSearchLegacyManuscripts, lnkViewAllLegacyManuscripts, lnkBillMeReport, lnkManageWaiverRequestsReport, lnkFeesRequiringActionReport
  - **There is no "Direct-to-Editor New Submissions" folder for this account/role.**
  - Robust selector: `document.querySelector('aries-folder-item[link-id="lnkNewAssignments"]').getAttribute('nvgurl')`

---

## 2. "New Assignments" folder list
- URL: `/pr/NewAssignments.aspx`, loaded inside `iframe#content`. No query string; the form posts back to itself: `<form id="form1" method="post" action="./NewAssignments.aspx">`.
- Contains one empty `<iframe>` (no src or name).
- **Frozen-grid layout**: there are two tables, BOTH with `id="datatable"` (duplicate id), one for the fixed column and one for the scrolling data.
  - Header tables are separate: `table.fg-cols-table.fg-table` (×2).
  - Action column header: `["", "Action"]`
  - Data column headers: `["Manuscript Number","Article Type","Section Category","Article Title","Author Name","Initial Date Submitted","Status Date","Current Status","Editor Decision",""]`
  - Body tables: `table#datatable.fg-table.fg-rows-table`. Use `querySelectorAll('table#datatable')[0]` for actions and `[1]` for data.
  - Row 0 in each body table is `tr.colresize-row` (spacer). Real rows come after it.
  - Action rows: `tr#fr0, tr#fr1…` (alternate rows get `.fg-altrow`). Data rows: `tr#nfr0, tr#nfr1…`.
  - Both rows carry `data-identity="<VAL>"` and `data-rowindex="<n>"`. **`data-identity` == docId.** Pair the rows by `data-rowindex` or by `fr<n>`/`nfr<n>`.
- **Manuscript number**: the plain text of `tr#nfr<n> > td:nth-child(1)` (no wrapper element). Format `AA-D-99-99999`, i.e. `PR-D-YY-NNNNN`.
- Author Name cell contains `a > span.hcite > span.creator.vcard > span.n > span.fn > span.given-name…`.
- A possible-duplicate icon can appear in the Author Name cell: `<img src="../pr/img/dupdoc.gif" title="possible duplicate submission" alt="possible duplicate submission">`.

### Sanitized action cell (tr#fr<n> > td:nth-child(2), class `al-cell fg-fixed-col`)
```html
<td class="al-cell fg-fixed-col">
  <div id="fg-al-<VAL>" class="al-menu" role="group" aria-label="<TITLE>" data-lookup="<VAL>" style="display:block;">
    <div class="al-expanded">
      <a href="javascript:viewEditorPDFs(<VAL>, '<VAL>', 0, '<VAL>', '<VAL>');">View Submission</a><br>
      <a style="display:inline-block;" href="ViewEvaluateManuscript.aspx?displayName=<VAL>&docId=<VAL>">Evaluate Manuscript</a><br>
      <a style="display:inline-block;" href="javascript:openCenterWin('<URL>','<VAL>',1,1,0,0,0,0);">Similarity Check Results</a>
      <span style="font-size:<VAL>%;" title="Similarity Check Status Summary: …">(<N>%)</span><br>
      <div><a style="white-space:nowrap;" href="javascript:openCenterWin('<URL>','<VAL>',1,1,0,0,0,0);">Duplicate Submission Check</a>
           <span class="warning nowrap" style="font-size:<VAL>%;" title="EM Duplicate Score">(<N>%)</span></div>
      <div class="linkWithFlags"><a class="linkWithFlags" style="display:inline-block" href="javascript:popupDetailsWindow(<VAL>, '<VAL>', '<VAL>')">Details</a>
           <span id="flags<VAL>"><span class="flag" onmouseover="showtip(this,event,'Set Flags');" onmouseout="hidetip();" onclick="popupCustomFlags('pr', <VAL>, 'SubmissionEditorialOnly');"><img src="/pr/img/setFlagIcon2.gif"></span></span></div>
      <a href="javascript:popupDiscussionParticipants(…)">Initiate Discussion</a><br>
      … (remaining links, each followed by <br>)
    </div>
  </div>
</td>
```
- `data-lookup` is NOT the docId.
- The first `td` of the action row has class `fg-fixed-col greenBar` (status colour bar) and contains an empty `div`.

### Action links (label → href pattern; all are `href="javascript:…"` unless noted; `<URL>` = same-origin relative URL)
| Label | Pattern |
|---|---|
| View Submission | `viewEditorPDFs(<docId>, '<VAL>', 0, '<VAL>', '<VAL>')` |
| Evaluate Manuscript | plain href `ViewEvaluateManuscript.aspx?displayName=<VAL>&docId=<docId>` (same frame) |
| Similarity Check Results | `openCenterWin('DotNetPopUps/SimilarityCheckResults.aspx?docID=<docId>&msid=<VAL>','<VAL>',1,1,0,0,0,0)` |
| Duplicate Submission Check | `openCenterWin('DuplicateSubmissionCheckResults.aspx?docID=<docId>','<VAL>',1,1,0,0,0,0)` |
| Details | `popupDetailsWindow(<docId>, '<MS>', '<VAL>')` |
| Initiate Discussion | `popupDiscussionParticipants(<VAL>, 1, '<VAL>')` |
| History | `PopupHistoryWindow('<VAL>')` → `doc_history.asp?docid=<VAL>` |
| File Inventory | `PopupFileInventoryWindow(<VAL>,0,'<VAL>',2)` |
| Edit Submission | `document.location.href='ChooseEditSubmissionMethod.aspx?ed=&msid=&docid=&ms_num=&cont=&sub_num=&csta=&callPage=&CurrentRow=&CurrentPage='` |
| Assign Editor (`a.assignEditor`) | `editorAssignment(<docId>, false, false, false, false, false, '<VAL>')` |
| Unassign Editor | `undoEditorAssignment(<docId>, '<VAL>')` ⚠ state-changing |
| Invite Reviewers | plain href `ReviewerSelectionSummary.aspx?docid=&msid=&CurrentRow=&CurrentPage=` |
| Similar Articles in MEDLINE | `popupMedlineSearch('<VAL>')` |
| PubMed - Title / Similar Articles in Scopus / Scopus All Author Search | `PopupBibliographicSearchWindow('openBibliogSearchLink.asp?bibliogSearchID=&docID=&peopleID=')` |
| Submit Editor's Decision and Comments | plain href `EditorDecision.aspx?docid=&msid=&CurrentRow=&CurrentPage=` |
| Send E-mail | `openCenterWin75Percent('sendAdHocEmail.asp?arg=<VAL>','<VAL>',1,1,0,0,0,0,true)` |
| Linked Submissions | plain href `addCreateLinkedSubmissionGroup.aspx?docID=&CurrentRow=&CurrentPage=` |

- Similarity `docID` == docId. Similarity `msid` is NOT the manuscript number (internal id).
- `popupDetailsWindow` arg0 == docId, arg1 == manuscript number, arg2 = sectionID (numeric).
- **Evaluate Manuscript warning icon: not found on any of the 4 rows checked.** Those rows hold no img or icon next to the link, only `style="display:inline-block;"`. The markup when the warning is present is therefore unknown (re-inspect when a flagged MS appears). The only non-flag icon seen in the grid is `dupdoc.gif`.

---

## 3. Actions

### 3.1 Similarity Check Results
- a. Popup via `openCenterWin(url, winName=<VAL encoded string>, …)` → `openCenterWinPercentageRet(…, 0.75)` → `window.open(url, name, "width=,height=,top=,left=,scrollbars=1,resizable=1")`.
  URL: `/pr/DotNetPopUps/SimilarityCheckResults.aspx?docID=<VAL>&msid=<VAL>`
- b. Same origin (editorialmanager.com).
- c. No frames or iframes. `<form id="ctl01" action="SimilarityCheckResults.aspx?docID=&msid=">`.
  - Table `table#gridResults.datatable` with headers `["Date:","Rev.","Triggered By","File Sent","Report Status","Score","Ignore Score"]`.
  - Cell ids: `gridResults_ctl02_lblDate`, `_lblRevNum`, `_tlblTriggeredBy`, `_lblFileName`, `_lnkReportStatus` (+ hidden `_ucErrorDialog_*`), `_lblScore`, `_chkIgnoreScore` (checkbox ⚠ state-changing).
  - Other links: `a#fileInventory` → `SubmissionFileInventory.aspx?msid=&docID=&approvalType=`, and "Duplicate Submission Check" → `DuplicateSubmissionCheckResults.aspx?docID=&s=`.
  - jQuery 1.12.4 is present in the popup.
- d. 200, no XFO, CSP frame-ancestors as in §0.

### 3.1b "Completed" link (inside Similarity)
- a. `<a id="gridResults_ctl02_lnkReportStatus" href="javascript:openV2ReportWindow(<docID>,'<MS-like msid>','<APISubmissionID>')">Completed</a>`
  - `openV2ReportWindow(documentPartId, msid, APIsubmissionID)` → `openCenterWin75Percent('../CrossCheckResults.aspx?docID=&msid=&APISubmissionID=', 1, 1, 0,0,0,0)`. Note that it omits winName (the args are shifted), so it opens a popup named "1".
  - A legacy `openReportWindow(documentPartId)` → `SimilarityCheckReport.aspx?documentPartId=` also exists.
  - `/pr/CrossCheckResults.aspx` returns a **302 redirect to an external domain**.
- b. **External: `https://elsevier.turnitin.com/viewer/submissions/<VAL>?locale=<VAL>`** (Turnitin/iThenticate viewer).
- c. Not inspected (cross-origin).
- d. Same-origin fetch of CrossCheckResults.aspx with `redirect:'manual'` gives `opaqueredirect`. Following the redirect is **blocked by CORS** (the Turnitin preflight OPTIONS returned 405), so its XFO/CSP can't be read.

### 3.2 Duplicate Submission Check
- a. Popup via `openCenterWin` (same mechanism as 3.1). URL: `/pr/DuplicateSubmissionCheckResults.aspx?docID=<VAL>` (an `&s=<VAL>` variant is linked from the Similarity page).
- b. Same origin.
- c. No frames. `<form id="form1" action="DuplicateSubmissionCheckResults.aspx?docID=">`. Headings: "Duplicate Submission Check Results - <DATE>", "Potential Duplicate Submissions".
- d. 200, no XFO, CSP as §0.
- e. Table `table#gridResults.datatable` (all candidates on one page, no pager, can be 200+ rows). The header row is `tr[valign=bottom]` with `th`:
  `["Manuscript/Submission Number","Initial Date Submitted","Revision","Current Status","Article Title","Authors","Article Title Similarity","Author Similarity","Abstract Similarity"]`
  Rows: `tr[align=left]` and `tr.altrow[align=left]`. The current MS itself is NOT listed.
```html
<tr align="left">
  <td><div style="white-space:nowrap">
        <span id="gridResults_ctl<N>_SubPubNumberValue"><MS></span><br>
        <a href="javascript:viewAuthorPDFs(<VAL>, '<VAL>', <VAL>, '<VAL>');">View Submission</a>
        <a style="display:inline-block" href="javascript:popupDetailsWindow(<VAL>, '<VAL>', '<VAL>')">Details</a>
        <span id="flags<VAL>"></span></div></td>
  <td><DATE M/D/YYYY h:mm:ss></td>
  <td><span id="gridResults_ctl<N>_RevisionValue"><N></span></td>
  <td><span id="gridResults_ctl<N>_CurrentStatusValue"><TXT></span></td>
  <td style="width:<N>%;"><TITLE></td>
  <td style="width:<N>%;"><NAME>…</td>
  <!-- ×3 similarity cells -->
  <td><span class="redtextBold"><N>%</span><br>   <!-- high score; low score = plain <span> -->
      <div style="float:left;height:<N>px;width:<N>px;border:1px solid"><div style="float:left;height:<N>px;width:<N>%;background-color:red|green"></div></div></td>
</tr>
```
  The score shows as text `<N>%`. The bar colour is `red` (flagged, `span.redtextBold`) or `green`.

### 3.3 Details
- a. Popup: `popupDetailsWindow(docID, ms_num, sectionID)` → `openCenterWin75Percent("EMDetails.aspx?docid=&ms_num=&sectionID=", "popupDetailsWindow", 1,1,0,0,0,0)` → `window.open(…, "popupDetailsWindow", "width=,height=,top=,left=,scrollbars=1,resizable=1")`.
- b. Same origin.
- c. No frames. `<form id="form1" action="EMDetails.aspx?docid=&ms_num=&sectionID=">`. Buttons: `input#btnCancel` / `#btnCancel2` (`window.close();__doPostBack(…)`), `input#btnSaveAndClose<N>` ⚠ (`validatePage(…);WebForm_DoPostBackWithOptions(…)`).
- d. 200, no XFO, CSP as §0.

### 3.3b Author Status (inside Details)
- a. `<a href="javascript:ViewOtherAuthorStatusPopUp('<URL>')">Author Status</a>` → `window.open(url, "ViewOtherAuthorStatus", "resizable=yes,scrollbars=yes,height=,width=")` + `moveTo` + `focus`.
  URL: `/pr/ContributingAuthorStatus.aspx?docID=<VAL>&msid=<VAL>&revision=<VAL>`
- b. Same origin.
- c. No frames. `form#form1`.
- d. 200, no XFO, CSP as §0.
- e. Two tables:
  - `table#CorrAuthorGridView.datatable` (corresponding author): `["Order","Author Name","Contributor Roles","Email Address","ORCID Identifier","Academic Degree(s)","Affiliation"]`
  - `table#OtherAuthorsGridView.datatable` (co-authors): `["Order","Author Name","Added in Revision","Contributor Roles","Email Address","ORCID Identifier","Academic Degree(s)","Institution","Confirmed?"]`
```html
<tr align="left" valign="top">
  <td><span id="OtherAuthorsGridView_ctl<N>_AuthorRank"><N></span></td>
  <td><a id="OtherAuthorsGridView_ctl<N>_AuthorNameHyperlink" href="javascript:void(openCenterWinPercentage('<VAL>','<VAL>',…))"><NAME></a>
      <span id="OtherAuthorsGridView_ctl<N>_AuthorNameLabel"></span></td>
  <td><span>R<N></span></td>                                   <!-- Added in Revision -->
  <td style="…"><br><br><br></td>                             <!-- Contributor Roles -->
  <td><div id="…_Email_EditArea_<N>">…textarea, a#…_Email_CancelLink, a#…_Email_SaveLink ⚠…</div>
      <div id="…_Email_DisplayArea_<N>"><span id="…_Email_DisplayEmailControl_<N>"><EMAIL></span>
      <input id="…_Email_AuthorIdField_<N>"><input id="…_Email_PeopleIdField_<N>"></div></td>
  <td style="…"><a id="OtherAuthorsGridView_ctl<N>_lnkOrcid" href="<VAL>"></a></td>
  <td><span id="OtherAuthorsGridView_ctl<N>_AuthorDegree"></span></td>
  <td><div id="OtherAuthorsGridView_ctl<N>_AuthorInstitutions"><div id="divInstInfo"><div><span id="spnInstitutionName"><TXT></span>
      <span id="InstInfoToolTip"><span><img id="imgIcon"><span>…</div></div></div></td>
  <td><span id="OtherAuthorsGridView_ctl<N>_AuthorVerificationStatus_<N>"><span>Yes <DATE> | No Response</span>
      <a id="OtherAuthorsGridView_ctl<N>_ChangeVerificationLink" ⚠></a></span></td>
</tr>
```
  Observed "Confirmed?" values: `"Yes <Mon DD, YYYY>"` and `"No Response"`. Note: duplicate ids `divInstInfo`, `spnInstitutionName` and `imgIcon` repeat on every row.

### 3.4 Evaluate Manuscript
- a. Plain link, **same frame** (navigates `iframe#content`): `/pr/ViewEvaluateManuscript.aspx?displayName=<VAL>&docId=<VAL>`.
- b. The EM page is same-origin, but its content is an **external micro-frontend iframe**.
- c. `<iframe id="iframe_msa" src="https://mfe-ux.triage.elsevier.com/index.html?token=<VAL>&pendoId=<VAL>&isIframe=<VAL>">`. No forms on the EM wrapper page.
- d. Wrapper: 200, no XFO, CSP as §0. Inner `mfe-ux.triage.elsevier.com`: not fetched (cross-origin, token-bearing URL).

### 3.5 Assign Editor (page only fetched, nothing submitted)
- a. Popup. `editorAssignment(documentID, warnOfTechnicalComments, useReassignEditorChain, buildEditorChain, enableSuggestEditorSearch, enableEditorSearch, sessionThreadId)`:
  - optional `window.confirm(...)` when `warnOfTechnicalComments`
  - URL by flags: `reassignPreviousEditors.aspx` | `AssignEditorChain.aspx` | `suggestEditor.aspx` | `selectEditor.aspx` | **`selectEditor2.aspx`** (default; used here since all flags are false)
  - → `openCenterWinPct(url, "editorAssignment", …)` → `window.open(url, "editorAssignment", "width=,height=,top=,left=,scrollbars=1,resizable=1")`
  URL: `/pr/selectEditor2.aspx?selectType=<VAL>&documentID=<VAL>&SessionThreadIdField=<VAL>`
- b. Same origin.
- c. No frames. `<form id="selectEditor" action="selectEditor2.aspx">`. Tables:
  - `table.datatable2` ("Manuscript Classifications")
  - `table#tblSearchCriteria.searchControl_ContainerTable` / `#SearchControlEditor_tblSearchRows` (search builder)
  - `table#datatable2.datatable2.editorsGrid` with headers `["Select","Editor Role","Editor Description","Editor Name","Current Assignments","# Classification Matches","Classification Matches","Available during next 30 days","Past Assignments for the last …"]`
  - Buttons: `#buttonCancelTop`/`#buttonCancel` (`window.close();return false;`), `#sendCustomButtonTop`/`#sendCustomButton` ⚠, `#sendDefaultsButton…` ⚠ (`setDefaultLetters(0|1);WebForm_DoPostBackWithOptions(…)`), `#btnCurrentSearch`, `#btnClear`, `#SearchControlEditor_AddSearchRowButton`
- d. 200, no XFO, CSP as §0.

### 3.6 Submit Editor's Decision and Comments (page only fetched)
- a. Plain link, **same frame** (iframe#content): `/pr/EditorDecision.aspx?docid=<VAL>&msid=<VAL>&CurrentRow=<VAL>&CurrentPage=<VAL>`.
- b. Same origin.
- c. No frames. `<form id="decForm" action="./EditorDecision.aspx?docid=&msid=&CurrentRow=&CurrentPage=">`. Sections: "… Editor Decision and Comments for Manuscript <MS>", "Confidential Comments to Editor", "Comments to Author", "Production Notes", "Reviewer Questions and Responses", "Editor Decision Phrases".
  Buttons (top and bottom): `#Cancel<N>`, `#Save<N>` ⚠ "Save & Submit Later", `#Proof<N>` "Proof & Print", `#Proceed<N>` ⚠; also 3× "Open in New Window" and `#ctlEditorDecisionPhrases_btnPreviewPhrases` / `_btnCloseSelectedPhrases`.
- d. 200, no XFO, CSP as §0.

---

## 4. Global environment
- jQuery **1.12.4** in the top window, in `iframe#content` and in popups. jQuery UI is also loaded (`/pr/ClientScript/jquery-ui.js`).
- Third-party scripts: Pendo (`cdn.pendo.io`), Adobe Launch (`assets.adobedtm.com`), OneTrust (`cdn.cookielaw.org`).
- Shared popup library: `/v17.0/webresources/OpenPopupWindowMain.js` (getWinWidth, getWinHeight, openCenterWin*, …).
- Web components: `aries-accordion`, `aries-accordion-item`, `aries-folder-item` (registered in customElements, open shadow root).
- Global functions used by actions (arity in parentheses; "top+frame" = defined in both the top window and `iframe#content`):
  - `openCenterWin(9)` [top+frame] → `openCenterWinPercentageRet(13)`
  - `openCenterWin75Percent(9)` [top+frame]
  - `openCenterWinPct`, `openCenterWinPctRet`, `openCenterWinPercentage`, `openCenterWin2`, `openCenterWin3`, `openCenterWinRet`, `openWinGeneric`, `OpenWindowFixedSize`, `OpenPopUpGeneral`, `AddPopUpToCloseList`
  - `viewEditorPDFs(8)` [frame], `viewAuthorPDFs` (Duplicate page)
  - `popupDetailsWindow(3)` [top+frame], `popupDetailsWindow2`
  - `popupDiscussionParticipants(4)` [frame]
  - `PopupHistoryWindow(1)` [frame] (also `popupHistoryWindow`)
  - `PopupFileInventoryWindow(4)` [frame]
  - `editorAssignment(7)` [top+frame], `undoEditorAssignment(2)` [top+frame]
  - `popupMedlineSearch(1)` [top+frame], `PopupBibliographicSearchWindow(1)` [frame]
  - `popupCustomFlags(3)`, `showtip(3)`, `hidetip(0)` [frame]
  - `checkLinkState(1)`, `openHelp(2)`, `openPrivacyWindow(2)`, `skipToMainContent(1)` [top]
  - Similarity popup only: `openV2ReportWindow(3)`, `openReportWindow(1)`, `reportError`
  - Details popup only: `ViewOtherAuthorStatusPopUp(1)`
  - ASP.NET WebForms: `__doPostBack`, `WebForm_DoPostBackWithOptions`, `validatePage`

---

## 5. Not inspected / limitations
1. **"Direct-to-Editor New Submissions" folder**: not present for this account, so not inspected.
2. **Evaluate Manuscript warning icon**: none of the current rows show it, so its markup is unknown.
3. **Turnitin report (Completed)**: cross-origin. The final URL shape was seen only through the network log of the blocked CORS preflight. XFO/CSP couldn't be read and the page wasn't opened (by design: no similarity-report content).
4. **mfe-ux.triage.elsevier.com** (Evaluate Manuscript iframe): cross-origin with a token in the URL. Not fetched, headers unknown.
5. **Popup window names** for Similarity and Duplicate are encoded strings (`<VAL>`) that differ per link, so they aren't stable to match on.
6. **Popups (Similarity, Duplicate, Details, Author Status, Assign Editor, Decision)**: read through a same-origin GET plus DOMParser, not rendered live. Script-injected DOM and window titles may differ slightly. Only the Similarity popup was opened live (to read `openV2ReportWindow`), then closed.
7. **View Submission / File Inventory / History**: target URLs and functions were captured, but those pages weren't inspected (not requested; the PDFs are off-limits).
