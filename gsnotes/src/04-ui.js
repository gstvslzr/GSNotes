// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
/* ============================================================
   UI: rail, note list, search
   ============================================================ */
const VIEWS = [
  ['notes', '≡', 'All notes'], ['tasks', '☐', 'Tasks'], ['board', '▥', 'Board'], ['calendar', '▦', 'Calendar'],
  ['graph', '⋈', 'Graph'], ['cards', '◩', 'Flashcards'], ['ask', '?', 'Ask my notes'], ['backup', '⛁', 'Backup & import'],
];
const liveNotes = () => [...S.notes.values()].filter((n) => !n.deleted);
const isProjectItem = (n) => !!(n.projectId && S.projects.has(n.projectId));
const dueCards = () => [...S.cards.values()].filter((c) => c.due <= now() && S.notes.get(c.noteId) && !S.notes.get(c.noteId).deleted);

function setPane(p) { S.ui.pane = p; $('#app').dataset.pane = p; }
function go(view, filter) {
  if (view === 'notes' || view === 'tasks') {
    S.ui.view = 'notes';
    S.ui.filter = filter || (view === 'tasks' ? { type: 'todo' } : { type: 'all' });
    S.ui.query = '';
    setPane('list');
  } else { S.ui.view = view; setPane('view'); }
  render();
}
function openNote(id) {
  const n = S.notes.get(id); if (!n) return;
  S.ui.noteId = id;
  if (S.ui.view !== 'notes') { S.ui.view = 'notes'; }
  setPane('editor');
  render();
}

function render() {
  const app = $('#app');
  app.classList.toggle('full-view', S.ui.view !== 'notes');
  app.dataset.pane = S.ui.pane;
  renderRail();
  if (S.ui.view === 'notes') { renderList(); renderEditor(); }
  else renderView();
}

