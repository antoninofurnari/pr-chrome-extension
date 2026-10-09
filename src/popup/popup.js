// popup.js — export/import of notes (F3) and the dev-mode toggle.
'use strict';

const S = PREH.storage;
const $ = (id) => document.getElementById(id);
// Opened as a tab (see Import) rather than as the toolbar popup.
const IN_TAB = new URLSearchParams(location.search).has('tab');

function say(text) { $('msg').textContent = text; }

async function refresh() {
  $('count').textContent = Object.keys(await S.all()).length;
  $('dev').checked = await S.isDev();
  try {
    const res = await fetch(chrome.runtime.getURL('dev-stamp.txt'), { cache: 'no-store' });
    $('build').textContent = res.ok ? (await res.text()).trim() : 'no dev-stamp.txt';
  } catch (_) {
    $('build').textContent = 'no dev-stamp.txt (run scripts/stamp.sh)';
  }
}

$('export').addEventListener('click', async () => {
  const data = await S.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pr-em-helper-notes-' + data.exportedAt.slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  say('Exported ' + Object.keys(data.records).length + ' records.');
});

// The toolbar popup closes when the file picker opens, so import runs in a tab.
$('import').addEventListener('click', () => {
  if (IN_TAB) $('file').click();
  else chrome.tabs.create({ url: chrome.runtime.getURL('src/popup/popup.html?tab=1') });
});

$('file').addEventListener('change', async () => {
  const f = $('file').files[0];
  if (!f) return;
  try {
    const n = await S.importAll(JSON.parse(await f.text()));
    say('Imported ' + n + ' records (newer ones only).');
  } catch (e) {
    say('Import failed: ' + e.message);
  }
  $('file').value = '';
  refresh();
});

$('dev').addEventListener('change', () => S.setDev($('dev').checked));

S.getSettings().then((o) => { $('recipient').value = o.recipient; $('signature').value = o.signature; });
for (const id of ['recipient', 'signature']) {
  $(id).addEventListener('input', () => S.setSettings({ recipient: $('recipient').value.trim(), signature: $('signature').value.trim() }));
}

refresh();
