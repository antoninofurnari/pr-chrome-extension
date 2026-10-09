// End-to-end smoke test: loads the unpacked extension in Chromium and serves
// synthetic fixtures in place of www.editorialmanager.com (no real request
// leaves the machine: every EM/Turnitin URL is intercepted).
// Needs Playwright (not a project dependency):
//   NODE_PATH="$(npm root -g)" node test/e2e/smoke.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = path.join(ROOT, 'test', 'fixtures');
const fx = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');

const TOP = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>EM</title>
<script>
  window.editorAssignment = function () { window.__assignCalls = (window.__assignCalls || 0) + 1; };
</script></head><body><div id="header">EM header</div>
<iframe id="content" name="content" src="NewAssignments.aspx" style="width:100%;height:600px"></iframe></body></html>`;
const LIST_SCRIPT = `<script>
  window.editorAssignment = function () { window.__assignCalls = (window.__assignCalls || 0) + 1; };
  window.openCenterWin = function () {};
</script>`;
const EVAL = `<!DOCTYPE html><html><body><iframe id="iframe_msa" src="https://mfe-ux.triage.elsevier.com/index.html?token=x"></iframe></body></html>`;

const pages = {
  'default2.aspx': TOP,
  'NewAssignments.aspx': fx('new-assignments.html').replace('</head>', LIST_SCRIPT + '</head>'),
  'DuplicateSubmissionCheckResults.aspx': fx('duplicate.html'),
  'DotNetPopUps/SimilarityCheckResults.aspx': fx('similarity.html'),
  'EMDetails.aspx': fx('details.html'),
  'ContributingAuthorStatus.aspx': fx('author-status.html'),
  'ViewEvaluateManuscript.aspx': EVAL,
};

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preh-e2e-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: true,
  permissions: ['clipboard-read', 'clipboard-write'],
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
});

let failures = 0;
const check = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) failures++; };

await ctx.route('https://www.editorialmanager.com/**', (route) => {
  const u = new URL(route.request().url());
  const p = u.pathname.replace(/^\/pr\//, '');
  // The real page 302s to Turnitin. Playwright does not intercept a redirect's
  // target inside an iframe (it would go to the network), so serve a stand-in.
  if (p === 'CrossCheckResults.aspx') {
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>stand-in for the Turnitin report</h1>' });
  }
  if (route.request().method() !== 'GET') {
    check(false, 'non-GET request to EM: ' + route.request().method() + ' ' + p);
    return route.abort();
  }
  if (pages[p]) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pages[p] });
  return route.fulfill({ status: 404, body: 'not in fixtures' });
});
await ctx.route('https://mfe-ux.triage.elsevier.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>mfe</p>' }));

// Service worker
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
check(!!sw, 'service worker running');
execFileSync(path.join(ROOT, 'scripts', 'stamp.sh'));
await sw.evaluate(() => chrome.storage.local.set({ 'preh:dev': true }));

const page = await ctx.newPage();
page.on('pageerror', (e) => check(false, 'page error: ' + e.message));
await page.goto('https://www.editorialmanager.com/pr/default2.aspx');

// ---- M1: badges and popover on the list ----
const list = page.frame({ name: 'content' });
await list.waitForSelector('.preh-badge');
check(await list.locator('.preh-badge').count() === 2, 'M1: one badge per row');
check(await page.locator('.preh-badge').count() === 0, 'M1: no badge in the top window');
await list.locator('.preh-badge[data-ms="PR-D-26-00001"] .preh-chip').click();
await list.waitForSelector('.preh-popover');
await list.selectOption('.preh-pop-status', 'Waiting (reply)');
await list.fill('.preh-pop-note', 'synthetic note');
await page.waitForTimeout(600);
await list.locator('.preh-pop-note').press('Escape');
check(await list.locator('.preh-popover').count() === 0, 'M1: Esc closes the popover');
const chip1 = list.locator('.preh-badge[data-ms="PR-D-26-00001"] .preh-chip');
check(await chip1.textContent() === 'Waiting · 0d', 'M1: chip shows Waiting · 0d');
check(await list.locator('.preh-badge[data-ms="PR-D-26-00001"] .preh-note-icon.preh-has-note').count() === 1, 'M1: note icon marked');
const stored = await sw.evaluate(() => chrome.storage.local.get('ms:PR-D-26-00001'));
const rec = stored['ms:PR-D-26-00001'];
check(rec && rec.status === 'Waiting (reply)' && rec.note === 'synthetic note' && !!rec.statusAt, 'M1: record saved under ms:<number>');
await sw.evaluate(() => chrome.storage.local.get('ms:PR-D-26-00001').then((r) => {
  const v = r['ms:PR-D-26-00001'];
  v.statusAt = new Date(Date.now() - 4 * 86400000 - 1000).toISOString();
  return chrome.storage.local.set({ 'ms:PR-D-26-00001': v });
}));
await page.waitForTimeout(300);
check(await chip1.textContent() === 'Waiting · 4d', 'M1: waiting age in days (live update from storage)');
// Toggle: clicking the same badge twice closes the popover.
await list.locator('.preh-badge[data-ms="PR-D-26-00002R1"] .preh-chip').click();
await list.waitForSelector('.preh-popover');
await list.locator('.preh-badge[data-ms="PR-D-26-00002R1"] .preh-chip').click();
await page.waitForTimeout(200);
check(await list.locator('.preh-popover').count() === 0, 'M1: second click on the badge closes the popover');
// Survives a reload of iframe#content.
await list.goto('https://www.editorialmanager.com/pr/NewAssignments.aspx');
await list.waitForSelector('.preh-badge');
await page.waitForTimeout(300);
check(await list.locator('.preh-badge[data-ms="PR-D-26-00001"] .preh-chip').textContent() === 'Waiting · 4d', 'M1: state persists after iframe reload');
check(await list.locator('.preh-badge').count() === 2, 'M1: no duplicate badges after reload');

// ---- F3: export / import from the popup page ----
const extId = new URL(sw.url()).host;
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html?tab=1`);
await popup.waitForFunction(() => document.getElementById('count').textContent === '1');
check(true, 'F3: popup counts 1 record');
await popup.waitForFunction(() => /^\d+$/.test(document.getElementById('build').textContent));
check(true, 'popup shows the build stamp');
check(await popup.inputValue('#recipient') === 'Sami' && await popup.inputValue('#signature') === 'Antonino', 'popup: email settings defaults');
const [download] = await Promise.all([popup.waitForEvent('download'), popup.click('#export')]);
const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
check(exported.format === 'preh-notes-v1' && exported.records['PR-D-26-00001'].note === 'synthetic note', 'F3: export contains the record');
exported.records['PR-D-26-00002R1'] = { status: 'Done', note: 'imported', updatedAt: new Date().toISOString() };
const importFile = path.join(userDataDir, 'import.json');
fs.writeFileSync(importFile, JSON.stringify(exported));
await popup.setInputFiles('#file', importFile);
await popup.waitForFunction(() => /Imported/.test(document.getElementById('msg').textContent));
check(/Imported 1 records/.test(await popup.textContent('#msg')), 'F3: import writes only newer/missing records');
await popup.close();
await page.waitForTimeout(300);
check(await list.locator('.preh-badge[data-ms="PR-D-26-00002R1"] .preh-chip').textContent() === 'Done', 'F3: imported status shown on the list');