/* ---------- rail ---------- */
function renderRail() {
  const f = S.ui.filter, v = S.ui.view;
  const counts = {};
  for (const n of liveNotes()) if (!(isProjectItem(n) && !n.folderId)) counts[n.folderId] = (counts[n.folderId] || 0) + 1;
  const projCounts = {}; for (const n of liveNotes()) if (n.projectId) projCounts[n.projectId] = (projCounts[n.projectId] || 0) + 1;
  const projects = [...S.projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  const tagCounts = {};
  for (const n of liveNotes()) if (!n.locked) for (const t of n.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const isActive = (id) => {
    if (id === 'notes') return v === 'notes' && f.type === 'all';
    if (id === 'tasks') return v === 'notes' && f.type === 'todo';
    return v === id;
  };
  const due = dueCards().length;
  const folderTree = (pid, depth = 0) => childFolders(pid).map((fo) => {
    const kids = childFolders(fo.id);
    const open = S.ui.expanded[fo.id] !== false;
    const active = v === 'notes' && f.type === 'folder' && f.id === fo.id;
    const ico = fo.vault ? (vaultUnlocked(fo.id) ? '◌' : '🔒') : (kids.length ? (open ? '▾' : '▸') : '•');
    return `<button class="nav-item${active ? ' active' : ''}" data-folder="${fo.id}" title="${esc(folderPath(fo.id))}"><span class="ico" ${kids.length ? `data-toggle="${fo.id}"` : ''}>${ico}</span><span class="lbl">${esc(fo.name)}</span><span class="count">${counts[fo.id] || ''}</span></button>
      ${kids.length && open ? `<div class="tree-children">${folderTree(fo.id, depth + 1)}</div>` : ''}`;
  }).join('');
  const tags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 40);
  $('#rail').innerHTML = `
    <div class="brand"><div class="brand-mark" aria-hidden="true">GS</div><div class="brand-name">GSNotes</div></div>
    <div class="rail-actions">
      <button class="btn primary" id="r-new" title="New note (Alt+N)">+ New</button>
      <button class="btn" id="r-today" title="Open today’s daily note">Today</button>
      <button class="btn" id="r-capture" title="Quick capture (Alt+Q)">Capture</button>
      <button class="btn" id="r-palette" title="Command palette (Ctrl+K)">⌘K</button>
    </div>
    <div class="rail-scroll">
      ${VIEWS.map(([id, ico, lbl]) => `<button class="nav-item${isActive(id) ? ' active' : ''}" data-view="${id}"><span class="ico">${ico}</span><span class="lbl">${esc(lbl)}</span>${id === 'backup' ? (!S.lastBackupAt || now() - S.lastBackupAt > 7 * 864e5 ? `<span class="count" style="color:var(--amber)" title="${S.lastBackupAt ? 'Last backup ' + Math.floor((now() - S.lastBackupAt) / 864e5) + ' days ago' : 'No backup yet'}">●</span>` : '') : id === 'cards' && due ? `<span class="count">${due} due</span>` : id === 'tasks' ? `<span class="count">${liveNotes().filter((n) => n.isTodo && !n.done).length || ''}</span>` : ''}</button>`).join('')}
      <div class="rail-h">Projects <span><button id="r-csvproj" title="Import a CSV file as a project">⇪</button><button id="r-addproj" title="New project">+</button></span></div>
      ${projects.map((p) => `<button class="nav-item${v === 'project' && S.ui.projectId === p.id ? ' active' : ''}" data-project="${p.id}"><span class="ico">${esc(p.icon || '◆')}</span><span class="lbl">${esc(p.name)}</span><span class="count">${projCounts[p.id] || ''}</span></button>`).join('') || '<p class="muted small" style="margin:2px 8px 6px">Track work in a grid, board, timeline or charts.</p>'}
      <div class="rail-h">Notebooks <span><button id="r-addvault" title="New vault notebook (encrypted)">🔒</button><button id="r-addfolder" title="New notebook">+</button></span></div>
      ${folderTree(null)}
      <button class="nav-item${v === 'notes' && f.type === 'folder' && f.id === null ? ' active' : ''}" data-folder="__none"><span class="ico">∅</span><span class="lbl">No notebook</span><span class="count">${counts[null] || counts[undefined] || ''}</span></button>
      ${tags.length ? `<div class="rail-h">Tags</div><div class="tag-cloud">${tags.map(([t, c]) => `<button class="chip${f.type === 'tag' && f.tag === t ? ' accent' : ''}" data-tag="${esc(t)}">#${esc(t)} <span class="muted">${c}</span></button>`).join('')}</div>` : ''}
      <div class="rail-h">More</div>
      <button class="nav-item${v === 'notes' && f.type === 'trash' ? ' active' : ''}" data-trash="1"><span class="ico">⌫</span><span class="lbl">Trash</span><span class="count">${[...S.notes.values()].filter((n) => n.deleted).length || ''}</span></button>
      <button class="nav-item${v === 'settings' ? ' active' : ''}" data-view="settings"><span class="ico">⚙</span><span class="lbl">Settings &amp; sync</span></button>
      ${S.keys.size ? `<button class="nav-item" id="r-lockall"><span class="ico">🔒</span><span class="lbl">Lock all vaults</span></button>` : ''}
      <p class="muted small" style="padding:10px 8px 0;margin:0">${DB.persistent ? 'Notes are saved on this device.' : '<b style="color:var(--bad)">Storage unavailable:</b> notes will be lost when you close this page. Export a backup from Settings.'}</p>
    </div>`;
}

function railClick(e) {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.toggle && e.target.closest('[data-toggle]')) { S.ui.expanded[t.dataset.toggle] = S.ui.expanded[t.dataset.toggle] === false; renderRail(); return; }
  if (t.dataset.view) return go(t.dataset.view);
  if (t.dataset.project) return openProject(t.dataset.project);
  if (t.dataset.folder) {
    const id = t.dataset.folder === '__none' ? null : t.dataset.folder;
    if (id && isVaultFolder(id) && !vaultUnlocked(id)) return unlockDialog(id);
    return go('notes', { type: 'folder', id });
  }
  if (t.dataset.tag) return go('notes', { type: 'tag', tag: t.dataset.tag });
  if (t.dataset.trash) return go('notes', { type: 'trash' });
  switch (t.id) {
    case 'r-new': return createNote();
    case 'r-today': return getOrCreateDaily().then((n) => openNote(n.id));
    case 'r-capture': return quickCapture();
    case 'r-palette': return openPalette();
    case 'r-addfolder': return folderDialog();
    case 'r-addproj': return newProjectDialog();
    case 'r-csvproj': return importCsvProject();
    case 'r-addvault': return vaultDialog();
    case 'r-lockall': return lockAll();
  }
}
function railContext(e) {
  const t = e.target.closest('[data-folder]'); if (!t || t.dataset.folder === '__none') return;
  e.preventDefault(); folderDialog(S.folders.get(t.dataset.folder));
}

