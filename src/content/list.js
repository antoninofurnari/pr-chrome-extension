// list.js — F1: status chip + note icon on every row of a frozen-grid folder
// list (New Assignments and any other list with the same grid), with an inline
// popover to edit status and note. Runs inside iframe#content.
//
// Idempotent: EM reloads iframe#content on every folder change, and grids can
// render late, so rows are (re)scanned on DOM mutations.
(function (root) {
  'use strict';

  const P = root.PREH.parse;
  const S = root.PREH.storage;

  const SHORT = {
    '': '—',
    'In triage': 'In triage',
    'Waiting (reply)': 'Waiting',
    'Send back requested': 'Send back',
    'Ready to assign': 'Ready',
    'Done': 'Done',
  };
  const STATUS_CLASS = {
    '': 'none',
    'In triage': 'triage',
    'Waiting (reply)': 'waiting',
    'Send back requested': 'sendback',
    'Ready to assign': 'ready',
    'Done': 'done',
  };
  const DAY = 86400000;

  let popover = null; // {el, ms, saveNote}
  let scanTimer = null;

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function ageDays(iso) {
    if (!iso) return null;
    return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY));
  }

  function chipLabel(rec) {
    let label = SHORT[rec.status] != null ? SHORT[rec.status] : rec.status;
    if (rec.status === 'Waiting (reply)') {
      const d = ageDays(rec.statusAt || rec.updatedAt);
      if (d != null) label += ' · ' + d + 'd';
    }
    return label;
  }

  function formatDate(iso) {
    if (!iso) return 'never';
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // True when a node belongs to the extension's own UI.
  function isOurs(node) {
    const e = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(e && e.closest && e.closest('[class*="preh-"]'));
  }

  // ---------------------------------------------------------------------------
  // badges
  // ---------------------------------------------------------------------------

  // What the cockpit (top window) needs for one row. URLs come from the
  // row's action cell (em-parse.js).
  function cockpitPayload(row) {
    const a = row.actions || {};
    return {
      type: 'preh:openCockpit',
      ms: row.ms,
      docId: row.docId,
      revision: row.revision,
      similarityUrl: a.similarityUrl,
      similarityPct: a.similarityPct,
      duplicateUrl: a.duplicateUrl,
      duplicateScore: a.duplicateScore,
      detailsUrl: a.details ? a.details.url : null,
      evaluateUrl: a.evaluateUrl,
      evaluateWarning: !!(a.evaluateWarning && a.evaluateWarning.present),
      decisionUrl: a.decisionUrl,
      assignEditorArgs: a.assignEditorArgs,
    };
  }

  function makeBadge(row) {
    const ms = row.ms;
    const badge = el('span', 'preh-badge');
    badge.dataset.ms = ms;
    const chip = el('button', 'preh-chip preh-st-none', '—');
    chip.type = 'button';
    chip.title = 'Status and note (PR EM Helper)';
    const note = el('button', 'preh-note-icon', '✎');
    note.type = 'button';
    badge.append(chip, note);
    if (row.actions) {
      const triage = el('button', 'preh-triage-btn', 'Triage');
      triage.type = 'button';
      triage.title = 'Open the triage cockpit';
      triage.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closePopover();
        window.top.postMessage(cockpitPayload(row), location.origin);
      });
      badge.append(triage);
    }
    // Keep EM's own row handlers out of it.
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPopover(ms, badge);
    });
    return badge;
  }

  function renderBadge(badge, rec) {
    const chip = badge.querySelector('.preh-chip');
    const note = badge.querySelector('.preh-note-icon');
    chip.textContent = chipLabel(rec);
    chip.className = 'preh-chip preh-st-' + (STATUS_CLASS[rec.status] || 'none');
    const hasNote = !!(rec.note && rec.note.trim());
    note.classList.toggle('preh-has-note', hasNote);
    note.title = hasNote ? rec.note.slice(0, 300) : 'No note';
  }

  async function scan() {
    const rows = P.parseGrid(document).filter((r) => P.isMsNumber(r.ms));
    for (const r of rows) {
      const cell = r.dataRow.querySelector('td');
      if (cell && !cell.querySelector('.preh-badge')) cell.append(makeBadge(r));
    }
    await renderAll();
  }

  async function renderAll() {
    const badges = Array.from(document.querySelectorAll('.preh-badge'));
    if (!badges.length) return;
    const recs = await S.getMany(Array.from(new Set(badges.map((b) => b.dataset.ms))));
    badges.forEach((b) => renderBadge(b, recs[b.dataset.ms]));
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => { scan().catch((e) => console.warn('[PREH] scan', e)); }, 150);
  }

  // ---------------------------------------------------------------------------
  // popover
  // ---------------------------------------------------------------------------

  function closePopover() {
    if (!popover) return;
    popover.saveNote(); // flush a pending autosave
    popover.el.remove();
    popover = null;
  }

  async function openPopover(ms, anchor) {
    if (popover && popover.ms === ms) { closePopover(); return; }
    closePopover();
    const rec = await S.get(ms);

    const box = el('div', 'preh-popover');
    const head = el('div', 'preh-pop-head');
    head.append(el('strong', null, ms));
    const close = el('button', 'preh-pop-close', '×');
    close.type = 'button';
    close.title = 'Close (Esc)';
    close.addEventListener('click', closePopover);
    head.append(close);

    const select = el('select', 'preh-pop-status');
    for (const st of S.STATUSES) {
      const o = el('option', null, st || '—');
      o.value = st;
      if (st === rec.status) o.selected = true;
      select.append(o);
    }

    const textarea = el('textarea', 'preh-pop-note');
    textarea.placeholder = 'Note…';
    textarea.value = rec.note || '';
    textarea.rows = 5;

    const updated = el('div', 'preh-pop-updated', 'Updated: ' + formatDate(rec.updatedAt));

    let pending = null;
    let lastSaved = textarea.value;
    const saveNote = () => {
      clearTimeout(pending);
      pending = null;
      if (textarea.value === lastSaved) return;
      lastSaved = textarea.value;
      S.update(ms, { note: textarea.value }).then((r) => {
        updated.textContent = 'Updated: ' + formatDate(r.updatedAt);
      });
    };
    textarea.addEventListener('input', () => {
      clearTimeout(pending);
      pending = setTimeout(saveNote, 400);
    });
    textarea.addEventListener('blur', saveNote);

    select.addEventListener('change', () => {
      S.update(ms, { status: select.value, statusAt: new Date().toISOString() }).then((r) => {
        updated.textContent = 'Updated: ' + formatDate(r.updatedAt);
      });
    });

    const label = (text, control) => {
      const l = el('label', 'preh-pop-field');
      l.append(el('span', null, text), control);
      return l;
    };
    box.append(head, label('Status', select), label('Note', textarea), updated);
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    box.addEventListener('click', (e) => e.stopPropagation());
    document.body.append(box);
    position(box, anchor);
    popover = { el: box, ms, saveNote };
    textarea.focus();
  }

  // Place the popover next to its badge, inside the viewport.
  function position(box, anchor) {
    const a = anchor.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    let left = a.left;
    let top = a.bottom + 4;
    if (left + w > vw - 8) left = Math.max(8, vw - w - 8);
    if (top + h > vh - 8) top = Math.max(8, a.top - h - 4);
    box.style.left = left + 'px';
    box.style.top = top + 'px';
  }

  // ---------------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------------

  function init() {
    if (root.PREH.listStarted) return;
    root.PREH.listStarted = true;

    scan();
    new MutationObserver((records) => {
      const relevant = records.some((r) => !isOurs(r.target) &&
        !(Array.from(r.addedNodes).every(isOurs) && Array.from(r.removedNodes).every(isOurs)));
      if (relevant) scheduleScan();
    }).observe(document.body, { childList: true, subtree: true });

    // Changes from the popover, other frames, other tabs or an import.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && Object.keys(changes).some((k) => k.startsWith(S.MS_PREFIX))) renderAll();
    });

    document.addEventListener('mousedown', (e) => {
      // A click on a badge is handled by the badge itself (toggle / switch).
      if (popover && !popover.el.contains(e.target) && !(e.target.closest && e.target.closest('.preh-badge'))) closePopover();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });
    window.addEventListener('pagehide', closePopover);
  }

  root.PREH = root.PREH || {};
  root.PREH.list = { init, chipLabel };
})(globalThis);
