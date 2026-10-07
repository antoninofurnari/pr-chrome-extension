// main-world.js — tiny bridge running in the page's MAIN world (top window).
// Content scripts live in an isolated world and can't call EM's functions, so
// they ask this script via window.postMessage. Only one call is allowed:
// editorAssignment(...), which merely OPENS EM's Assign Editor popup.
(function () {
  'use strict';
  const REQ = 'preh:editorAssignment';
  const RES = 'preh:editorAssignment:result';

  function valid(a) {
    return Array.isArray(a) && a.length === 7 &&
      /^\d+$/.test(String(a[0])) &&
      a.slice(1, 6).every((x) => typeof x === 'boolean') &&
      typeof a[6] === 'string';
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.type !== REQ) return;
    const reply = (ok, error) => window.postMessage({ type: RES, ok, error: error || null }, location.origin);
    if (!valid(e.data.args)) return reply(false, 'invalid arguments');
    if (typeof window.editorAssignment !== 'function') return reply(false, 'editorAssignment is not defined here');
    try {
      window.editorAssignment.apply(window, e.data.args);
      reply(true);
    } catch (err) {
      reply(false, String(err && err.message || err));
    }
  });
})();