async function createNote(over = {}) {
  const f = S.ui.filter;
  let folderId = f.type === 'folder' ? f.id : (S.settings.inboxFolder || null);
  if (folderId && isVaultFolder(folderId) && !vaultUnlocked(folderId)) folderId = S.settings.inboxFolder;
  const n = newNote({ folderId, isTodo: f.type === 'todo', tags: f.type === 'tag' ? [f.tag] : [], ...over });
  await saveNote(n, { snapshot: false });
  S.ui.query = '';
  if (S.ui.view !== 'notes') S.ui.view = 'notes';
  openNote(n.id);
  setTimeout(() => $('#ed-title')?.focus(), 30);
  return n;
}

/* ---------- search ---------- */
function parseQuery(q) {
  const out = { text: [], tags: [], folder: null, is: [] };
  for (const part of q.match(/(\w+:"[^"]+"|\S+)/g) || []) {
    const m = /^(tag|in|is):"?([^"]+)"?$/.exec(part);
    if (m) { if (m[1] === 'tag') out.tags.push(m[2].toLowerCase()); else if (m[1] === 'in') out.folder = m[2].toLowerCase(); else out.is.push(m[2].toLowerCase()); }
    else out.text.push(part);
  }
  out.text = out.text.join(' ');
  return out;
}
let semCache = null; // { scores: Map(id → score), q }
function searchNotes(q) {
  const p = parseQuery(q);
  let pool = liveNotes().filter((n) => !n.locked);
  if (p.tags.length) pool = pool.filter((n) => p.tags.every((t) => (n.tags || []).some((x) => x.toLowerCase() === t)));
  if (p.folder) pool = pool.filter((n) => folderPath(n.folderId).toLowerCase().includes(p.folder));
  for (const i of p.is) {
    if (i === 'todo') pool = pool.filter((n) => n.isTodo && !n.done);
    if (i === 'done') pool = pool.filter((n) => n.isTodo && n.done);
    if (i === 'task') pool = pool.filter((n) => n.isTodo);
  }
  if (!p.text) return pool.sort((a, b) => b.updatedAt - a.updatedAt).map((n) => ({ n, score: 1 }));
  if (S.ui.searchMode === 'semantic' && semCache && semCache.q === p.text) {
    return pool.map((n) => ({ n, score: semCache.scores.get(n.id) || 0 })).filter((r) => r.score > 0.2).sort((a, b) => b.score - a.score);
  }
  const ranked = bm25(pool.map((n) => ({ id: n.id, text: `${n.title} ${n.title} ${(n.tags || []).join(' ')} ${stripMd(n.body)}` })), p.text);
  return ranked.map((r) => ({ n: S.notes.get(r.id), score: r.score }));
}
function snippet(n, q) {
  const text = stripMd(n.body); const words = tokens(q);
  if (!words.length) return esc(text.slice(0, 160));
  const lower = text.toLowerCase();
  let at = -1; for (const w of words) { at = lower.indexOf(w); if (at >= 0) break; }
  const start = Math.max(0, at - 50); let s = esc(text.slice(start, start + 170));
  for (const w of words) s = s.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
  return (start ? '…' : '') + s;
}

