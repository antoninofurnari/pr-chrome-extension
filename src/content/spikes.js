// spikes.js — Milestone 0 test panel (top window, dev mode only).
// Each button runs one of the M0 spikes from CLAUDE.md against a row of the
// list currently shown in iframe#content. Everything is read-only: GET
// requests, iframes and opening EM's own popups.
//
// The log is meant to be copied into docs/findings.md, so it never contains
// manuscript data: only statuses, booleans, counts, hosts and paths.
// Remove this file once M0 is done.
(function (root) {
  'use strict';

  const P = root.PREH.parse;
  let panel = null;
  let overlay = null;
  let rows = [];

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === 'class') e.className = v;
      else e.setAttribute(k, v);
    }
    for (const c of children) e.append(c);
    return e;
  }

  function log(text) {
    const box = panel && panel.querySelector('.preh-log');
    const line = new Date().toTimeString().slice(0, 8) + '  ' + text;
    if (box) { box.value += line + '\n'; box.scrollTop = box.scrollHeight; }
    console.log('[PREH]', text);
  }

  function pathOf(url) {
    try { const u = new URL(url); return u.host + u.pathname; } catch (_) { return '?'; }
  }

  // Same-origin GET only, decoded with the charset of the response.
  async function fetchDoc(url) {
    const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
    const buf = await res.arrayBuffer();
    const cs = /charset=([^;]+)/i.exec(res.headers.get('content-type') || '');
    let text;
    try { text = new TextDecoder(cs ? cs[1].trim() : 'utf-8').decode(buf); }
    catch (_) { text = new TextDecoder().decode(buf); }
    return { status: res.status, finalUrl: res.url, doc: new DOMParser().parseFromString(text, 'text/html') };
  }

  function contentDoc() {
    const f = document.getElementById('content');
    try { return f && f.contentDocument; } catch (_) { return null; }
  }

  function currentRow() {
    const sel = panel.querySelector('.preh-row-select');
    const r = rows[Number(sel.value)];
    if (!r) log('No row selected: open "New Assignments" and press "Read list".');
    return r;
  }

  // ---------------------------------------------------------------------------
  // overlay with one iframe
  // ---------------------------------------------------------------------------

  function closeOverlay() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  function openOverlay(title, url, onLoad, extraButtons) {
    closeOverlay();
    const iframe = el('iframe', { name: 'preh-spike', class: 'preh-frame' });
    const loadStart = performance.now();
    iframe.addEventListener('load', () => {
      if (!iframe.isConnected) return;
      let sameOrigin = false;
      let path = null;
      try {
        sameOrigin = !!iframe.contentDocument;
        if (iframe.contentWindow.location.href === 'about:blank') return; // initial empty document
        path = iframe.contentWindow.location.pathname;
      } catch (_) { sameOrigin = false; }
      log(`  iframe load event after ${Math.round(performance.now() - loadStart)} ms; ` +
        (sameOrigin ? `same-origin, path=${path}` : 'cross-origin (cannot inspect)'));
      if (onLoad) onLoad(iframe, sameOrigin);
    });
    overlay = el('div', { class: 'preh-overlay' },
      el('div', { class: 'preh-overlay-bar' },
        el('strong', {}, title),
        ...(extraButtons || []),
        el('button', { class: 'preh-btn', on: { click: closeOverlay } }, 'Close (Esc)')),
      iframe);
    iframe.src = url;
    document.body.append(overlay);
  }

  function recordButtons(spike) {
    return [
      el('button', { class: 'preh-btn', on: { click: () => log(`  ${spike}: USER SAYS renders OK`) } }, 'It renders'),
      el('button', { class: 'preh-btn', on: { click: () => log(`  ${spike}: USER SAYS refused / blank / error`) } }, 'Refused / blank'),
    ];
  }

  // ---------------------------------------------------------------------------
  // spikes
  // ---------------------------------------------------------------------------

  function readList() {
    const doc = contentDoc();
    const sel = panel.querySelector('.preh-row-select');
    sel.textContent = '';
    if (!doc) { log('iframe#content not accessible'); return; }
    log(`iframe#content path=${doc.location.pathname}`);
    const folders = P.parseFolders(doc);
    if (folders.length) {
      const na = folders.find((f) => f.linkId === 'lnkNewAssignments');
      log(`Main Menu: ${folders.length} aries-folder-item; lnkNewAssignments nvgurl=${na ? na.url : 'NOT FOUND'}`);
    }
    rows = P.parseGrid(doc);
    log(`Frozen grid: ${P.findGrid(doc) ? 'found' : 'not found'}; ${rows.length} rows`);
    rows.forEach((r, i) => {
      sel.append(el('option', { value: String(i) }, r.ms || `(row ${i})`));
      const a = r.actions || {};
      log(`  row ${i}: docId=${r.docId ? 'yes' : 'NO'} ms=${P.isMsNumber(r.ms) ? 'ok' : 'UNRECOGNISED'} rev=${r.revision} ` +
        `dupIcon=${r.possibleDuplicate} sim=${a.similarityUrl ? a.similarityPct + '%' : 'NO'} ` +
        `dup=${a.duplicateUrl ? a.duplicateScore + '%' : 'NO'} details=${a.details ? 'yes' : 'NO'} ` +
        `eval=${a.evaluateUrl ? 'yes' : 'NO'} evalIcon=${a.evaluateWarning && a.evaluateWarning.present} ` +
        `decision=${a.decisionUrl ? 'yes' : 'NO'} assign=${a.assignEditorArgs ? 'yes' : 'NO'}`);
      if (a.evaluateWarning && a.evaluateWarning.present) {
        console.log('[PREH] Evaluate icon markup (row ' + i + '):\n' + a.evaluateWarning.html);
      }
    });
  }

  // Spike 2: Duplicate Submission Check in an injected iframe (+ GET summary).
  async function spikeDuplicate() {
    const r = currentRow();
    if (!r || !r.actions.duplicateUrl) return log('Spike 2: no duplicate URL on this row');
    log('Spike 2: iframe of DuplicateSubmissionCheckResults.aspx');
    openOverlay('Spike 2 — Duplicate Submission Check', r.actions.duplicateUrl, (iframe, same) => {
      if (!same) return log('  Spike 2: FAIL, iframe not same-origin');
      const n = P.parseDuplicatePage(iframe.contentDocument).length;
      log('  Spike 2 iframe stats: ' + JSON.stringify(P.duplicatePageStats(iframe.contentDocument)));
      log(`  Spike 2: table#gridResults ${iframe.contentDocument.querySelector('table#gridResults') ? 'present' : 'MISSING'}, ${n} candidate rows parsed in iframe`);
    }, recordButtons('Spike 2'));
    try {
      const { status, doc } = await fetchDoc(r.actions.duplicateUrl);
      log('  Spike 2 GET stats: ' + JSON.stringify(P.duplicatePageStats(doc)));
      const s = P.summarizeDuplicates(r.actions.duplicateScore, P.parseDuplicatePage(doc));
      log(`  Spike 2 GET: status=${status}; candidates=${s.candidates} emScore=${s.emScore} maxTitle=${s.maxTitle} maxAbstract=${s.maxAbstract} ok=${s.ok}`);
    } catch (e) { log('  Spike 2 GET failed: ' + e.message); }
  }

  // Spike 3: Similarity -> "Completed" -> CrossCheckResults (-> Turnitin) in an iframe.
  async function spikeTurnitin() {
    const r = currentRow();
    if (!r || !r.actions.similarityUrl) return log('Spike 3: no similarity URL on this row');
    log('Spike 3: GET SimilarityCheckResults.aspx');
    let rep;
    try {
      const { status, doc } = await fetchDoc(r.actions.similarityUrl);
      rep = P.parseSimilarityPage(doc);
      log(`  status=${status}; "Completed" link ${rep ? 'found' : 'NOT FOUND'}`);
      if (!rep) {
        const st = doc.querySelector('a[id$="_lnkReportStatus"]');
        log('  report status link: ' + (st ? `present, href starts "${(st.getAttribute('href') || '').slice(0, 30)}"` : 'absent'));
        return;
      }
    } catch (e) { return log('  GET failed: ' + e.message); }
    const openLeft = () => {
      const w = Math.floor(screen.availWidth / 2);
      const win = window.open(rep.reportUrl, 'preh-report',
        `left=${screen.availLeft || 0},top=${screen.availTop || 0},width=${w},height=${screen.availHeight}`);
      log('  Spike 3 fallback: popup ' + (win ? 'opened' : 'BLOCKED'));
    };
    log('  Spike 3: iframe of CrossCheckResults.aspx (302 to Turnitin expected)');
    openOverlay('Spike 3 — Similarity report (Turnitin)', rep.reportUrl, (iframe, same) => {
      log(same ? '  Spike 3: iframe stayed same-origin (no redirect?)' :
        '  Spike 3: iframe navigated cross-origin. Look at the panel and press "It renders" or "Refused / blank". ' +
        'Also check DevTools console for "Refused to display … frame-ancestors / X-Frame-Options".');
    }, [...recordButtons('Spike 3'),
      el('button', { class: 'preh-btn', on: { click: openLeft } }, 'Open report (left half)')]);
  }

  // Spike 4: Evaluate Manuscript in an iframe, including its inner mfe-ux iframe.
  function spikeEvaluate() {
    const r = currentRow();
    if (!r || !r.actions.evaluateUrl) return log('Spike 4: no Evaluate URL on this row');
    log('Spike 4: iframe of ViewEvaluateManuscript.aspx');
    openOverlay('Spike 4 — Evaluate Manuscript', r.actions.evaluateUrl, (iframe, same) => {
      if (!same) return log('  Spike 4: FAIL, iframe not same-origin');
      const check = (attempt) => {
        if (!iframe.isConnected) return;
        const inner = iframe.contentDocument && iframe.contentDocument.querySelector('#iframe_msa');
        if (!inner && attempt < 10) return setTimeout(() => check(attempt + 1), 500);
        log(`  Spike 4: #iframe_msa ${inner ? 'present, host=' + pathOf(inner.src).split('/')[0] : 'NOT FOUND after 5 s'}. ` +
          'Does the inner panel render? Press a button.');
      };
      check(0);
    }, recordButtons('Spike 4'));
  }

  // Spike 5a: dispatch a click on the row's own a.assignEditor link.
  // Expected to do nothing: Chrome does not run javascript: hrefs for clicks
  // dispatched from a content script's isolated world (see docs/findings.md).
  function spikeAssignClick() {
    const r = currentRow();
    if (!r) return;
    const a = r.actionRow && r.actionRow.querySelector('a.assignEditor');
    if (!a) return log('Spike 5a: a.assignEditor NOT FOUND on this row');
    log('Spike 5a: a.assignEditor.click() — did the Assign Editor popup open? (close it without confirming)');
    a.click();
  }

  // Spike 5b: call editorAssignment(...) in the MAIN world via main-world.js.
  function spikeAssignMain() {
    const r = currentRow();
    if (!r) return;
    const args = r.actions.assignEditorArgs;
    if (!args) return log('Spike 5b: editorAssignment args NOT FOUND on this row');
    const onReply = (e) => {
      if (e.source !== window || !e.data || e.data.type !== 'preh:editorAssignment:result') return;
      window.removeEventListener('message', onReply);
      log(`  Spike 5b: main world replied ok=${e.data.ok}${e.data.error ? ' error=' + e.data.error : ''}. Did the popup open? (close it without confirming)`);
    };
    window.addEventListener('message', onReply);
    log('Spike 5b: postMessage -> main-world editorAssignment(...)');
    window.postMessage({ type: 'preh:editorAssignment', args }, location.origin);
  }

  // Extra: Details GET -> Author Status URL -> iframe + parsed summary.
  async function spikeAuthors() {
    const r = currentRow();
    if (!r || !r.actions.details) return log('Authors: no Details link on this row');
    log('Authors: GET EMDetails.aspx');
    try {
      const det = await fetchDoc(r.actions.details.url);
      const info = P.parseDetailsPage(det.doc);
      log(`  status=${det.status}; Author Status link ${info ? 'found' : 'NOT FOUND'}`);
      if (!info) return;
      const st = await fetchDoc(info.authorStatusUrl);
      const authors = P.parseAuthorStatusPage(st.doc);
      log(`  GET ContributingAuthorStatus: status=${st.status}; authors=${authors.length}; ` +
        `onlyReviewEditing=${authors.filter((a) => a.onlyReviewEditing).length}; noRoles=${authors.filter((a) => a.noRoles).length}`);
      openOverlay('Author Status', info.authorStatusUrl, null, recordButtons('Author Status'));
    } catch (e) { log('  failed: ' + e.message); }
  }

  // Spike 1 helper: shows which build is running, so a hot reload is visible.
  // Content scripts can't fetch extension files, so ask the service worker.
  async function showBuild() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'preh:stamp' });
      log('Build stamp: ' + (res && res.stamp ? res.stamp : 'missing (run scripts/stamp.sh)'));
    } catch (_) { log('Build stamp: service worker not reachable'); }
  }

  // ---------------------------------------------------------------------------
  // panel
  // ---------------------------------------------------------------------------

  function buildPanel() {
    const btn = (label, fn) => el('button', { class: 'preh-btn', on: { click: fn } }, label);
    panel = el('div', { class: 'preh-spikes preh-collapsed' },
      el('div', { class: 'preh-spikes-head', on: { click: () => panel.classList.toggle('preh-collapsed') } }, 'PREH · M0 spikes'),
      el('div', { class: 'preh-spikes-body' },
        el('div', { class: 'preh-row' }, btn('Read list', readList), el('select', { class: 'preh-row-select' })),
        el('div', { class: 'preh-row' },
          btn('2 · Duplicate', spikeDuplicate),
          btn('3 · Turnitin', spikeTurnitin),
          btn('4 · Evaluate', spikeEvaluate)),
        el('div', { class: 'preh-row' },
          btn('5a · Assign (click)', spikeAssignClick),
          btn('5b · Assign (main)', spikeAssignMain),
          btn('Authors', spikeAuthors)),
        el('textarea', { class: 'preh-log', readonly: 'readonly', spellcheck: 'false' }),
        el('div', { class: 'preh-row' },
          btn('Copy log', () => navigator.clipboard.writeText(panel.querySelector('.preh-log').value).then(() => log('(log copied)'))),
          btn('Clear', () => { panel.querySelector('.preh-log').value = ''; }),
          btn('Build', showBuild))));
    document.body.append(panel);
  }

  function init() {
    if (panel) return;
    buildPanel();
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlay(); });
    showBuild();
  }

  root.PREH = root.PREH || {};
  root.PREH.spikes = { init };
})(globalThis);
