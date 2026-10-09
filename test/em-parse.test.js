// Pure-function tests. Run with: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/content/em-parse.js');

test('parseJsCall: openCenterWin', () => {
  const c = P.parseJsCall("javascript:openCenterWin('DuplicateSubmissionCheckResults.aspx?docID=123','w',1,1,0,0,0,0);");
  assert.equal(c.fn, 'openCenterWin');
  assert.deepEqual(c.args, ['DuplicateSubmissionCheckResults.aspx?docID=123', 'w', 1, 1, 0, 0, 0, 0]);
});

test('parseJsCall: editorAssignment with booleans', () => {
  const c = P.parseJsCall("javascript:editorAssignment(123, false, false, true, false, false, 'abc')");
  assert.deepEqual(c.args, [123, false, false, true, false, false, 'abc']);
});

test('parseJsCall: escaped quotes, void wrapper, double quotes', () => {
  assert.deepEqual(P.parseJsCall("javascript:f('a\\'b', \"c,d\")").args, ["a'b", 'c,d']);
  assert.deepEqual(P.parseJsCall("javascript:void(openCenterWinPercentage('u','n',1))").args, ['u', 'n', 1]);
});

test('parseJsCall: non-calls', () => {
  assert.equal(P.parseJsCall('EditorDecision.aspx?docid=1'), null);
  assert.equal(P.parseJsCall(''), null);
  assert.equal(P.parseJsCall("javascript:document.location.href='x'"), null);
});

test('parsePercent', () => {
  assert.equal(P.parsePercent('(12%)'), 12);
  assert.equal(P.parsePercent(' 7 % '), 7);
  assert.equal(P.parsePercent('n/a'), null);
});

test('manuscript numbers and revisions', () => {
  assert.ok(P.isMsNumber('PR-D-26-00001'));
  assert.ok(P.isMsNumber('PR-D-26-00001R2'));
  assert.ok(!P.isMsNumber('TITLE'));
  assert.equal(P.msRevision('PR-D-26-00001'), 0);
  assert.equal(P.msRevision('PR-D-26-00001R2'), 2);
});

test('classifyActionLink', () => {
  assert.equal(
    P.classifyActionLink('Similarity Check Results', "javascript:openCenterWin('DotNetPopUps/SimilarityCheckResults.aspx?docID=1&msid=m','w',1,1,0,0,0,0);").similarityUrl,
    'https://www.editorialmanager.com/pr/DotNetPopUps/SimilarityCheckResults.aspx?docID=1&msid=m');
  const d = P.classifyActionLink('Details', "javascript:popupDetailsWindow(5, 'PR-D-26-00001', '42')").details;
  assert.equal(d.docId, '5');
  assert.equal(d.url, 'https://www.editorialmanager.com/pr/EMDetails.aspx?docid=5&ms_num=PR-D-26-00001&sectionID=42');
  assert.deepEqual(P.classifyActionLink('Unassign Editor', "javascript:undoEditorAssignment(5, 'x')"), {});
});

test('summarizeDuplicates: thresholds', () => {
  const ok = P.summarizeDuplicates(50, [{ ms: 'a', titleSim: 70, abstractSim: 70 }]);
  assert.equal(ok.ok, true);
  const badScore = P.summarizeDuplicates(51, []);
  assert.equal(badScore.ok, false);
  const badRow = P.summarizeDuplicates(10, [{ ms: 'a', titleSim: 10, abstractSim: 71 }, { ms: 'b', titleSim: 5, abstractSim: 5 }]);
  assert.equal(badRow.ok, false);
  assert.deepEqual(badRow.flagged, ['a']);
  assert.equal(badRow.maxAbstract, 71);
  assert.equal(P.summarizeDuplicates(null, []).unknownScore, true);
});

test('roles', () => {
  assert.deepEqual(P.splitRoles('Software<br>Writing – review &amp; editing<br><br>'), ['Software', 'Writing – review & editing']);
  assert.equal(P.onlyReviewEditing(['Writing – review & editing']), true);
  assert.equal(P.onlyReviewEditing(['Writing - Review & Editing']), true);
  assert.equal(P.onlyReviewEditing(['Software', 'Writing – review & editing']), false);
  assert.equal(P.onlyReviewEditing([]), false);
});

test('summarizeDuplicates: repeated candidates count once', () => {
  const rows = [
    { ms: 'a', titleSim: 90, abstractSim: 10 },
    { ms: 'a', titleSim: 90, abstractSim: 10 },
    { ms: 'b', titleSim: 5, abstractSim: 5 },
  ];
  const s = P.summarizeDuplicates(20, rows);
  assert.equal(s.candidates, 2);
  assert.deepEqual(s.flagged, ['a']);
  assert.equal(s.maxTitle, 90);
});

// ---- CRediT (docs/credit-rules.md, test cases A–G) ----
const ALL = P.CREDIT_ROLES.map(([n]) => n);
const RE = 'Writing – review & editing';
const OD = 'Writing – original draft';
const au = (order, roles, name) => ({ order: String(order), name: name || 'NAME ' + order, roles });
const credit = (list) => P.creditAssessment(list);

