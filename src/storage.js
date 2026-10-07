// storage.js — thin wrapper around chrome.storage.local.
// Classic script (shared by content scripts and the popup): exposes PREH.storage.
//
// Per-manuscript records live under "ms:<manuscript number>":
//   {status, statusAt, note, updatedAt, checklist: {...}, sendBackNotes}
// statusAt = when the status last changed (for "Waiting · 4d").
// Extension settings live under "preh:<name>".
(function (root) {
  'use strict';

  const MS_PREFIX = 'ms:';
  const DEV_KEY = 'preh:dev';

  const STATUSES = ['', 'In triage', 'Waiting (reply)', 'Send back requested', 'Ready to assign', 'Ready to reject', 'Done'];

  function emptyRecord() {
    return { status: '', statusAt: null, note: '', updatedAt: null, checklist: {}, sendBackNotes: '' };
  }

  async function get(ms) {
    const key = MS_PREFIX + ms;
    const res = await chrome.storage.local.get(key);
    return Object.assign(emptyRecord(), res[key] || {});
  }

  // Shallow-merge `patch` into the record and bump updatedAt. Writes are
  // chained so two quick updates (status, then note) don't overwrite each other.
  let queue = Promise.resolve();
  function update(ms, patch) {
    const run = async () => {
      const rec = Object.assign(await get(ms), patch, { updatedAt: new Date().toISOString() });
      await chrome.storage.local.set({ [MS_PREFIX + ms]: rec });
      return rec;
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  // Several records at once: {ms: record} (empty records for unknown ms).
  async function getMany(list) {
    const res = await chrome.storage.local.get(list.map((ms) => MS_PREFIX + ms));
    const out = {};
    for (const ms of list) out[ms] = Object.assign(emptyRecord(), res[MS_PREFIX + ms] || {});
    return out;
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
  root.PREH.storage = { STATUSES, MS_PREFIX, DEV_KEY, emptyRecord, get, getMany, update, all, exportAll, importAll, isDev, setDev };
})(globalThis);