// ---- M2: cockpit ----
// Each Triage opens its own tab (EM's default2.aspx + cockpit).
let tp = null;
let cockpit = null;
const sum = (title) => cockpit.locator('.preh-panel', { hasText: title }).locator('.preh-sum');
async function openTriage(ms) {
  const [p] = await Promise.all([ctx.waitForEvent('page'), list.locator(`.preh-badge[data-ms="${ms}"] .preh-triage-btn`).click()]);
  p.on('pageerror', (e) => check(false, 'page error (triage tab): ' + e.message));
  tp = p;
  cockpit = tp.locator('.preh-cockpit');
  await cockpit.waitFor();
  await tp.bringToFront();
  return tp;
}
await openTriage('PR-D-26-00001');
check(tp.url() === 'https://www.editorialmanager.com/pr/default2.aspx', 'tabs: triage opens EM in a new tab (no manuscript data in the URL)');
check(await page.locator('.preh-cockpit').count() === 0, 'tabs: the list tab stays as it is');
check(await tp.title() === 'PR-D-26-00001 · Triage', 'tabs: tab title is the manuscript number');
check(await tp.evaluate(() => window.opener === null), 'tabs: opened with noopener');
const color1 = await cockpit.locator('.preh-cockpit-bar').evaluate((e) => e.style.background);
check(color1 === await list.locator('.preh-badge[data-ms="PR-D-26-00001"] .preh-triage-btn').evaluate((e) => e.style.background),
  'tabs: the list Triage button has the same colour as the triage header');
