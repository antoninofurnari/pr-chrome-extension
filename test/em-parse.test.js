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
