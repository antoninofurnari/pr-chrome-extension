// service-worker.js — dev hot reload only. No long-lived state: everything that
// must survive the worker being killed is kept in chrome.storage.local.
//
// Dev mode (toggled from the popup, key "preh:dev"):
//   every ~1.5 s fetch dev-stamp.txt (written by scripts/stamp.sh). When its
//   content changes: remember the new stamp, set "preh:reloadTabs",
//   chrome.runtime.reload(). On the next start the worker reloads EM tabs so
//   they get the new content scripts.
'use strict';

const DEV_KEY = 'preh:dev';
const STAMP_KEY = 'preh:lastStamp';
const RELOAD_TABS_KEY = 'preh:reloadTabs';
const STAMP_URL = chrome.runtime.getURL('dev-stamp.txt');
const EM_TABS = 'https://www.editorialmanager.com/pr/*';
const POLL_MS = 1500;

let timer = null;

async function readStamp() {
  try {
    const res = await fetch(STAMP_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch (_) {
    return null; // file missing: run scripts/stamp.sh once
  }
}

async function tick() {
  // The storage call also keeps the worker alive while dev mode is on.
  const st = await chrome.storage.local.get([DEV_KEY, STAMP_KEY]);
  if (!st[DEV_KEY]) { stopPolling(); return; }
  const stamp = await readStamp();
  if (stamp === null) return;
  if (st[STAMP_KEY] === undefined) {
    await chrome.storage.local.set({ [STAMP_KEY]: stamp });
    return;
  }
  if (stamp !== st[STAMP_KEY]) {
    await chrome.storage.local.set({ [STAMP_KEY]: stamp, [RELOAD_TABS_KEY]: true });
    chrome.runtime.reload();
  }
}

function startPolling() {
  if (timer) return;
  timer = setInterval(() => { tick().catch(() => {}); }, POLL_MS);
  tick().catch(() => {});
}

function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function init() {
  const st = await chrome.storage.local.get([DEV_KEY, RELOAD_TABS_KEY]);
  if (st[RELOAD_TABS_KEY]) {
    await chrome.storage.local.remove(RELOAD_TABS_KEY);
    const tabs = await chrome.tabs.query({ url: EM_TABS });
    for (const t of tabs) chrome.tabs.reload(t.id);
  }
  if (st[DEV_KEY]) startPolling();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[DEV_KEY]) return;
  if (changes[DEV_KEY].newValue) startPolling(); else stopPolling();
});

// Content scripts ping on every EM page load: this wakes the worker (and the
// poll loop) if Chrome had stopped it.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'preh:hello') sendResponse({ ok: true });
  if (msg.type === 'preh:stamp') {
    readStamp().then((stamp) => sendResponse({ stamp }));
    return true; // async response
  }
});

init();