check(await cockpit.locator('.preh-cockpit-ms').textContent() === 'PR-D-26-00001', 'M2: header shows the manuscript number');
check(await cockpit.locator('.preh-cockpit-status').inputValue() === 'Waiting (reply)', 'M2: header status loaded from storage');
// Left: Similarity -> CrossCheckResults -> (fake) Turnitin
await tp.waitForFunction(() => {
  const f = document.querySelector('iframe[name="preh-similarity"]');
  try { return f && /CrossCheckResults/.test(f.contentWindow.location.href) && f.contentDocument.readyState === 'complete'; } catch (_) { return false; }
}, null, { timeout: 5000 });
check(tp.frame({ name: 'preh-similarity' }).url() ===
  'https://www.editorialmanager.com/pr/CrossCheckResults.aspx?docID=100001&msid=%7BAAA-111%7D&APISubmissionID=api-0000-1111',
  'M2: left pane loads CrossCheckResults.aspx with the APISubmissionID from the Similarity page');
// Duplicate summary (computed from the iframe)
await tp.waitForFunction(() => /title/.test(document.querySelector('.preh-cockpit .preh-panel .preh-sum').textContent));
check(await sum('Duplicate').textContent() === 'EM 35% · title 82% · abstract 71% · 2 > 70%', 'M2: duplicate summary');
check(/preh-sum-bad/.test(await sum('Duplicate').getAttribute('class')), 'M2: duplicate summary is red');
// Author Status (Details GET -> iframe)
await tp.waitForFunction(() => /authors/.test([...document.querySelectorAll('.preh-cockpit .preh-panel .preh-sum')][1].textContent));
check(await sum('Author Status').textContent() === 'CRediT: RED · 4 authors · 1 without roles · 1 without substantial contribution', 'CRediT: panel badge');
check(/preh-sum-bad/.test(await sum('Author Status').getAttribute('class')), 'CRediT: RED shown in red');
{
  const det = cockpit.locator('.preh-credit');
  const rows = det.locator('.preh-credit-row');
  check(await rows.count() === 4 && await rows.nth(0).locator('.preh-credit-name').textContent() === '1. NAME B' &&
    await rows.nth(1).locator('.preh-credit-name').textContent() === '2. NAME A', 'CRediT: one line per author, sorted by Order');
  check(await rows.nth(0).locator('.preh-role-writing').count() === 1 && /no substantial contribution \(writing only\)/.test(await rows.nth(0).textContent()),
    'CRediT: roles as chips by class, flags in words');
  check(await rows.nth(1).locator('.preh-role-substantive').count() === 2, 'CRediT: substantive chips');
  check(/no roles/.test(await rows.nth(3).textContent()), 'CRediT: no roles flag');
  const outA = det.locator('.preh-credit-out', { hasText: '(A) Comments to authors' });
  await outA.locator('button', { hasText: /^Copy$/ }).click();
  await tp.waitForTimeout(300);
  const clip = await tp.evaluate(() => navigator.clipboard.readText());
  check(clip.startsWith('We noticed some issues with the author contribution (CRediT) statement of your manuscript. NAME B is listed only under "Writing – review & editing". No contributor roles are listed for NAME D.\n\nAuthors are free to choose their CRediT roles') &&
    clip.endsWith('both in Editorial Manager and in the manuscript? Please also make sure that contributor roles are provided for all authors.'), 'CRediT: (A) comments to authors copied');
  check(await outA.locator('.preh-credit-preview').inputValue() === clip, 'CRediT: (A) preview matches the copied text');
  const outB = det.locator('.preh-credit-out', { hasText: '(B) Email to the Journal Manager' });
  await outB.locator('button', { hasText: 'Copy subject' }).click();
  await tp.waitForTimeout(300);
  check(await tp.evaluate(() => navigator.clipboard.readText()) === 'PR-D-26-00001 – Send back to authors (CRediT statement)', 'CRediT: (B) subject');
  await outB.locator('button', { hasText: /^Copy$/ }).click();
  await tp.waitForTimeout(300);
  const mail = await tp.evaluate(() => navigator.clipboard.readText());
  check(mail.startsWith('Dear Sami,\n\nDuring the initial assessment of manuscript PR-D-26-00001') && mail.includes('---\n' + clip + '\n---') && mail.endsWith('Thank you,\nAntonino'), 'CRediT: (B) email wraps (A)');
  check(!(await det.locator('.preh-credit-other .preh-credit-out', { hasText: '(C) Note to the AE' }).isVisible()), 'CRediT: (C) available under "Other texts" (closed)');
}
check(await tp.frame({ name: 'preh-authors' }).url().includes('ContributingAuthorStatus.aspx'), 'M2: author panel shows Author Status');
// Evaluate: collapsed and not loaded until opened
check(await tp.locator('iframe[name="preh-evaluate"]').count() === 0, 'M2: Evaluate not loaded while collapsed');
check(await sum('Evaluate').textContent() === 'warning icon: no', 'M2: evaluate warning summary');
await cockpit.locator('.preh-panel-head', { hasText: 'Evaluate' }).click();
await tp.waitForSelector('iframe[name="preh-evaluate"]');
await tp.waitForFunction(() => { try { return !!document.querySelector('iframe[name="preh-evaluate"]').contentDocument.querySelector('#iframe_msa'); } catch (_) { return false; } });
check(true, 'M2: Evaluate loads on expand (with inner iframe)');
// No content-script UI inside the cockpit's own iframes
check(await tp.frame({ name: 'preh-duplicate' }).locator('.preh-badge, .preh-cockpit').count() === 0, 'M2: no extension UI inside panel iframes');
// Resizable left pane: drag the divider to ~70%, width is remembered.
const leftPct = () => tp.evaluate(() => {
  const m = document.querySelector('.preh-cockpit-main').getBoundingClientRect();
  return Math.round(document.querySelector('.preh-left').getBoundingClientRect().width / m.width * 100);
});
check(await leftPct() === 55, 'resize: default left width 55%');
const mainBox = await cockpit.locator('.preh-cockpit-main').boundingBox();
const bar = await cockpit.locator('.preh-splitter').boundingBox();
await tp.mouse.move(bar.x + 3, bar.y + bar.height / 2);
await tp.mouse.down();
await tp.mouse.move(mainBox.x + mainBox.width * 0.5, bar.y + 100, { steps: 3 }); // passes over iframes
await tp.mouse.move(mainBox.x + mainBox.width * 0.7, bar.y + 100, { steps: 5 });
await tp.mouse.up();
const dragged = await leftPct();
check(dragged >= 69 && dragged <= 71, `resize: drag sets left width (~70%, got ${dragged}%)`);
check((await sw.evaluate(() => chrome.storage.local.get('preh:leftWidth')))['preh:leftWidth'] === 70, 'resize: width saved');
// Maximize hides the panels without reloading them.
await tp.frame({ name: 'preh-duplicate' }).evaluate(() => { window.__keep = 1; });
await cockpit.locator('button', { hasText: 'Maximize report' }).click();
check(!(await cockpit.locator('.preh-right').isVisible()) && await tp.evaluate(() => {
  const m = document.querySelector('.preh-cockpit-main').getBoundingClientRect().width;
  const l = document.querySelector('.preh-left').getBoundingClientRect().width;
  const c = document.querySelector('.preh-checklist').getBoundingClientRect().width;
  return Math.abs(m - l - c) < 2;
}), 'maximize: left pane takes all the width next to the checklist');
await cockpit.locator('button', { hasText: 'Show panels' }).click();
check(await leftPct() === 70 && await cockpit.locator('.preh-right').isVisible(), 'maximize: Show panels restores the layout');
check(await tp.frame({ name: 'preh-duplicate' }).evaluate(() => window.__keep) === 1, 'maximize: panels not reloaded');
// ---- M3: checklist ----
const drawer = cockpit.locator('.preh-checklist');
check(await drawer.locator('input[type=checkbox]').count() === 11, 'M3: 11 checklist items');
check(await drawer.locator('.preh-step', { hasText: '2 · Duplicate check' }).locator('.preh-sum').textContent() === 'EM 35% · title 82% · abstract 71% · 2 > 70%', 'M3: duplicate summary mirrored next to step 2');
check(await drawer.locator('.preh-step', { hasText: '3 · Author Status' }).locator('.preh-sum').textContent() === 'CRediT: RED · 4 authors · 1 without roles · 1 without substantial contribution', 'M3: author summary mirrored next to step 3');
// Insert CRediT note appends the standard text to the manuscript note
await drawer.locator('.preh-credit-btn').click();
await page.waitForTimeout(300);
const creditNote = await drawer.locator('.preh-checklist-note').inputValue();
check(creditNote.startsWith('synthetic note\n\nWe noticed some issues with the author contribution (CRediT) statement') && /No contributor roles are listed for NAME D\./.test(creditNote),
  'CRediT: (A) appended to the note');