test('CRediT: role normalization and classes', () => {
  assert.deepEqual(P.classifyRole('writing - Review and Editing'), { name: RE, cls: 'writing' });
  assert.deepEqual(P.classifyRole('  Data   curation '), { name: 'Data curation', cls: 'substantive' });
  assert.deepEqual(P.classifyRole('Writing — original draft'), { name: OD, cls: 'writing' });
  assert.equal(P.classifyRole('Project administration').cls, 'support');
  assert.deepEqual(P.classifyRole('Coffee'), { name: 'Coffee', cls: 'unknown' });
  assert.equal(P.CREDIT_ROLES.length, 14);
});

test('CRediT case A: one author has all roles, 2–6 review & editing only -> RED', () => {
  const c = credit([au(1, ALL), au(2, [RE]), au(3, [RE]), au(4, [RE]), au(5, [RE]), au(6, [RE])]);
  assert.equal(c.level, 'red');
  assert.equal(c.deficient.length, 5);
  assert.ok(c.authors[0].allRoles);
  const t = P.creditRedText(c);
  assert.match(t, /Authors NAME 2, NAME 3, NAME 4, NAME 5 and NAME 6 are listed only under "Writing – review & editing"\./);
  assert.match(t, /Author NAME 1 is listed under all contributor roles, including Supervision and Funding acquisition\./);
  assert.match(t, /Acknowledgements/);
  assert.doesNotMatch(t, /Author \d/); // names, never numbers
});

test('CRediT case B: support-only + writing-only -> RED, plus no original draft', () => {
  const c = credit([
    au(1, ['Data curation', 'Formal analysis', 'Methodology', 'Software']),
    au(2, ['Funding acquisition', 'Validation', 'Visualization']),
    au(3, ['Conceptualization']), au(4, ['Investigation']),
    au(5, ['Funding acquisition', 'Resources']), au(6, [RE]),
    au(7, ['Conceptualization', 'Project administration']),
  ]);
  assert.equal(c.level, 'red');
  assert.deepEqual(c.deficient.map((a) => [a.name, a.kind]), [['NAME 5', 'supportOnly'], ['NAME 6', 'writingOnly']]);
  assert.ok(c.noOriginalDraft);
  const t = P.creditRedText(c);
  assert.match(t, /NAME 5 \("Funding acquisition" and "Resources"\); NAME 6 \("Writing – review & editing"\)/);
  assert.match(t, /No author is listed under "Writing – original draft"/);
});

const caseC = () => [au(1, ['Methodology', OD]), au(2, ['Formal analysis']), au(3, ['Formal analysis']), au(4, ['Investigation', RE]), au(5, ['Methodology'])];

test('CRediT case C: noWriting is informational only -> GREEN', () => {
  const c = credit(caseC());
  assert.equal(c.level, 'green');
  assert.deepEqual(c.authors.filter((a) => a.noWriting).map((a) => a.order), ['2', '3', '5']);
  assert.equal(P.creditText(c), '');
});

test('CRediT case D: one support-only author -> YELLOW', () => {
  const list = caseC();
  list[4] = au(5, ['Funding acquisition', 'Supervision']);
  const c = credit(list);
  assert.equal(c.level, 'yellow');
  assert.equal(P.creditYellowText(c), 'CRediT note: NAME 5 has support roles only (Funding acquisition, Supervision). Not blocking; the authors may be asked to complete the statement at revision.');
});

test('CRediT case E: nobody has original draft -> YELLOW', () => {
  const list = caseC();
  list[0] = au(1, ['Methodology']);
  const c = credit(list);
  assert.equal(c.level, 'yellow');
  assert.match(P.creditText(c), /no author credited with Writing – original draft/);
});

test('CRediT case F: an author with no roles -> RED', () => {
  const c = credit([au(1, ['Conceptualization', OD]), au(2, [])]);
  assert.equal(c.level, 'red');
  assert.match(P.creditRedText(c), /No contributor roles are provided for author NAME 2\./);
});

test('CRediT case G: single author without a substantial role -> RED', () => {
  const c = credit([au(1, [OD])]);
  assert.equal(c.level, 'red');
  assert.match(P.creditRedText(c), /Please specify your substantial contribution/);
});

test('CRediT: no statement at all, unknown roles', () => {
  const c = credit([au(1, []), au(2, [])]);
  assert.equal(c.level, 'red');
  assert.ok(c.noCredit);
  assert.match(P.creditRedText(c), /No contributor roles are provided for any author/);
  const u = P.creditAuthor(au(1, ['Coffee', RE]));
  assert.ok(u.noSubstantive);
  assert.deepEqual(P.creditAuthorFlags(u), ['no substantial contribution', 'unrecognized role: Coffee']);
});

test('msColor: stable per manuscript, different across manuscripts', () => {
  assert.equal(P.msColor('PR-D-26-00001'), P.msColor('PR-D-26-00001'));
  assert.notEqual(P.msColor('PR-D-26-00001'), P.msColor('PR-D-26-00002R1'));
  assert.match(P.msColor('PR-D-26-00001'), /^hsl\(\d+, 55%, 30%\)$/);
});
