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

  // Same manuscript -> same colour (cockpit header bar and the list's Triage
  // button), so several triage tabs are easy to tell apart.
  function msColor(ms) {
    let h = 0;
    for (const ch of String(ms)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360}, 55%, 30%)`;
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

  // Manuscript number = text of the first data cell, ignoring anything the
  // extension injected there (elements with a preh- class).
  function msFromCell(td) {
    if (!td) return '';
    let text = '';
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) text += c.nodeValue;
        else if (c.nodeType === 1 && !/(^|\s)preh-/.test(c.getAttribute('class') || '')) walk(c);
      }
    };
    walk(td);
    return text.replace(/\s+/g, ' ').trim();
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
      const ms = msFromCell(dataRow.querySelector('td'));
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
    // EM repeats candidates (a varying number of times per request), so
    // count and flag distinct manuscripts.
    const flagged = new Set(rows.filter((r) =>
      (r.titleSim != null && r.titleSim > DUP_SIMILARITY_MAX) ||
      (r.abstractSim != null && r.abstractSim > DUP_SIMILARITY_MAX)).map((r) => r.ms));
    const scoreOk = emScore == null ? null : emScore <= DUP_EM_SCORE_MAX;
    return {
      emScore,
      maxTitle,
      maxAbstract,
      candidates: new Set(rows.map((r) => r.ms)).size,
      flagged: Array.from(flagged),
      ok: scoreOk !== false && flagged.size === 0,
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

  // ---------------------------------------------------------------------------
  // CRediT check (docs/credit-rules.md). Elsevier training: every author needs
  // (1) a substantial contribution and (2) drafting or critical revision.
  // Graded: strict where the training is clear, tolerant on harmless patterns.
  // ---------------------------------------------------------------------------

  const CREDIT_ROLES = [
    ['Conceptualization', 'substantive'],
    ['Methodology', 'substantive'],
    ['Investigation', 'substantive'],
    ['Data curation', 'substantive'],
    ['Formal analysis', 'substantive'],
    ['Software', 'substantive'],
    ['Validation', 'substantive'],
    ['Visualization', 'substantive'],
    ['Writing – original draft', 'writing'],
    ['Writing – review & editing', 'writing'],
    ['Funding acquisition', 'support'],
    ['Resources', 'support'],
    ['Supervision', 'support'],
    ['Project administration', 'support'],
  ];
  const ORIGINAL_DRAFT = 'Writing – original draft';

  // Case-insensitive, whitespace collapsed, –/—/- and "and"/"&" equivalent.
  function roleKey(s) {
    return String(s).toLowerCase().replace(/[–—-]/g, '-').replace(/\band\b/g, '&')
      .replace(/\s*([-&])\s*/g, '$1').replace(/\s+/g, ' ').trim();
  }
  const ROLE_BY_KEY = new Map(CREDIT_ROLES.map(([name, cls]) => [roleKey(name), { name, cls }]));

  // 'Writing - Review and Editing' -> {name: 'Writing – review & editing', cls: 'writing'};
  // unknown strings -> {name: <as given>, cls: 'unknown'}.
  function classifyRole(s) {
    return ROLE_BY_KEY.get(roleKey(s)) || { name: String(s).trim(), cls: 'unknown' };
  }

  // Per-author flags (section 4 of the rules).
  function creditAuthor(a) {
    const roles = a.roles.map(classifyRole);
    const has = (cls) => roles.some((r) => r.cls === cls);
    const noRoles = roles.length === 0;
    const noSubstantive = !noRoles && !has('substantive');
    let kind = null;
    if (noSubstantive) {
      kind = has('writing') && has('support') ? 'writingAndSupport'
        : has('writing') && !has('support') && !has('unknown') ? 'writingOnly'
        : has('support') && !has('writing') && !has('unknown') ? 'supportOnly'
        : 'other';
    }
    return {
      order: a.order, name: a.name, roles,
      noRoles, noSubstantive, kind,
      noWriting: !noRoles && !has('writing'),
      allRoles: new Set(roles.filter((r) => r.cls !== 'unknown').map((r) => r.name)).size >= 12,
      unknown: roles.filter((r) => r.cls === 'unknown').map((r) => r.name),
    };
  }

  // Paper-level classification (section 5). level: 'red' | 'yellow' | 'green'.
  function creditAssessment(authorsIn) {
    const authors = authorsIn.map(creditAuthor);
    const deficient = authors.filter((a) => a.noRoles || a.noSubstantive);
    const noRolesList = authors.filter((a) => a.noRoles);
    const noCredit = authors.length > 0 && noRolesList.length === authors.length;
    const noOriginalDraft = authors.length > 0 && !authors.some((a) => a.roles.some((r) => r.name === ORIGINAL_DRAFT));
    const single = authors.length === 1;
    let level = 'green';
    if (noCredit || noRolesList.length || deficient.length >= 2 || (single && deficient.length)) level = 'red';
    else if (deficient.length === 1 || noOriginalDraft) level = 'yellow';

    const reasons = [];
    if (noCredit) reasons.push('no CRediT statement');
    else if (noRolesList.length) reasons.push(noRolesList.length + ' without roles');
    const noSub = deficient.filter((a) => !a.noRoles).length;
    if (noSub) reasons.push(noSub + ' without substantial contribution');
    if (noOriginalDraft && !noCredit) reasons.push('no original draft');
    return { level, authors, deficient, noRolesList, noCredit, noOriginalDraft, single, reasons };
  }

  // "A", "A and B", "A, B and C"
  function joinNames(names) {
    return names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }
  const quoteRoles = (roles) => joinNames(roles.map((r) => '"' + r.name + '"'));

  // Plain-words flags for one author (cockpit display).
  function creditAuthorFlags(a) {
    const out = [];
    if (a.noRoles) out.push('no roles');
    if (a.kind === 'writingOnly') out.push('no substantial contribution (writing only)');
    if (a.kind === 'supportOnly') out.push('support roles only');
    if (a.kind === 'writingAndSupport') out.push('no substantial contribution (writing and support only)');
    if (a.kind === 'other') out.push('no substantial contribution');
    if (a.noWriting) out.push('no writing role (info)');
    if (a.allRoles) out.push('all roles');
    if (a.unknown.length) out.push('unrecognized role: ' + a.unknown.join(', '));
    return out;
  }

  // ---------------------------------------------------------------------------
  // Message generator (docs/credit-rules.md §7): deterministic templates, no
  // AI, all local. Same input -> same text. The extension never sends it.
  // ---------------------------------------------------------------------------

  const CREDIT_FIXED_PARAGRAPH = 'Authors are free to choose their CRediT roles, but these should reflect each author\'s actual contribution. According to the journal\'s authorship criteria, each author should have made a substantial contribution to the conception or design of the work, or to the acquisition, analysis or interpretation of data, and should have drafted the work or revised it critically for important intellectual content. Could you please check the contributor roles of all authors against these criteria and update the statement where needed, both in Editorial Manager and in the manuscript?';
  const CREDIT_MISSING = 'We noticed that the author contribution (CRediT) statement is missing.';
  // Support roles named for an allRoles author, in this order of preference.
  const SUPPORT_PREFERENCE = ['Funding acquisition', 'Supervision', 'Resources', 'Project administration'];

  // §7.1: the issue sentences (without the opening) and the number of issues.
  function creditIssues(c) {
    const sentences = [];
    let issues = 0;
    // Step 1: authors without a substantial contribution, grouped by identical role set.
    const groups = [];
    for (const a of c.authors.filter((x) => x.noSubstantive)) {
      const key = a.roles.map((r) => r.name).slice().sort().join('|');
      let g = groups.find((x) => x.key === key);
      if (!g) groups.push(g = { key, roles: a.roles, names: [] });
      g.names.push(a.name);
    }
    if (groups.length) {
      issues += groups.length;
      const clauses = groups.map((g, i) => joinNames(g.names) +
        (i === 0 ? (g.names.length === 1 ? ' is listed only under ' : ' are listed only under ') : ' only under ') +
        quoteRoles(g.roles));
      sentences.push(clauses.length === 1 ? clauses[0] + '.'
        : clauses.slice(0, -1).join(', ') + ', and ' + clauses[clauses.length - 1] + '.');
    }
    // Step 2: an author with (almost) all roles, only when 2+ authors are deficient.
    if (c.deficient.length >= 2) {
      for (const a of c.authors.filter((x) => x.allRoles)) {
        issues++;
        const held = SUPPORT_PREFERENCE.filter((n) => a.roles.some((r) => r.name === n)).slice(0, 2);
        sentences.push(`At the same time, ${a.name} is listed under almost all contributor roles` +
          (held.length ? ', including ' + joinNames(held.map((n) => '"' + n + '"')) : '') + '.');
      }
    }
    // Step 3: nobody wrote the original draft.
    if (c.noOriginalDraft) issues++;
    // Step 4: authors without roles.
    if (c.noRolesList.length) issues++;
    if (c.noOriginalDraft) {
      sentences.push(issues === 1 ? 'No author is listed under "Writing – original draft".'
        : 'In addition, no author is listed under "Writing – original draft".');
    }
    if (c.noRolesList.length) sentences.push(`No contributor roles are listed for ${joinNames(c.noRolesList.map((a) => a.name))}.`);
    return { sentences, issues };
  }

  // (A) Comments to authors — RED.
  function creditCommentsText(c) {
    let first;
    if (c.noCredit) {
      first = CREDIT_MISSING;
    } else {
      const { sentences, issues } = creditIssues(c);
      if (!issues) return '';
      first = `We noticed ${issues > 1 ? 'some issues' : 'an issue'} with the author contribution (CRediT) statement of your manuscript. ` + sentences.join(' ');
    }
    let second = CREDIT_FIXED_PARAGRAPH;
    if (c.noOriginalDraft && !c.noCredit) second += ' Please also make sure that the author(s) who drafted the manuscript are listed under "Writing – original draft".';
    if (c.noRolesList.length || c.noCredit) second += ' Please also make sure that contributor roles are provided for all authors.';
    return first + '\n\n' + second;
  }

  // Send-back email to the Journal Manager (Antonino's template). The JM
  // performs the send back with the comments; topic = what must be fixed.
  function sendBackEmail(ms, topic, subjectTopic, comments, opts) {
    const o = Object.assign({ recipient: 'Sami', signature: 'Antonino' }, opts);
    return {
      subject: `${ms} – Send back to authors (${subjectTopic})`,
      body: `Dear ${o.recipient},\n\nDuring the initial assessment of manuscript ${ms}, I noticed an issue with the ${topic} that should be addressed before the manuscript can proceed to peer review. Could you please send it back to the authors with the comments below?\n\n--- Comments to authors ---\n${comments}\n---\n\nOnce the authors resubmit, please assign the manuscript back to me so that I can complete the assessment.\n\nThank you very much,\n${o.signature}`,
    };
  }

  // (B) Email to the Journal Manager — RED (wraps A).
  function creditEmail(c, ms, opts) {
    const a = creditCommentsText(c);
    if (!a) return null;
    return sendBackEmail(ms, 'author contribution (CRediT) statement', 'CRediT statement', a, opts);
  }

  // mailto: link that opens a draft in Antonino's mail program (nothing is sent).
  function mailtoUrl(to, subject, body) {
    const q = encodeURIComponent;
    return `mailto:${q(to || '').replace(/%40/g, '@')}?subject=${q(subject)}&body=${q(body.replace(/\r?\n/g, '\r\n'))}`;
  }

  // (C) Note to the AE — YELLOW (or a RED case not sent back).
  function creditAeNote(c) {
    const body = c.noCredit ? 'the author contribution (CRediT) statement is missing.' : creditIssues(c).sentences.join(' ');
    if (!body) return '';
    return `A note on the CRediT statement, not blocking at triage: ${body} It would be good to ask the authors to complete it at the first revision.`;
  }

  // The text that fits the level: (A) for red, (C) for yellow, '' for green.
  function creditText(c) {
    return c.level === 'red' ? creditCommentsText(c) : c.level === 'yellow' ? creditAeNote(c) : '';
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
  // Both tables merged and sorted by Order (the corresponding author can be any number).
  function parseAuthorStatusPage(doc) {
    const num = (o) => (/^\d+$/.test(o) ? Number(o) : Infinity);
    return parseAuthorTable(doc.querySelector('table#CorrAuthorGridView'), true)
      .concat(parseAuthorTable(doc.querySelector('table#OtherAuthorsGridView'), false))
      .sort((x, y) => num(x.order) - num(y.order));
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
    parseJsArgs, parseJsCall, parsePercent, isMsNumber, msRevision, msColor, absUrl,
    classifyActionLink, detectEvaluateWarning, parseActionRow, msFromCell, findGrid, parseGrid,
    parseSimilarityPage, parseDuplicatePage, duplicatePageStats, summarizeDuplicates,
    parseDetailsPage, splitRoles, onlyReviewEditing, CREDIT_ROLES, classifyRole, creditAuthor, creditAssessment, creditAuthorFlags, creditIssues, creditCommentsText, sendBackEmail, creditEmail, mailtoUrl, creditAeNote, creditText, parseAuthorStatusPage, parseFolders,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PREH = root.PREH || {};
  root.PREH.parse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