check((await sw.evaluate(() => chrome.storage.local.get('ms:PR-D-26-00001')))['ms:PR-D-26-00001'].note === creditNote, 'CRediT: note saved');
await drawer.locator('.preh-checklist-note').fill('synthetic note');
await page.waitForTimeout(500);
await drawer.locator('input[data-id="s1_overlap"]').check();
await drawer.locator('input[data-id="s2_dup"]').check();
check(await drawer.locator('.preh-checklist-note').inputValue() === 'synthetic note', 'M3: checklist shows the list note');
// Step 5 is the status, set by hand, synced with the header and the list
await drawer.locator('.preh-checklist-status').selectOption('Ready to reject');
await page.waitForTimeout(300);
check(await cockpit.locator('.preh-cockpit-status').inputValue() === 'Ready to reject', 'M3: checklist status syncs the header');
check(await list.locator('.preh-badge[data-ms="PR-D-26-00001"] .preh-chip').textContent() === 'To reject', 'M3: and the list badge');
await cockpit.locator('.preh-cockpit-status').selectOption('Send back requested');
await page.waitForTimeout(300);
check(await drawer.locator('.preh-checklist-status').inputValue() === 'Send back requested', 'M3: header status syncs the checklist');
await drawer.locator('.preh-checklist-note').fill('Missing CRediT statement.');
await drawer.locator('.preh-copy').click();
await page.waitForTimeout(500);
check(await tp.evaluate(() => navigator.clipboard.readText()) === 'Missing CRediT statement.', 'M3: Copy puts the note on the clipboard');
check(await drawer.locator('.preh-checklist-head .preh-sum').textContent() === '2/11', 'M3: progress counter');
const rec3 = (await sw.evaluate(() => chrome.storage.local.get('ms:PR-D-26-00001')))['ms:PR-D-26-00001'];
check(rec3.checklist.s1_overlap === true && rec3.checklist.s2_dup === true && rec3.status === 'Send back requested' &&
  rec3.note === 'Missing CRediT statement.', 'M3: checklist, status and note saved');
