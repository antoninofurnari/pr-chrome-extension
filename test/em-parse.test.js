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

// ---- CRediT (docs/credit-rules.md, test cases A–G and golden texts §7.5) ----
const ALL = P.CREDIT_ROLES.map(([n]) => n);
const RE = 'Writing – review & editing';
const OD = 'Writing – original draft';
const au = (order, roles) => ({ order: String(order), name: `<NAME${order}>`, roles });
const credit = (list) => P.creditAssessment(list);
const FIXED = 'Authors are free to choose their CRediT roles, but these should reflect each author\'s actual contribution. According to the journal\'s authorship criteria, each author should have made a substantial contribution to the conception or design of the work, or to the acquisition, analysis or interpretation of data, and should have drafted the work or revised it critically for important intellectual content. Could you please check the contributor roles of all authors against these criteria and update the statement where needed, both in Editorial Manager and in the manuscript?';

const caseA = () => [au(1, ALL), au(2, [RE]), au(3, [RE]), au(4, [RE]), au(5, [RE]), au(6, [RE])];
const caseB = () => [
  au(1, ['Data curation', 'Formal analysis', 'Methodology', 'Software']),
  au(2, ['Funding acquisition', 'Validation', 'Visualization']),
  au(3, ['Conceptualization']), au(4, ['Investigation']),
  au(5, ['Funding acquisition', 'Resources']), au(6, [RE]),
  au(7, ['Conceptualization', 'Project administration']),
];
const caseC = () => [au(1, ['Methodology', OD]), au(2, ['Formal analysis']), au(3, ['Formal analysis']), au(4, ['Investigation', RE]), au(5, ['Methodology'])];

test('CRediT: role normalization and classes', () => {
  assert.deepEqual(P.classifyRole('writing - Review and Editing'), { name: RE, cls: 'writing' });
  assert.deepEqual(P.classifyRole('  Data   curation '), { name: 'Data curation', cls: 'substantive' });
  assert.deepEqual(P.classifyRole('Writing — original draft'), { name: OD, cls: 'writing' });
  assert.equal(P.classifyRole('Project administration').cls, 'support');
  assert.deepEqual(P.classifyRole('Coffee'), { name: 'Coffee', cls: 'unknown' });
  assert.equal(P.CREDIT_ROLES.length, 14);
});

test('CRediT case A -> RED, golden (A)', () => {
  const c = credit(caseA());
  assert.equal(c.level, 'red');
  assert.equal(c.deficient.length, 5);
  assert.equal(P.creditCommentsText(c),
    'We noticed some issues with the author contribution (CRediT) statement of your manuscript. <NAME2>, <NAME3>, <NAME4>, <NAME5> and <NAME6> are listed only under "Writing – review & editing". At the same time, <NAME1> is listed under almost all contributor roles, including "Funding acquisition" and "Supervision".\n\n' + FIXED);
});

test('CRediT case B -> RED + noOriginalDraft, golden (A)', () => {
  const c = credit(caseB());
  assert.equal(c.level, 'red');
  assert.deepEqual(c.deficient.map((a) => [a.name, a.kind]), [['<NAME5>', 'supportOnly'], ['<NAME6>', 'writingOnly']]);
  assert.equal(P.creditCommentsText(c),
    'We noticed some issues with the author contribution (CRediT) statement of your manuscript. <NAME5> is listed only under "Funding acquisition" and "Resources", and <NAME6> only under "Writing – review & editing". In addition, no author is listed under "Writing – original draft".\n\n' +
    FIXED + ' Please also make sure that the author(s) who drafted the manuscript are listed under "Writing – original draft".');
});

test('CRediT case B -> (B) email wraps (A), Antonino\'s template', () => {
  const c = credit(caseB());
  const e = P.creditEmail(c, '<MS>');
  assert.equal(e.subject, '<MS> – Send back to authors (CRediT statement)');
  assert.equal(e.body,
    'Dear Sami,\n\nDuring the initial assessment of manuscript <MS>, I noticed an issue with the author contribution (CRediT) statement that should be addressed before the manuscript can proceed to peer review. Could you please send it back to the authors with the comments below?\n\n' +
    '--- Comments to authors ---\n' + P.creditCommentsText(c) + '\n---\n\n' +
    'Once the authors resubmit, please assign the manuscript back to me so that I can complete the assessment.\n\nThank you very much,\nAntonino');
  const e2 = P.creditEmail(c, '<MS>', { recipient: 'X', signature: 'Y' });
  assert.ok(e2.body.startsWith('Dear X,') && e2.body.endsWith('Thank you very much,\nY'));
});