/* ---------- note list ---------- */
function listedNotes() {
  const f = S.ui.filter;
  if (S.ui.query.trim()) return searchNotes(S.ui.query).map((r) => r.n);
  let arr;
  if (f.type === 'trash') arr = [...S.notes.values()].filter((n) => n.deleted);
  else {
    arr = liveNotes();
    if (f.type === 'all' || (f.type === 'folder' && !f.id)) arr = arr.filter((n) => !(isProjectItem(n) && !n.folderId));
    if (f.type === 'folder') { const ids = f.id ? descendantIds(f.id) : [null, undefined]; arr = arr.filter((n) => ids.includes(n.folderId ?? null) || (!f.id && !n.folderId)); }
    if (f.type === 'tag') arr = arr.filter((n) => (n.tags || []).includes(f.tag));
    if (f.type === 'todo') arr = arr.filter((n) => n.isTodo);
  }
  if (f.type === 'todo') return arr.sort((a, b) => (a.done - b.done) || ((a.due || '9999') < (b.due || '9999') ? -1 : 1) || b.updatedAt - a.updatedAt);
  return arr.sort((a, b) => b.updatedAt - a.updatedAt);
}
function filterTitle() {
  const f = S.ui.filter;
  if (S.ui.query.trim()) return 'Search results';
  if (f.type === 'folder') return f.id ? S.folders.get(f.id)?.name || 'Notebook' : 'No notebook';
  if (f.type === 'tag') return '#' + f.tag;
  if (f.type === 'todo') return 'Tasks';
  if (f.type === 'trash') return 'Trash';
  return 'All notes';
}
function dueChip(n) {
  if (!n.isTodo || !n.due) return '';
  if (n.done) return `<span class="chip good">done</span>`;
  const today = ymd();
  const cls = n.due < today ? 'bad' : n.due === today ? 'amber' : '';
  return `<span class="chip ${cls}">${n.due < today ? 'overdue ' : 'due '}${esc(n.due.slice(5))}</span>`;
}
function renderList() {
  const notes = listedNotes();
  const f = S.ui.filter;
  const semOk = S.settings.ai.provider !== 'none';
  const folder = f.type === 'folder' && f.id ? S.folders.get(f.id) : null;
  $('#list').innerHTML = `
    <div class="list-head">
      <div class="list-title"><button class="btn ghost sm mobile-only" id="l-back" aria-label="Back to navigation">☰</button><span>${esc(filterTitle())}</span>
        <span style="margin-left:auto;display:flex;gap:4px">
          ${folder?.vault ? `<button class="btn sm" id="l-lock" title="Lock this vault">Lock</button>` : ''}
          ${f.type === 'trash' ? `<button class="btn sm danger" id="l-empty">Empty trash</button>` : `<button class="btn sm primary" id="l-new" title="New note (Alt+N)">+ Note</button>`}
        </span></div>
      <div class="search-wrap"><input class="input" id="q" type="search" placeholder="Search…  tag:x  in:notebook  is:todo" value="${esc(S.ui.query)}" aria-label="Search notes"></div>
      <div class="search-mode">
        <button class="btn sm" id="sm-key" aria-pressed="${S.ui.searchMode === 'keyword'}">Keyword</button>
        <button class="btn sm" id="sm-sem" aria-pressed="${S.ui.searchMode === 'semantic'}" ${semOk ? '' : 'title="Connect an AI provider in Settings to search by meaning"'}>Meaning</button>
        <span class="muted small" style="margin-left:auto;align-self:center">${notes.length} note${notes.length === 1 ? '' : 's'}</span>
      </div>
    </div>
    <div class="notes" id="notes">${notes.length ? notes.map((n) => noteRow(n)).join('') : emptyList()}</div>`;
}
function emptyList() {
  const f = S.ui.filter;
  if (S.ui.query) return `<div class="empty"><h3>No matches</h3><p>Try fewer words${S.settings.ai.provider !== 'none' ? ', or switch to <b>Meaning</b> search' : ''}.</p></div>`;
  if (f.type === 'trash') return `<div class="empty"><h3>Trash is empty</h3><p>Deleted notes wait here until you empty the trash.</p></div>`;
  return `<div class="empty"><h3>Nothing here yet</h3><p>Write your first note, or press <kbd>Alt</kbd>+<kbd>Q</kbd> to capture a thought.</p><button class="btn primary" id="l-new2">New note</button></div>`;
}
function noteRow(n) {
  if (n.locked) return `<button class="note-row" data-id="${n.id}"><div class="t">🔒 Locked note</div><div class="m">${esc(S.folders.get(n.folderId)?.name || '')}</div></button>`;
  const q = S.ui.query.trim() ? parseQuery(S.ui.query).text : '';
  return `<button class="note-row${n.id === S.ui.noteId ? ' active' : ''}" data-id="${n.id}">
    <div class="t${n.isTodo && n.done ? ' done' : ''}">${n.isTodo ? (n.done ? '☑' : '☐') : ''}${esc(n.title || 'Untitled')}</div>
    <div class="s">${q ? snippet(n, q) : esc(stripMd(n.body).slice(0, 140)) || '<span class="muted">Empty note</span>'}</div>
    <div class="m">${dueChip(n)}<span>${fmtWhen(n.updatedAt)}</span>${isProjectItem(n) ? `<span>· ${esc(S.projects.get(n.projectId).icon || '◆')} ${esc(S.projects.get(n.projectId).name)}</span>` : ''}${S.ui.filter.type !== 'folder' && n.folderId ? `<span>· ${esc(S.folders.get(n.folderId)?.name || '')}</span>` : ''}${(n.tags || []).slice(0, 3).map((t) => `<span>#${esc(t)}</span>`).join('')}</div>
  </button>`;
}

const runSearch = debounce(async () => {
  if (S.ui.searchMode === 'semantic' && S.ui.query.trim()) {
    const text = parseQuery(S.ui.query).text;
    if (text) { try { semCache = { q: text, scores: await semanticScores(text) }; } catch (e) { toast(e.message, true); } }
  }
  renderList();
  const q = $('#q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}, 220);

function listEvents() {
  const L = $('#list');
  L.addEventListener('input', (e) => { if (e.target.id === 'q') { S.ui.query = e.target.value; runSearch(); } });
  L.addEventListener('click', async (e) => {
    const row = e.target.closest('.note-row');
    if (row) { const n = S.notes.get(row.dataset.id); if (n?.locked) return unlockDialog(n.folderId); return openNote(row.dataset.id); }
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'l-new' || b.id === 'l-new2') createNote();
    if (b.id === 'l-back') setPane('rail');
    if (b.id === 'l-lock') { lockVault(S.ui.filter.id); go('notes'); }
    if (b.id === 'l-empty') confirmDialog('Empty trash?', 'Notes in the trash will be permanently deleted, including their version history.', 'Delete forever', emptyTrash);
    if (b.id === 'sm-key') { S.ui.searchMode = 'keyword'; renderList(); }
    if (b.id === 'sm-sem') {
      if (S.settings.ai.provider === 'none') { toast('Meaning search needs an AI provider. Opening Settings.'); return go('settings'); }
      S.ui.searchMode = 'semantic'; runSearch();
    }
  });
}
async function emptyTrash() { return purgeNotes([...S.notes.values()].filter((n) => n.deleted)); }
async function purgeNotes(dead) {
  const vers = await DB.all('versions');
  for (const n of dead) {
    S.notes.delete(n.id); await DB.del('notes', n.id);
    for (const v of vers.filter((v) => v.noteId === n.id)) await DB.del('versions', v.id);
    for (const c of [...S.cards.values()].filter((c) => c.noteId === n.id)) { S.cards.delete(c.id); await DB.del('cards', c.id); }
    for (const r of [...S.rawResources.values()].filter((r) => r.noteId === n.id)) { S.rawResources.delete(r.id); S.resources.delete(r.id); await DB.del('resources', r.id); }
    S.tombstones.push({ id: n.id, at: now() });
  }
  await DB.put('meta', { id: 'tombstones', value: S.tombstones.slice(-5000) });
  if (dead.some((n) => n.id === S.ui.noteId)) S.ui.noteId = null;
  toast(`Deleted ${dead.length} note${dead.length === 1 ? '' : 's'} permanently`);
  render();
}