check(await list.locator('.preh-badge[data-ms="PR-D-26-00001"] .preh-note-icon').getAttribute('title') === 'Missing CRediT statement.', 'M3: note visible on the list badge');
await cockpit.locator('button', { hasText: 'Checklist' }).click();
check(!(await drawer.isVisible()), 'M3: Checklist button hides the drawer');
await cockpit.locator('button', { hasText: 'Checklist' }).click();
check(await drawer.isVisible(), 'M3: and shows it again');
// Status in header -> list badge
await cockpit.locator('.preh-cockpit-status').selectOption('In triage');
await page.waitForTimeout(300);
check(await list.locator('.preh-badge[data-ms="PR-D-26-00001"] .preh-chip').textContent() === 'In triage', 'M2: header status updates the list badge');
// Assign Editor via MAIN-world bridge
await cockpit.locator('button', { hasText: 'Open Assign Editor' }).click();
await page.waitForTimeout(300);
check(await tp.evaluate(() => window.__assignCalls) === 1, 'M2: Open Assign Editor calls editorAssignment once (top window)');
// In a triage tab Esc does nothing (no accidental close); 'Close tab' closes it.
await tp.frame({ name: 'preh-duplicate' }).locator('body').press('Escape');
await tp.waitForTimeout(200);
check(await cockpit.count() === 1, 'tabs: Esc does not close the triage tab');
const firstTab = tp;
// Several triage tabs at once, each with its own colour
await openTriage('PR-D-26-00002R1');
check(!firstTab.isClosed() && ctx.pages().includes(firstTab), 'tabs: two triage tabs open at the same time');
check(await cockpit.locator('.preh-cockpit-bar', { hasText: 'Revision R1' }).count() === 1, 'M2: revision hint for R1');
const color2 = await cockpit.locator('.preh-cockpit-bar').evaluate((e) => e.style.background);
check(color1 && color2 && color1 !== color2, `tabs: header colour differs per manuscript (${color1} vs ${color2})`);
await firstTab.locator('.preh-cockpit button', { hasText: 'Close tab' }).click();
await page.waitForTimeout(300);
check(firstTab.isClosed(), 'tabs: Close tab closes the tab');
check(await list.locator('.preh-badge').count() === 2, 'M2: list unchanged');
check(await leftPct() === 70, 'resize: width remembered in the next cockpit');
await cockpit.locator('.preh-splitter').dblclick();
check(await leftPct() === 55, 'resize: double-click resets to 55%');
check(await sum('Evaluate').textContent() === 'warning icon: yes', 'M2: evaluate warning detected on row 2');
// Decision: navigates iframe#content and closes the cockpit
await cockpit.locator('button', { hasText: 'Open Decision page' }).click();
await tp.waitForTimeout(500);
check(await cockpit.count() === 0, 'M2: Open Decision page closes the cockpit');
check(tp.frame({ name: 'content' }).url().includes('/pr/EditorDecision.aspx?docid=100002'), 'M2: the triage tab shows EditorDecision.aspx');
check(page.frame({ name: 'content' }).url().endsWith('/pr/NewAssignments.aspx'), 'tabs: the list tab is untouched');
// Checklist state comes back when the triage is reopened
await openTriage('PR-D-26-00001');
check(await cockpit.locator('input[data-id="s1_overlap"]').isChecked() && !(await cockpit.locator('input[data-id="s1_scope"]').isChecked()) &&
  await cockpit.locator('.preh-checklist-note').inputValue() === 'Missing CRediT statement.', 'M3: checklist restored on reopen');
