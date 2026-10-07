// storage.js — thin wrapper around chrome.storage.local.
// Classic script (shared by content scripts and the popup): exposes PREH.storage.
//
// Per-manuscript records live under "ms:<manuscript number>":
//   {status, note, updatedAt, checklist: {...}, sendBackNotes}
// Extension settings live under "preh:<name>".
(function (root) {
  'use strict';

  const MS_PREFIX = 'ms:';
  const DEV_KEY = 'preh:dev';

  const STATUSES = ['', 'In triage', 'Waiting (reply)', 'Send back requested', 'Ready to assign', 'Done'];

  function emptyRecord() {
    return { status: '', note: '', updatedAt: null, checklist: {}, sendBackNotes: '' };
  }

  async function get(ms) {
    const key = MS_PREFIX + ms;
    const res = await chrome.storage.local.get(key);
    return Object.assign(emptyRecord(), res[key] || {});
  }

  // Shallow-merge `patch` into the record and bump updatedAt.
  async function update(ms, patch) {
    const rec = Object.assign(await get(ms), patch, { updatedAt: new Date().toISOString() });
    await chrome.storage.local.set({ [MS_PREFIX + ms]: rec });
    return rec;
  }

  // All manuscript records as {ms: record}.
  async function all() {
    const everything = await chrome.storage.local.get(null);
    const out = {};
    for (const [k, v] of Object.entries(everything)) {
      if (k.startsWith(MS_PREFIX)) out[k.slice(MS_PREFIX.length)] = v;
    }
    return out;
  }

  // Export format: {format, exportedAt, records: {ms: record}}
  async function exportAll() {
    return { format: 'preh-notes-v1', exportedAt: new Date().toISOString(), records: await all() };
  }

  // Import records. A record replaces the stored one only if it is newer
  // (or the stored one has no date). Returns the number of records written.
  async function importAll(data) {
    if (!data || data.format !== 'preh-notes-v1' || typeof data.records !== 'object') {
      throw new Error('Not a PR EM Helper export file');
    }
    const current = await all();
    const toSet = {};
    for (const [ms, rec] of Object.entries(data.records)) {
      const cur = current[ms];
      if (!cur || !cur.updatedAt || (rec.updatedAt && rec.updatedAt > cur.updatedAt)) {
        toSet[MS_PREFIX + ms] = Object.assign(emptyRecord(), rec);
      }
    }
    await chrome.storage.local.set(toSet);
    return Object.keys(toSet).length;
  }

  async function isDev() {
    const res = await chrome.storage.local.get(DEV_KEY);
    return !!res[DEV_KEY];
  }

  async function setDev(on) {
    await chrome.storage.local.set({ [DEV_KEY]: !!on });
  }

  root.PREH = root.PREH || {};
  root.PREH.storage = { STATUSES, MS_PREFIX, DEV_KEY, emptyRecord, get, update, all, exportAll, importAll, isDev, setDev };
})(globalThis);