test('mailtoUrl: address, subject and body encoded, CRLF line breaks', () => {
  const u = P.mailtoUrl('jm@example.org', 'A – B (C)', 'Dear X,\n\n"quoted" & 100%');
  assert.equal(u, 'mailto:jm@example.org?subject=A%20%E2%80%93%20B%20(C)&body=Dear%20X%2C%0D%0A%0D%0A%22quoted%22%20%26%20100%25');
  assert.ok(P.mailtoUrl('', 's', 'b').startsWith('mailto:?subject='));
});

test('CRediT case C -> GREEN, no texts', () => {
  const c = credit(caseC());
  assert.equal(c.level, 'green');
  assert.deepEqual(c.authors.filter((a) => a.noWriting).map((a) => a.order), ['2', '3', '5']);
  assert.equal(P.creditText(c), '');
});

test('CRediT case D -> YELLOW, golden (C)', () => {
  const list = caseC();
  list[4] = au(5, ['Funding acquisition', 'Supervision']);
  const c = credit(list);
  assert.equal(c.level, 'yellow');
  assert.equal(P.creditAeNote(c),
    'A note on the CRediT statement, not blocking at triage: <NAME5> is listed only under "Funding acquisition" and "Supervision". It would be good to ask the authors to complete it at the first revision.');
});

test('CRediT case E -> YELLOW (noOriginalDraft as the only issue)', () => {
  const list = caseC();
  list[0] = au(1, ['Methodology']);
  const c = credit(list);
  assert.equal(c.level, 'yellow');
  assert.equal(P.creditAeNote(c), 'A note on the CRediT statement, not blocking at triage: No author is listed under "Writing – original draft". It would be good to ask the authors to complete it at the first revision.');
});

test('CRediT case F -> RED (noRoles)', () => {
  const c = credit([au(1, ['Conceptualization', OD]), au(2, [])]);
  assert.equal(c.level, 'red');
  assert.equal(P.creditCommentsText(c),
    'We noticed an issue with the author contribution (CRediT) statement of your manuscript. No contributor roles are listed for <NAME2>.\n\n' +
    FIXED + ' Please also make sure that contributor roles are provided for all authors.');
});

test('CRediT case G -> RED (single author without a substantial role)', () => {
  const c = credit([au(1, [OD])]);
  assert.equal(c.level, 'red');
  assert.match(P.creditCommentsText(c), /^We noticed an issue with .*\. <NAME1> is listed only under "Writing – original draft"\.\n\n/);
});

test('CRediT: three groups, no statement at all, unknown roles', () => {
  const c = credit([au(1, ['Methodology', OD]), au(2, [RE]), au(3, ['Supervision']), au(4, [RE]), au(5, ['Resources', RE])]);
  assert.equal(P.creditIssues(c).sentences[0],
    '<NAME2> and <NAME4> are listed only under "Writing – review & editing", <NAME3> only under "Supervision", and <NAME5> only under "Resources" and "Writing – review & editing".');
  const none = credit([au(1, []), au(2, [])]);
  assert.ok(none.noCredit && none.level === 'red');
  assert.equal(P.creditCommentsText(none),
    'We noticed that the author contribution (CRediT) statement is missing.\n\n' + FIXED + ' Please also make sure that contributor roles are provided for all authors.');
  const u = P.creditAuthor(au(1, ['Coffee', RE]));
  assert.ok(u.noSubstantive);
  assert.deepEqual(P.creditAuthorFlags(u), ['no substantial contribution', 'unrecognized role: Coffee']);
});

test('CRediT texts never mention the Acknowledgements or use "and/or"', () => {
  for (const list of [caseA(), caseB()]) {
    const t = P.creditCommentsText(credit(list));
    assert.doesNotMatch(t, /Acknowledgements|and\/or/);
  }
});

test('msColor: stable per manuscript, different across manuscripts', () => {
  assert.equal(P.msColor('PR-D-26-00001'), P.msColor('PR-D-26-00001'));
  assert.notEqual(P.msColor('PR-D-26-00001'), P.msColor('PR-D-26-00002R1'));
  assert.match(P.msColor('PR-D-26-00001'), /^hsl\(\d+, 55%, 30%\)$/);
});