// The cockpit survives a reload of the triage tab
await tp.reload();
await cockpit.waitFor();
check(await cockpit.locator('.preh-cockpit-ms').textContent() === 'PR-D-26-00001', 'tabs: reloading the triage tab reopens the cockpit');
// A note typed right before closing is not lost, and shows in the list popover
await cockpit.locator('.preh-checklist-note').fill('Typed then Esc');
await cockpit.locator('button', { hasText: 'Close tab' }).click();
await page.waitForTimeout(300);
check((await sw.evaluate(() => chrome.storage.local.get('ms:PR-D-26-00001')))['ms:PR-D-26-00001'].note === 'Typed then Esc', 'M3: pending note flushed on close');
{
  const lf = page.frame({ name: 'content' });
  await lf.locator('.preh-badge[data-ms="PR-D-26-00001"] .preh-chip').click();
  await lf.waitForSelector('.preh-popover');
  check(await lf.locator('.preh-pop-note').inputValue() === 'Typed then Esc', 'M3: same note in the list popover');
  await lf.locator('.preh-pop-note').press('Escape');
}
// The old postMessage entry point is gone: a forged message opens nothing
await page.evaluate(() => window.postMessage({ type: 'preh:openCockpit', ms: 'PR-D-26-00001', similarityUrl: 'javascript:alert(1)' }, location.origin));
await page.waitForTimeout(200);
check(await page.locator('.preh-cockpit').count() === 0, 'tabs: forged postMessage opens nothing');

// Hot reload: change the stamp and expect the worker to call chrome.runtime.reload().
// Under Playwright (--load-extension) the reloaded extension does not come back,
// so the tab-reload half can only be verified with "Load unpacked" in real Chrome.
const swBefore = ctx.serviceWorkers().length;
execFileSync(path.join(ROOT, 'scripts', 'stamp.sh'));
const t0 = Date.now();
while (Date.now() - t0 < 6000 && ctx.serviceWorkers().length >= swBefore) await page.waitForTimeout(200);
check(ctx.serviceWorkers().length < swBefore, `hot reload: stamp change detected, chrome.runtime.reload() called after ${Date.now() - t0} ms`);

await ctx.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
