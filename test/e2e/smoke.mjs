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
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
});

let failures = 0;
const check = (cond, label) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) failures++; };

await ctx.route('https://www.editorialmanager.com/**', (route) => {
  const u = new URL(route.request().url());
  const p = u.pathname.replace(/^\/pr\//, '');
  if (p === 'CrossCheckResults.aspx') {
    return route.fulfill({ status: 302, headers: { location: 'https://elsevier.turnitin.com/viewer/submissions/x' } });
  }
  if (route.request().method() !== 'GET') {
    check(false, 'non-GET request to EM: ' + route.request().method() + ' ' + p);
    return route.abort();
  }
  if (pages[p]) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: pages[p] });
  return route.fulfill({ status: 404, body: 'not in fixtures' });
});
await ctx.route('https://elsevier.turnitin.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>report</h1>' }));
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
await page.waitForSelector('.preh-spikes', { timeout: 5000 });
check(true, 'spike panel injected in top window');
check(await page.frameLocator('#content').locator('.preh-spikes').count() === 0, 'no spike panel inside iframe#content');

const logText = () => page.locator('.preh-log').inputValue();
await page.click('.preh-spikes-head');
await page.waitForFunction(() => document.getElementById('content').contentDocument.querySelectorAll('tr[data-rowindex]').length > 0);
await page.click('text=Read list');
let log = await logText();
check(/Frozen grid: found; 2 rows/.test(log), 'list parsed (2 rows)');
check(!/PR-D-/.test(log), 'log contains no manuscript numbers');

await page.click('text=2 · Duplicate');
await page.waitForFunction(() => /Spike 2 GET/.test(document.querySelector('.preh-log').value) && /candidate rows parsed/.test(document.querySelector('.preh-log').value));
log = await logText();
check(/3 candidate rows parsed in iframe/.test(log), 'duplicate iframe readable');
check(/candidates=3 emScore=35 maxTitle=82 maxAbstract=71 ok=false/.test(log), 'duplicate summary computed');
await page.keyboard.press('Escape');
check(await page.locator('.preh-overlay').count() === 0, 'Esc closes overlay');

await page.click('text=3 · Turnitin');
await page.waitForFunction(() => /Spike 3: iframe navigated cross-origin|Spike 3: iframe stayed/.test(document.querySelector('.preh-log').value));
log = await logText();
check(/"Completed" link found/.test(log), 'similarity Completed link parsed');
check(/navigated cross-origin/.test(log), 'CrossCheck iframe followed redirect cross-origin');
await page.keyboard.press('Escape');

await page.click('text=4 · Evaluate');
await page.waitForFunction(() => /#iframe_msa/.test(document.querySelector('.preh-log').value));
check(/#iframe_msa present, host=mfe-ux.triage.elsevier.com/.test(await logText()), 'evaluate inner iframe found');
await page.keyboard.press('Escape');

await page.click('text=5b · Assign (main)');
await page.waitForFunction(() => /main world replied/.test(document.querySelector('.preh-log').value));
check(/replied ok=true/.test(await logText()), 'main-world bridge replied ok');
check(await page.evaluate(() => window.__assignCalls) === 1, 'editorAssignment called once in top window');

await page.click('text=5a · Assign (click)');
await page.waitForTimeout(300);
const frameCalls = await page.frame({ name: 'content' }).evaluate(() => window.__assignCalls || 0);
// Chrome does not run javascript: hrefs for clicks dispatched from an isolated world.
check(frameCalls === 0, 'isolated-world click on a javascript: link does nothing (use the MAIN-world bridge)');

await page.click('text=Authors');
await page.waitForFunction(() => /authors=\d/.test(document.querySelector('.preh-log').value));
check(/authors=4; onlyReviewEditing=1; noRoles=1/.test(await logText()), 'author status parsed');
await page.keyboard.press('Escape');

check(/Build stamp: \d+/.test(await logText()), 'build stamp readable via service worker');

// Hot reload: change the stamp and expect the worker to call chrome.runtime.reload().
// Under Playwright (--load-extension) the reloaded extension does not come back,
// so the tab-reload half can only be verified with "Load unpacked" in real Chrome.
const swBefore = ctx.serviceWorkers().length;
execFileSync(path.join(ROOT, 'scripts', 'stamp.sh'));
const t0 = Date.now();
while (Date.now() - t0 < 6000 && ctx.serviceWorkers().length >= swBefore) await page.waitForTimeout(200);
check(ctx.serviceWorkers().length < swBefore, `hot reload: stamp change detected, chrome.runtime.reload() called after ${Date.now() - t0} ms`);

if (process.env.SHOW_LOG) console.log("---- LOG ----\n" + await logText().catch(() => "(n/a)"));
await ctx.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
