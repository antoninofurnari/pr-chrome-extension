// router.js — decides what to run in the current EM frame.
// Runs in every EM frame (all_frames). Must be idempotent: EM reloads
// iframe#content on every folder change.
(function () {
  'use strict';
  if (window.__prehRouted) return;
  window.__prehRouted = true;

  // Wake the service worker (dev hot-reload loop) if Chrome stopped it.
  try { chrome.runtime.sendMessage({ type: 'preh:hello' }).catch(() => {}); } catch (_) { /* extension reloaded */ }

  function context() {
    if (window.name && window.name.startsWith('preh-')) return 'embedded'; // our own iframes
    if (window === window.top) {
      return /\/pr\/default2\.aspx$/i.test(location.pathname) ? 'top' : 'popup';
    }
    let fe = null;
    try { fe = window.frameElement; } catch (_) { /* cross-origin parent */ }
    if (fe && fe.id === 'content' && window.parent === window.top) return 'content';
    return 'other';
  }

  const ctx = context();
  PREH.context = ctx;

  if (ctx === 'top') PREH.cockpit.init();
  if (ctx === 'content') PREH.list.init();
})();
