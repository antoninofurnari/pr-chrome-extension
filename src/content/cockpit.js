// cockpit.js — F2: full-viewport triage overlay in the top window
// (default2.aspx). Opened by list.js via window.top.postMessage.
//
// Left: Similarity report (Turnitin, reached through CrossCheckResults.aspx).
// Right: Duplicate Submission Check, Author Status, Evaluate Manuscript.
// Read-only: GET requests, iframes and opening EM's own pages only.
(function (root) {
  'use strict';

  const P = root.PREH.parse;
  const S = root.PREH.storage;

  let cockpit = null; // {el, ms, unsubscribe}

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function button(label, cls, onClick, title) {
    const b = el('button', 'preh-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }

  // Only accept URLs inside EM's /pr/ path (they come through postMessage).
  function emUrl(u) {
    return typeof u === 'string' && u.startsWith(P.EM_BASE) ? u : null;
  }

  // Same-origin GET only, decoded with the charset of the response.
  async function fetchDoc(url) {
    const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
    const buf = await res.arrayBuffer();
    const cs = /charset=([^;]+)/i.exec(res.headers.get('content-type') || '');
    let text;
    try { text = new TextDecoder(cs ? cs[1].trim() : 'utf-8').decode(buf); }
    catch (_) { text = new TextDecoder().decode(buf); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return new DOMParser().parseFromString(text, 'text/html');
  }

  function frame(name) {
    const f = el('iframe', 'preh-frame');
    f.name = 'preh-' + name; // router.js skips frames named preh-*
    // Esc inside a same-origin panel closes the cockpit too.
    f.addEventListener('load', () => {
      try { f.contentWindow.addEventListener('keydown', onKey); } catch (_) { /* cross-origin */ }
    });
    return f;
  }

  // Panel summaries can be mirrored in the checklist (node.mirror).
  function setSummary(node, text, level, title) {
    for (const n of [node, node.mirror]) {
      if (!n) continue;
      n.textContent = text;
      n.className = 'preh-sum preh-sum-' + (level || 'neutral');
      n.title = title || '';
    }
  }

  // A collapsible panel of the right column.
  function panel(title, { collapsed = false, onFirstOpen } = {}) {
    const box = el('section', 'preh-panel' + (collapsed ? ' preh-panel-collapsed' : ''));
    const head = el('div', 'preh-panel-head');
    const toggle = el('span', 'preh-panel-toggle', collapsed ? '▸' : '▾');
    const summary = el('span', 'preh-sum preh-sum-neutral', '');
    head.append(toggle, el('strong', null, title), summary);
    const body = el('div', 'preh-panel-body');
    box.append(head, body);
    let opened = !collapsed;
    head.addEventListener('click', () => {
      const nowCollapsed = box.classList.toggle('preh-panel-collapsed');
      toggle.textContent = nowCollapsed ? '▸' : '▾';
      if (!nowCollapsed && !opened) {
        opened = true;
        if (onFirstOpen) onFirstOpen();
      }
    });
    if (opened && onFirstOpen) setTimeout(onFirstOpen, 0);
    return { box, head, body, summary };
  }

  // ---------------------------------------------------------------------------
  // panels
  // ---------------------------------------------------------------------------

  // Left: Similarity popup page -> "Completed" link -> CrossCheckResults (Turnitin).
  function similarityPane(d) {
    const pane = el('div', 'preh-left');
    const msg = el('div', 'preh-pane-msg', 'Loading similarity report…');
    const f = frame('similarity');
    pane.append(msg, f);
    let reportUrl = null;
    const openLeftHalf = () => {
      const url = reportUrl || emUrl(d.similarityUrl);
      if (!url) return;
      const w = Math.floor(screen.availWidth / 2);
      window.open(url, 'preh-report',
        `left=${screen.availLeft || 0},top=${screen.availTop || 0},width=${w},height=${screen.availHeight}`);
    };
    const url = emUrl(d.similarityUrl);
    if (!url) {
      msg.textContent = 'No "Similarity Check Results" link on this row.';
    } else {
      fetchDoc(url).then((doc) => {
        const rep = P.parseSimilarityPage(doc);
        if (rep) {
          reportUrl = rep.reportUrl;
          msg.remove();
          f.src = reportUrl;
        } else {
          msg.textContent = 'Similarity report not "Completed" yet: showing EM\'s Similarity Check Results page.';
          f.src = url;
        }
      }).catch((e) => {
        msg.textContent = 'Could not read the Similarity page (' + e.message + ').';
        f.src = url;
      });
    }
    return { pane, openLeftHalf };
  }

  function duplicatePanel(d) {
    const p = panel('Duplicate Submission Check');
    p.summary.dataset.key = 'dup';
    const url = emUrl(d.duplicateUrl);
    if (!url) {
      p.body.append(el('div', 'preh-pane-msg', 'No "Duplicate Submission Check" link on this row.'));
      return p.box;
    }
    setSummary(p.summary, 'EM ' + (d.duplicateScore != null ? d.duplicateScore + '%' : '?') + ' · loading…', 'neutral');
    const f = frame('duplicate');
    f.addEventListener('load', () => {
      let doc = null;
      try { doc = f.contentDocument; } catch (_) { /* not same-origin */ }
      if (!doc || !doc.querySelector('table#gridResults')) {
        setSummary(p.summary, 'EM ' + (d.duplicateScore != null ? d.duplicateScore + '%' : '?') + ' · table not found', 'neutral');
        return;
      }
      const s = P.summarizeDuplicates(d.duplicateScore, P.parseDuplicatePage(doc));
      const text = `EM ${s.emScore != null ? s.emScore + '%' : '?'} · title ${s.maxTitle}% · abstract ${s.maxAbstract}%` +
        (s.flagged.length ? ` · ${s.flagged.length} > ${P.DUP_SIMILARITY_MAX}%` : '');
      setSummary(p.summary, text, s.ok ? 'ok' : 'bad',
        `${s.candidates} candidates. OK if EM score ≤ ${P.DUP_EM_SCORE_MAX}% and no title/abstract similarity > ${P.DUP_SIMILARITY_MAX}%.` +
        (s.flagged.length ? '\nAbove threshold: ' + s.flagged.join(', ') : ''));
    });
    f.src = url;
    p.body.append(f);
    return p.box;
  }

  function authorPanel(d) {
    const p = panel('Author Status');
    p.summary.dataset.key = 'authors';
    const url = emUrl(d.detailsUrl);
    if (!url) {
      p.body.append(el('div', 'preh-pane-msg', 'No "Details" link on this row.'));
      return p.box;
    }
    setSummary(p.summary, 'loading…', 'neutral');
    const f = frame('authors');
    f.addEventListener('load', () => {
      let doc = null;
      try { doc = f.contentDocument; } catch (_) { /* not same-origin */ }
      if (!doc || !doc.querySelector('table#CorrAuthorGridView, table#OtherAuthorsGridView')) return;
      const authors = P.parseAuthorStatusPage(doc);
      const weak = authors.filter((a) => a.onlyReviewEditing);
      const none = authors.filter((a) => a.noRoles);
      const parts = [authors.length + ' authors'];
      if (weak.length) parts.push(weak.length + ' only review & editing');
      if (none.length) parts.push(none.length + ' without roles');
      const lines = authors.map((a) => `${a.order}. ${a.name}: ${a.roles.length ? a.roles.join(', ') : '(no roles)'}`);
      setSummary(p.summary, parts.join(' · '), weak.length || none.length ? 'bad' : 'ok', lines.join('\n'));
    });
    p.body.append(f);
    fetchDoc(url).then((doc) => {
      const info = P.parseDetailsPage(doc);
      if (!info) {
        setSummary(p.summary, 'Author Status link not found in Details', 'neutral');
        f.src = url; // show Details itself
        return;
      }
      f.src = info.authorStatusUrl;
    }).catch((e) => {
      setSummary(p.summary, 'Details not readable (' + e.message + ')', 'neutral');
    });
    return p.box;
  }

  function evaluatePanel(d) {
    const url = emUrl(d.evaluateUrl);
    const p = panel('Evaluate Manuscript', {
      collapsed: true,
      onFirstOpen: () => {
        if (!url) return;
        const f = frame('evaluate');
        f.src = url;
        p.body.append(f);
      },
    });
    p.summary.dataset.key = 'evaluate';
    if (!url) p.body.append(el('div', 'preh-pane-msg', 'No "Evaluate Manuscript" link on this row.'));
    setSummary(p.summary, 'warning icon: ' + (d.evaluateWarning ? 'yes' : 'no'), d.evaluateWarning ? 'bad' : 'neutral',
      'Step 4 applies only when the warning icon is present. The icon markup is not confirmed yet (docs/em-structure.md §2).');
    return p.box;
  }

  // ---------------------------------------------------------------------------
  // checklist (triage workflow, CLAUDE.md steps 0-5)
  // ---------------------------------------------------------------------------

  // [step title, summary key mirrored next to the step, [[id, text], ...]]
  const CHECKLIST = [
    ['0 · Before opening', null, [
      ['s0_revision', 'Not a revision (R1, R2… → reassign to previous AE, no triage)'],
      ['s0_coi', 'No conflict of interest (me → don\'t open; co-author, Catania colleague, team AE → return to EiC)'],
    ]],
    ['1 · Similarity report', null, [
      ['s1_overlap', 'Overlap acceptable (long blocks, mosaic, others\' methods/results → Reject, ethics)'],
      ['s1_scope', 'In scope, correct article type (else Reject + offer transfer)'],
      ['s1_article', 'Looks like a scientific article: abstract, English, sections, length (else Reject, no transfer)'],
      ['s1_skim', 'PDF skim: setup, results, no duplicated figures, no AI prompts, no tortured phrases, no citation stacking'],
      ['s1_sections', 'Final sections: CRediT, competing interests, gen-AI disclosure (if used), ethics (data on people). Missing → send back'],
    ]],
    ['2 · Duplicate check', 'dup', [
      ['s2_dup', 'EM score ≤ 50% and no title/abstract > 70%. Else Details of old MS → Editors: ME "Reject - invitation to resubmit" without reviewers = OK; same paper / under review → Reject (ethics)'],
    ]],
    ['3 · Author Status', 'authors', [
      ['s3_names', 'Names and order match the PDF, emails plausible, affiliations consistent'],
      ['s3_roles', 'Every author has a substantial role (only "Writing – review & editing" → send back). "No Response" is fine'],
    ]],
    ['4 · Evaluate Manuscript', 'evaluate', [
      ['s4_eval', 'Only if warning icon: same paper + same authors → Reject (ethics); different authors → report to Publisher'],
    ]],
  ];
  const DECISIONS = ['', 'Reject (Potential ethics concern)', 'Reject and offer transfer', 'Send back to author (via Managing Editor)', 'Assign Editor'];
  const ITEM_COUNT = CHECKLIST.reduce((n, [, , items]) => n + items.length, 0);

  function checklistDrawer(d, rec, right) {
    const drawer = el('aside', 'preh-checklist');
    const checklist = Object.assign({}, rec.checklist);
    const save = () => S.update(d.ms, { checklist: Object.assign({}, checklist) });

    const progress = el('span', 'preh-sum preh-sum-neutral');
    const updateProgress = () => {
      const done = CHECKLIST.reduce((n, [, , items]) => n + items.filter(([id]) => checklist[id]).length, 0);
      progress.textContent = done + '/' + ITEM_COUNT;
      progress.className = 'preh-sum preh-sum-' + (done === ITEM_COUNT ? 'ok' : 'neutral');
    };
    const head = el('div', 'preh-checklist-head');
    head.append(el('strong', null, 'Checklist'), progress);
    drawer.append(head);

    for (const [title, key, items] of CHECKLIST) {
      const step = el('div', 'preh-step');
      const stepHead = el('div', 'preh-step-head');
      stepHead.append(el('span', null, title));
      const src = key && right.querySelector(`.preh-sum[data-key="${key}"]`);
      if (src) {
        const mirror = src.cloneNode(true);
        src.mirror = mirror;
        stepHead.append(mirror);
      }
      step.append(stepHead);
      for (const [id, text] of items) {
        const label = el('label', 'preh-check');
        const box = el('input');
        box.type = 'checkbox';
        box.dataset.id = id;
        box.checked = !!checklist[id];
        box.addEventListener('change', () => {
          checklist[id] = box.checked;
          updateProgress();
          save();
        });
        label.append(box, el('span', null, text));
        step.append(label);
      }
      drawer.append(step);
    }

    // Step 5: intended decision (a note for Antonino, nothing is sent to EM).
    const step5 = el('div', 'preh-step');
    step5.append(el('div', 'preh-step-head', '5 · Decision'));
    const decision = el('select', 'preh-decision');
    for (const v of DECISIONS) {
      const o = el('option', null, v || '—');
      o.value = v;
      if (v === (checklist.decision || '')) o.selected = true;
      decision.append(o);
    }
    decision.addEventListener('change', () => {
      checklist.decision = decision.value;
      save();
    });
    step5.append(decision);
    drawer.append(step5);

    // Send back notes (autosaved) + Copy.
    const notesHead = el('div', 'preh-step-head');
    notesHead.append(el('span', null, 'Send back notes'));
    const copy = el('button', 'preh-btn preh-copy', 'Copy');
    copy.type = 'button';
    notesHead.append(copy);
    const notes = el('textarea', 'preh-sendback');
    notes.rows = 6;
    notes.placeholder = 'Items to send back to the authors…';
    notes.value = rec.sendBackNotes || '';
    let pending = null;
    let lastSaved = notes.value;
    const saveNotes = () => {
      clearTimeout(pending);
      if (notes.value === lastSaved) return;
      lastSaved = notes.value;
      S.update(d.ms, { sendBackNotes: notes.value });
    };
    notes.addEventListener('input', () => { clearTimeout(pending); pending = setTimeout(saveNotes, 400); });
    notes.addEventListener('blur', saveNotes);
    copy.addEventListener('click', () => {
      saveNotes();
      const done = () => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); };
      navigator.clipboard.writeText(notes.value).then(done, () => {
        notes.select();
        if (document.execCommand('copy')) done();
      });
    });
    const notesBox = el('div', 'preh-step');
    notesBox.append(notesHead, notes);
    drawer.append(notesBox);

    updateProgress();
    return { drawer, flush: saveNotes };
  }

  // Draggable divider between the left pane and the panels. The width (in %
  // of the cockpit) is remembered across cockpits; double-click resets it.
  const WIDTH_KEY = 'preh:leftWidth';
  const DEFAULT_WIDTH = 55;

  function splitter(main, left) {
    const bar = el('div', 'preh-splitter');
    bar.title = 'Drag to resize · double-click to reset';
    const apply = (pct) => { left.style.flexBasis = pct + '%'; };
    chrome.storage.local.get(WIDTH_KEY).then((r) => apply(r[WIDTH_KEY] || DEFAULT_WIDTH));

    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      main.classList.add('preh-dragging'); // iframes ignore the pointer while dragging
      const box = main.getBoundingClientRect();
      let pct = null;
      const move = (ev) => {
        pct = Math.round(Math.min(85, Math.max(20, ((ev.clientX - box.left) / box.width) * 100)));
        apply(pct);
      };
      const up = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        main.classList.remove('preh-dragging');
        if (pct != null) chrome.storage.local.set({ [WIDTH_KEY]: pct });
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
    bar.addEventListener('dblclick', () => {
      apply(DEFAULT_WIDTH);
      chrome.storage.local.remove(WIDTH_KEY);
    });
    return bar;
  }

  // ---------------------------------------------------------------------------
  // open / close
  // ---------------------------------------------------------------------------

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function close() {
    if (!cockpit) return;
    cockpit.flush(); // pending send-back notes
    cockpit.unsubscribe();
    cockpit.el.remove();
    cockpit = null;
  }

  function assignEditor(d) {
    if (!Array.isArray(d.assignEditorArgs)) return;
    // main-world.js validates the arguments and calls EM's editorAssignment(),
    // which only opens EM's Assign Editor page.
    window.postMessage({ type: 'preh:editorAssignment', args: d.assignEditorArgs }, location.origin);
  }

  function openDecision(d) {
    const url = emUrl(d.decisionUrl);
    const content = document.getElementById('content');
    if (!url || !content) return;
    close();
    content.contentWindow.location.assign(url);
  }

  async function open(d) {
    close();
    const rec = await S.get(d.ms);

    const box = el('div', 'preh-cockpit');

    // header
    const head = el('div', 'preh-cockpit-bar');
    head.append(el('strong', 'preh-cockpit-ms', d.ms));
    if (d.revision > 0) head.append(el('span', 'preh-sum preh-sum-bad', 'Revision R' + d.revision + ': reassign to previous AE'));
    if (d.similarityPct != null) head.append(el('span', 'preh-cockpit-meta', 'Similarity ' + d.similarityPct + '%'));
    const status = el('select', 'preh-cockpit-status');
    for (const st of S.STATUSES) {
      const o = el('option', null, st || '—');
      o.value = st;
      if (st === rec.status) o.selected = true;
      status.append(o);
    }
    status.addEventListener('change', () => S.update(d.ms, { status: status.value, statusAt: new Date().toISOString() }));
    const spacer = el('span', 'preh-spacer');
    const sim = similarityPane(d);

    // body
    const right = el('div', 'preh-right');
    right.append(duplicatePanel(d), authorPanel(d), evaluatePanel(d));
    const main = el('div', 'preh-cockpit-main');
    const divider = splitter(main, sim.pane);
    const list = checklistDrawer(d, rec, right);
    main.append(sim.pane, divider, right, list.drawer);
    const toggleList = button('Checklist', 'preh-on', () => {
      const hidden = main.classList.toggle('preh-no-checklist');
      toggleList.classList.toggle('preh-on', !hidden);
    }, 'Show or hide the checklist');

    const maximize = button('Maximize report', '', () => {
      const on = main.classList.toggle('preh-maximized');
      maximize.textContent = on ? 'Show panels' : 'Maximize report';
    }, 'Hide the panels on the right (temporary)');
    head.append(spacer, el('label', 'preh-cockpit-meta', 'Status '), status, toggleList, maximize,
      button('Open report (left half)', '', sim.openLeftHalf, 'Open the similarity report in a window on the left half of the screen'),
      button('Close (Esc)', '', close));

    // footer
    const foot = el('div', 'preh-cockpit-foot');
    const assign = button('Open Assign Editor', '', () => assignEditor(d), 'Opens EM\'s Assign Editor page. Nothing is confirmed.');
    assign.disabled = !Array.isArray(d.assignEditorArgs);
    const decision = button('Open Decision page', '', () => openDecision(d), 'Opens EM\'s decision page in the main frame and closes the cockpit. Nothing is submitted.');
    decision.disabled = !emUrl(d.decisionUrl);
    foot.append(assign, decision);

    box.append(head, main, foot);
    document.body.append(box);

    // Keep the header status in sync with edits made elsewhere (list popover).
    const onChange = (changes, area) => {
      const c = area === 'local' && changes[S.MS_PREFIX + d.ms];
      if (c && c.newValue && c.newValue.status !== status.value) status.value = c.newValue.status || '';
    };
    chrome.storage.onChanged.addListener(onChange);
    cockpit = { el: box, ms: d.ms, flush: list.flush, unsubscribe: () => chrome.storage.onChanged.removeListener(onChange) };
  }

  function init() {
    if (root.PREH.cockpitStarted) return;
    root.PREH.cockpitStarted = true;
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'preh:openCockpit') return;
      const content = document.getElementById('content');
      if (!content || e.source !== content.contentWindow) return; // only from the list frame
      if (!P.isMsNumber(e.data.ms)) return;
      open(e.data);
    });
    document.addEventListener('keydown', onKey);
  }

  root.PREH = root.PREH || {};
  root.PREH.cockpit = { init, close };
})(globalThis);
