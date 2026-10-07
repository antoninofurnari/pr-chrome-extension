// em-parse.js — pure parsing helpers for Editorial Manager pages.
// Selectors and formats come from docs/em-structure.md (source of truth).
//
// Loaded as a classic content script (exposes globalThis.PREH.parse) and as a
// CommonJS module by `node --test` (module.exports). DOM helpers only use
// querySelector(All), getAttribute and textContent, so they also run on a
// document produced by DOMParser.
(function (root) {
  'use strict';

  const EM_BASE = 'https://www.editorialmanager.com/pr/';

  // Duplicate check thresholds (CLAUDE.md, Step 2).
  const DUP_EM_SCORE_MAX = 50;
  const DUP_SIMILARITY_MAX = 70;

  // ---------------------------------------------------------------------------
  // String helpers
  // ---------------------------------------------------------------------------

  // Parse the argument list of a JS call written as source, e.g.
  //   "12, 'a\'b', 0, true" -> [12, "a'b", 0, true]
  // Supports numbers, single/double-quoted strings, true/false/null.
  // Anything else is returned as its raw trimmed source text.
  function parseJsArgs(src) {
    const args = [];
    let i = 0;
    const n = src.length;
    const skipWs = () => { while (i < n && /\s/.test(src[i])) i++; };
    while (true) {
      skipWs();
      if (i >= n) break;
      const c = src[i];
      if (c === "'" || c === '"') {
        const q = c;
        let s = '';
        i++;
        while (i < n && src[i] !== q) {
          if (src[i] === '\\' && i + 1 < n) { s += src[i + 1]; i += 2; }
          else { s += src[i]; i++; }
        }
        i++; // closing quote
        args.push(s);
      } else {
        let start = i;
        let depth = 0;
        while (i < n && !(depth === 0 && src[i] === ',')) {
          if (src[i] === '(' || src[i] === '[') depth++;
          else if (src[i] === ')' || src[i] === ']') depth--;
          i++;
        }
        const raw = src.slice(start, i).trim();
        if (/^-?\d+(\.\d+)?$/.test(raw)) args.push(Number(raw));
        else if (raw === 'true') args.push(true);
        else if (raw === 'false') args.push(false);
        else if (raw === 'null') args.push(null);
        else args.push(raw);
      }
      skipWs();
      if (src[i] === ',') i++;
    }
    return args;
  }

  // Parse "javascript:fnName(args);" (optionally wrapped in void(...)).
  // Returns {fn, args} or null when the href is not a single function call.
  function parseJsCall(href) {
    if (!href) return null;
    let s = String(href).trim();
    if (!/^javascript:/i.test(s)) return null;
    s = s.replace(/^javascript:/i, '').trim().replace(/;\s*$/, '');
    const voidM = /^void\s*\(([\s\S]*)\)$/.exec(s);
    if (voidM) s = voidM[1].trim();
    const m = /^([A-Za-z_$][\w$.]*)\s*\(([\s\S]*)\)$/.exec(s);
    if (!m) return null;
    return { fn: m[1], args: parseJsArgs(m[2]) };
  }

  // "(12%)" / "12%" / " 7 % " -> 12 / 7 ; null if no number.
  function parsePercent(text) {
    const m = /(-?\d+(?:\.\d+)?)\s*%/.exec(text || '');
    return m ? Number(m[1]) : null;
  }

  // Manuscript numbers look like PR-D-25-01234 or PR-D-25-01234R1.
  const MS_RE = /^[A-Z]{2,}-[A-Z]-\d{2}-\d{3,}(R\d+)?$/;
  function isMsNumber(text) {
    return MS_RE.test((text || '').trim());
  }

  // 0 for a first submission, n for "...Rn".
  function msRevision(ms) {
    const m = /R(\d+)$/.exec((ms || '').trim());
    return m ? Number(m[1]) : 0;
  }

  // Resolve a relative EM URL against /pr/ (or another base).
  function absUrl(url, base) {
    return new URL(url, base || EM_BASE).href;
  }

  function cleanText(el) {
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  // ---------------------------------------------------------------------------
  // Folder list (frozen grid)
  // ---------------------------------------------------------------------------

  // Classify one link of the action cell from its label and href.
  // Returns a partial "actions" object to merge.
  function classifyActionLink(label, href) {
    const call = parseJsCall(href);
    const out = {};
    const l = (label || '').trim();
    if (/^Similarity Check Results$/i.test(l) && call && call.fn === 'openCenterWin') {
      out.similarityUrl = absUrl(call.args[0]);
    } else if (/^Duplicate Submission Check$/i.test(l) && call && call.fn === 'openCenterWin') {
      out.duplicateUrl = absUrl(call.args[0]);
    } else if (/^Details$/i.test(l) && call && call.fn === 'popupDetailsWindow') {
      const [docId, ms, sectionId] = call.args;
      out.details = {
        docId: String(docId),
        ms: String(ms),
        sectionId: String(sectionId),
        url: absUrl('EMDetails.aspx?docid=' + encodeURIComponent(docId) +
          '&ms_num=' + encodeURIComponent(ms) +
          '&sectionID=' + encodeURIComponent(sectionId)),
      };
    } else if (/^Evaluate Manuscript$/i.test(l) && !call && href) {
      out.evaluateUrl = absUrl(href);
    } else if (/^Submit Editor's Decision/i.test(l) && !call && href) {
      out.decisionUrl = absUrl(href);
    } else if (call && call.fn === 'editorAssignment') {
      out.assignEditorArgs = call.args;
    }
    return out;
  }

  // Look for an icon next to the Evaluate Manuscript link. The markup of the
  // warning is unknown (docs/em-structure.md §2), so report any img/svg/span
  // with an image-like class found between the link and the next <br>.
  // Returns {present: bool, html: string|null}.
  function detectEvaluateWarning(evalLink) {
    if (!evalLink) return { present: false, html: null };
    const found = [];
    const inspect = (el) => {
      if (!el || el.nodeType !== 1) return;
      const tag = el.tagName.toLowerCase();
      if (tag === 'img' || tag === 'svg' || tag === 'i' ||
          (el.querySelector && el.querySelector('img,svg,i'))) {
        found.push(el.outerHTML.slice(0, 300));
      }
    };
    // inside the link
    if (evalLink.querySelector) {
      evalLink.querySelectorAll('img,svg,i').forEach((e) => found.push(e.outerHTML.slice(0, 300)));
    }
    // following siblings until <br>
    let sib = evalLink.nextSibling;
    while (sib && !(sib.nodeType === 1 && sib.tagName.toLowerCase() === 'br')) {
      inspect(sib);
      sib = sib.nextSibling;
    }
    // preceding siblings until <br>
    sib = evalLink.previousSibling;
    while (sib && !(sib.nodeType === 1 && sib.tagName.toLowerCase() === 'br')) {
      inspect(sib);
      sib = sib.previousSibling;
    }
    return { present: found.length > 0, html: found.length ? found.join('\n') : null };
  }

  // Parse the action cell of one row (tr#fr<n>).
  function parseActionRow(tr) {
    const res = {
      similarityUrl: null, similarityPct: null,
      duplicateUrl: null, duplicateScore: null,
      details: null, evaluateUrl: null, evaluateWarning: { present: false, html: null },
      decisionUrl: null, assignEditorArgs: null,
    };
    const menu = tr.querySelector('.al-expanded') || tr;
    const links = menu.querySelectorAll('a');
    links.forEach((a) => {
      const label = cleanText(a);
      const href = a.getAttribute('href') || '';
      const part = classifyActionLink(label, href);
      Object.assign(res, part);
      if (part.similarityUrl) {
        // sibling span "(N%)"
        let sib = a.nextElementSibling;
        if (sib && sib.tagName.toLowerCase() === 'span') res.similarityPct = parsePercent(sib.textContent);
      }
      if (part.duplicateUrl) {
        const span = (a.parentElement && a.parentElement.querySelector('span[title="EM Duplicate Score"]')) ||
          (a.nextElementSibling && a.nextElementSibling.tagName.toLowerCase() === 'span' ? a.nextElementSibling : null);
        if (span) res.duplicateScore = parsePercent(span.textContent);
      }
      if (part.evaluateUrl) res.evaluateWarning = detectEvaluateWarning(a);
    });
    return res;
  }

  // Find the frozen grid in a folder list document.
  // Returns null if this page has no frozen grid.
  function findGrid(doc) {
    const tables = doc.querySelectorAll('table#datatable');
    if (tables.length < 2) return null;
    return { actionTable: tables[0], dataTable: tables[1] };
  }

  // Parse every row of a frozen-grid folder list.
  // Returns [{rowIndex, docId, ms, revision, possibleDuplicate, actionRow, dataRow, actions}]
  function parseGrid(doc) {
    const grid = findGrid(doc);
    if (!grid) return [];
    const actionRows = {};
    grid.actionTable.querySelectorAll('tr[data-rowindex]').forEach((tr) => {
      actionRows[tr.getAttribute('data-rowindex')] = tr;
    });
    const rows = [];
    grid.dataTable.querySelectorAll('tr[data-rowindex]').forEach((dataRow) => {
      const idx = dataRow.getAttribute('data-rowindex');
      const actionRow = actionRows[idx] || null;
      const firstCell = dataRow.querySelector('td');
      const ms = cleanText(firstCell);
      rows.push({
        rowIndex: idx,
        docId: dataRow.getAttribute('data-identity'),
        ms,
        revision: msRevision(ms),
        possibleDuplicate: !!dataRow.querySelector('img[src$="dupdoc.gif"]'),
        actionRow,
        dataRow,
        actions: actionRow ? parseActionRow(actionRow) : null,
      });
    });
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Popup pages (fetched with GET + DOMParser)
  // ---------------------------------------------------------------------------

  // Similarity popup: "Completed" link -> CrossCheckResults URL.
  // Returns {reportUrl, apiSubmissionId} or null.
  function parseSimilarityPage(doc) {
    const links = doc.querySelectorAll('a[id$="_lnkReportStatus"]');
    for (const a of links) {
      const call = parseJsCall(a.getAttribute('href'));
      if (call && call.fn === 'openV2ReportWindow' && call.args.length >= 3) {
        const [docId, msid, apiId] = call.args;
        return {
          apiSubmissionId: String(apiId),
          reportUrl: absUrl('CrossCheckResults.aspx?docID=' + encodeURIComponent(docId) +
            '&msid=' + encodeURIComponent(msid) +
            '&APISubmissionID=' + encodeURIComponent(apiId)),
        };
      }
    }
    return null;
  }

  // Duplicate Submission Check page.
  // Returns [{ms, titleSim, authorSim, abstractSim}] (one per candidate).
  function parseDuplicatePage(doc) {
    const table = doc.querySelector('table#gridResults');
    if (!table) return [];
    const headerRow = table.querySelector('tr');
    const headers = headerRow ? Array.from(headerRow.querySelectorAll('th')).map(cleanText) : [];
    const col = (re, fallback) => {
      const i = headers.findIndex((h) => re.test(h));
      return i >= 0 ? i : fallback;
    };
    const iTitle = col(/^Article Title Similarity/i, 6);
    const iAuthor = col(/^Author Similarity/i, 7);
    const iAbstract = col(/^Abstract Similarity/i, 8);
    const rows = [];
    // Only the table's own rows (not rows of nested tables) that carry a
    // manuscript number: one per candidate.
    gridRows(table).forEach((tr) => {
      const tds = tr.querySelectorAll(':scope > td');
      if (tds.length < 9) return;
      const msEl = tds[0].querySelector('span[id$="_SubPubNumberValue"]');
      if (!msEl) return;
      rows.push({
        ms: cleanText(msEl),
        titleSim: parsePercent(tds[iTitle].textContent),
        authorSim: parsePercent(tds[iAuthor].textContent),
        abstractSim: parsePercent(tds[iAbstract].textContent),
      });
    });
    return rows;
  }

  function gridRows(table) {
    return Array.from(table.querySelectorAll(':scope > tbody > tr, :scope > thead > tr, :scope > tr'));
  }

  // Counts only (no data), to compare a fetched copy of the Duplicate page
  // with the rendered one.
  function duplicatePageStats(doc) {
    const table = doc.querySelector('table#gridResults');
    if (!table) return null;
    const direct = gridRows(table);
    const msSpans = table.querySelectorAll('span[id$="_SubPubNumberValue"]');
    return {
      allTr: table.querySelectorAll('tr').length,
      directTr: direct.length,
      directWithMs: direct.filter((tr) => tr.querySelector('span[id$="_SubPubNumberValue"]')).length,
      msSpans: msSpans.length,
      distinctMs: new Set(Array.from(msSpans).map(cleanText)).size,
      nestedTables: table.querySelectorAll('table').length,
      hiddenRows: direct.filter((tr) => /display\s*:\s*none/i.test(tr.getAttribute('style') || '')).length,
    };
  }

  // Step 2 rule: OK if EM score <= 50 and no title/abstract similarity > 70.
  function summarizeDuplicates(emScore, rows) {
    const max = (k) => rows.reduce((m, r) => (r[k] != null && r[k] > m ? r[k] : m), 0);
    const maxTitle = max('titleSim');
    const maxAbstract = max('abstractSim');
    const flagged = rows.filter((r) =>
      (r.titleSim != null && r.titleSim > DUP_SIMILARITY_MAX) ||
      (r.abstractSim != null && r.abstractSim > DUP_SIMILARITY_MAX));
    const scoreOk = emScore == null ? null : emScore <= DUP_EM_SCORE_MAX;
    return {
      emScore,
      maxTitle,
      maxAbstract,
      candidates: rows.length,
      flagged: flagged.map((r) => r.ms),
      ok: scoreOk !== false && flagged.length === 0,
      unknownScore: emScore == null,
    };
  }

  // Details popup: extract the Author Status URL.
  function parseDetailsPage(doc) {
    for (const a of doc.querySelectorAll('a')) {
      const call = parseJsCall(a.getAttribute('href'));
      if (call && call.fn === 'ViewOtherAuthorStatusPopUp' && call.args.length) {
        return { authorStatusUrl: absUrl(call.args[0]) };
      }
    }
    return null;
  }

  // Author Status: split a roles cell into role names.
  // EM separates roles with <br>; textContent loses them, so callers pass the
  // cell's innerHTML or an array. Accept both.
  function splitRoles(htmlOrText) {
    return String(htmlOrText || '')
      .split(/<br\s*\/?>|\n/i)
      .map((s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  // Step 3 rule: at least one role other than "Writing – review & editing".
  function onlyReviewEditing(roles) {
    if (!roles.length) return false; // no roles: shown separately as "none"
    return roles.every((r) => /^writing\s*[-–—]\s*review\s*(&|and)\s*editing$/i.test(r));
  }

  function parseAuthorTable(table, corresponding) {
    if (!table) return [];
    const headers = Array.from(table.querySelectorAll('tr th')).map(cleanText);
    const idx = (name) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    const iOrder = idx('Order');
    const iName = idx('Author Name');
    const iRoles = idx('Contributor Roles');
    const iConfirmed = idx('Confirmed?');
    const out = [];
    table.querySelectorAll('tr').forEach((tr) => {
      const tds = tr.querySelectorAll(':scope > td');
      if (!tds.length || iName < 0 || tds.length <= iName) return;
      const roles = iRoles >= 0 && tds[iRoles] ? splitRoles(tds[iRoles].innerHTML) : [];
      out.push({
        order: iOrder >= 0 && tds[iOrder] ? cleanText(tds[iOrder]) : '',
        name: cleanText(tds[iName]),
        roles,
        onlyReviewEditing: onlyReviewEditing(roles),
        noRoles: roles.length === 0,
        confirmed: iConfirmed >= 0 && tds[iConfirmed] ? cleanText(tds[iConfirmed]) : '',
        corresponding: !!corresponding,
      });
    });
    return out;
  }

  // Author Status page -> [{order, name, roles, onlyReviewEditing, noRoles, confirmed, corresponding}]
  function parseAuthorStatusPage(doc) {
    return parseAuthorTable(doc.querySelector('table#CorrAuthorGridView'), true)
      .concat(parseAuthorTable(doc.querySelector('table#OtherAuthorsGridView'), false));
  }

  // Main Menu folders (aries-folder-item web components).
  function parseFolders(doc) {
    return Array.from(doc.querySelectorAll('aries-folder-item')).map((el) => ({
      linkId: el.getAttribute('link-id'),
      url: el.getAttribute('nvgurl'),
      counts: {
        green: Number(el.getAttribute('green') || 0),
        orange: Number(el.getAttribute('orange') || 0),
        red: Number(el.getAttribute('red') || 0),
      },
    }));
  }

  const api = {
    EM_BASE, DUP_EM_SCORE_MAX, DUP_SIMILARITY_MAX,
    parseJsArgs, parseJsCall, parsePercent, isMsNumber, msRevision, absUrl,
    classifyActionLink, detectEvaluateWarning, parseActionRow, findGrid, parseGrid,
    parseSimilarityPage, parseDuplicatePage, duplicatePageStats, summarizeDuplicates,
    parseDetailsPage, splitRoles, onlyReviewEditing, parseAuthorStatusPage, parseFolders,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PREH = root.PREH || {};
  root.PREH.parse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
