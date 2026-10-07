// DOM tests: run em-parse.js against the synthetic fixtures in a real browser.
// Needs Playwright (not a project dependency). Skipped when it can't be loaded.
//   NODE_PATH="$(npm root -g)" node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch (_) { /* skipped below */ }

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const parserSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'content', 'em-parse.js'), 'utf8');

test('em-parse DOM functions on fixtures', { skip: !chromium && 'playwright not available' }, async (t) => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: parserSrc });
  const run = (fn, html) => page.evaluate(([fnName, src]) => {
    const doc = new DOMParser().parseFromString(src, 'text/html');
    const P = globalThis.PREH.parse;
    if (fnName === 'parseGrid') {
      return P.parseGrid(doc).map((r) => ({ ...r, actionRow: !!r.actionRow, dataRow: !!r.dataRow }));
    }
    return P[fnName](doc);
  }, [fn, html]);

  try {
    await t.test('parseGrid', async () => {
      const rows = await run('parseGrid', fixture('new-assignments.html'));
      assert.equal(rows.length, 2);
      const [a, b] = rows;
      assert.equal(a.docId, '100001');
      assert.equal(a.ms, 'PR-D-26-00001');
      assert.equal(a.revision, 0);
      assert.equal(a.possibleDuplicate, false);
      assert.equal(a.actions.similarityPct, 12);
      assert.equal(a.actions.duplicateScore, 35);
      assert.equal(a.actions.duplicateUrl, 'https://www.editorialmanager.com/pr/DuplicateSubmissionCheckResults.aspx?docID=100001');
      assert.equal(a.actions.similarityUrl, 'https://www.editorialmanager.com/pr/DotNetPopUps/SimilarityCheckResults.aspx?docID=100001&msid={AAA-111}');
      assert.equal(a.actions.evaluateUrl, 'https://www.editorialmanager.com/pr/ViewEvaluateManuscript.aspx?displayName=X&docId=100001');
      assert.equal(a.actions.decisionUrl, 'https://www.editorialmanager.com/pr/EditorDecision.aspx?docid=100001&msid={AAA-111}&CurrentRow=1&CurrentPage=1');
      assert.equal(a.actions.details.ms, 'PR-D-26-00001');
      assert.deepEqual(a.actions.assignEditorArgs, [100001, false, false, false, false, false, 'sess-1']);
      assert.equal(a.actions.evaluateWarning.present, false);
      assert.equal(b.revision, 1);
      assert.equal(b.possibleDuplicate, true);
      assert.equal(b.actions.duplicateScore, 64);
      assert.equal(b.actions.similarityPct, 41);
      assert.equal(b.actions.evaluateWarning.present, true);
    });

    await t.test('parseDuplicatePage + summary', async () => {
      const rows = await run('parseDuplicatePage', fixture('duplicate.html'));
      assert.deepEqual(rows, [
        { ms: 'PR-D-25-00010', titleSim: 82, authorSim: 40, abstractSim: 30 },
        { ms: 'PR-D-24-00020', titleSim: 12, authorSim: 5, abstractSim: 71 },
        { ms: 'PR-D-23-00030', titleSim: 70, authorSim: 0, abstractSim: 10 },
      ]);
    });

    await t.test('parseSimilarityPage', async () => {
      const r = await run('parseSimilarityPage', fixture('similarity.html'));
      assert.equal(r.apiSubmissionId, 'api-0000-1111');
      assert.equal(r.reportUrl, 'https://www.editorialmanager.com/pr/CrossCheckResults.aspx?docID=100001&msid=%7BAAA-111%7D&APISubmissionID=api-0000-1111');
    });

    await t.test('parseDetailsPage', async () => {
      const r = await run('parseDetailsPage', fixture('details.html'));
      assert.equal(r.authorStatusUrl, 'https://www.editorialmanager.com/pr/ContributingAuthorStatus.aspx?docID=100001&msid={AAA-111}&revision=0');
    });

    await t.test('parseAuthorStatusPage', async () => {
      const a = await run('parseAuthorStatusPage', fixture('author-status.html'));
      assert.equal(a.length, 4);
      assert.equal(a[0].corresponding, true);
      assert.deepEqual(a[0].roles, ['Conceptualization', 'Methodology', 'Writing – original draft']);
      assert.equal(a[1].onlyReviewEditing, true);
      assert.equal(a[1].confirmed, 'No Response');
      assert.equal(a[2].onlyReviewEditing, false);
      assert.equal(a[3].noRoles, true);
    });
  } finally {
    await browser.close();
  }
});
