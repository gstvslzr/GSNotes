// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
/* ============================================================
   Boot
   ============================================================ */
(async function boot() {
  $('#editor').innerHTML = '<div class="empty" style="margin:auto"><p>Opening your notes…</p></div>';
  try { await loadAll(); } catch (e) { console.error(e); toast('Could not open storage: ' + e.message, true, 8000); }
  applyTheme();
  $('#rail').addEventListener('click', railClick);
  $('#rail').addEventListener('contextmenu', railContext);
  $('#rail').addEventListener('dblclick', (e) => { const t = e.target.closest('[data-folder]'); if (t && t.dataset.folder !== '__none') folderDialog(S.folders.get(t.dataset.folder)); });
  listEvents(); editorEvents(); viewEvents(); projectEvents(); backupEvents();
  document.addEventListener('keydown', globalKeys);
  for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, () => { lastActivity = now(); }, { passive: true });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (S.ui.view === 'graph') renderView(); });
  // open the most recent note so the first view shows real content
  const params = new URLSearchParams(location.search);
  const recent = liveNotes().filter((n) => !n.locked && n.folderId !== S.settings.templateFolder).sort((a, b) => b.updatedAt - a.updatedAt);
  const welcome = recent.find((n) => n.title === 'Welcome to GSNotes');
  S.ui.noteId = (welcome || recent[0])?.id || null;
  S.ui.pane = matchMedia('(max-width: 820px)').matches ? 'list' : 'editor';
  render();
  if (params.get('action') === 'capture') quickCapture();
  if (params.get('action') === 'today') getOrCreateDaily().then((n) => openNote(n.id));
  if (window.gsDesktop?.onCommand) window.gsDesktop.onCommand((cmd) => { if (cmd === 'capture') quickCapture(); if (cmd === 'today') getOrCreateDaily().then((n) => openNote(n.id)); if (cmd === 'palette') openPalette(); });
  setInterval(checkReminders, 30000); setTimeout(checkReminders, 2000);
  setInterval(checkIdle, 15000);
  setTimeout(() => runAutoBackup(), 8000); setInterval(() => runAutoBackup(), 30 * 60 * 1000);
  if ('serviceWorker' in navigator && !IN_FRAME && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage?.persist && !IN_FRAME) navigator.storage.persist().catch(() => {});
})();
