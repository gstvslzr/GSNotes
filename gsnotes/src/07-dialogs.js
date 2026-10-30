// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
/* ============================================================
   Dialogs, command palette, quick capture
   ============================================================ */
let closeTop = null;
function openDialog(html, { wide = false, cls = '' } = {}) {
  const ov = $('#overlay');
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="dialog${wide ? ' wide' : ''} ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  ov.appendChild(scrim);
  const prevFocus = document.activeElement;
  const close = () => { scrim.remove(); closeTop = $('#overlay .scrim:last-child') ? closeTop : null; prevFocus?.focus?.(); };
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  scrim.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  closeTop = close;
  setTimeout(() => scrim.querySelector('[autofocus], input, textarea, select, button.primary')?.focus(), 20);
  return { el: scrim, close };
}
const dlgHead = (t) => `<div class="dialog-h"><h3>${t}</h3><button class="btn ghost sm" data-close aria-label="Close">✕</button></div>`;

function confirmDialog(title, text, okLabel, fn) {
  const d = openDialog(`${dlgHead(esc(title))}<div class="dialog-b"><p style="margin:0">${esc(text)}</p></div><div class="dialog-f"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cf-ok" style="background:var(--bad);border-color:var(--bad);color:#fff">${esc(okLabel)}</button></div>`);
  $('#cf-ok', d.el).onclick = async () => { d.close(); await fn(); };
}

function folderDialog(f) {
  const editing = !!f;
  const parents = [...S.folders.values()].filter((x) => !x.vault && (!f || !descendantIds(f.id).includes(x.id)));
  const d = openDialog(`${dlgHead(editing ? 'Edit notebook' : 'New notebook')}
    <form class="dialog-b" id="fd-form">
      <label class="field">Name<input class="input" id="fd-name" value="${esc(f?.name || '')}" required autofocus></label>
      ${f?.vault ? '' : `<label class="field">Inside<select class="select" id="fd-parent"><option value="">— Top level —</option>${parents.map((p) => `<option value="${p.id}"${f?.parentId === p.id ? ' selected' : ''}>${esc(folderPath(p.id))}</option>`).join('')}</select></label>`}
      ${editing && f.id !== S.settings.inboxFolder ? `<details><summary class="small">Delete this notebook</summary><p class="small">Its notes move to the trash and sub-notebooks move up one level.</p><button type="button" class="btn danger" id="fd-del">Delete notebook</button></details>` : ''}
    </form>
    <div class="dialog-f"><button class="btn" data-close>Cancel</button><button class="btn primary" form="fd-form">${editing ? 'Save' : 'Create'}</button></div>`);
  $('#fd-form', d.el).onsubmit = async (e) => {
    e.preventDefault();
    const name = $('#fd-name', d.el).value.trim(); if (!name) return;
    const parentId = $('#fd-parent', d.el)?.value || null;
    const obj = f || { id: uid(), createdAt: now() };
    Object.assign(obj, { name, parentId: obj.vault ? null : parentId, updatedAt: now() });
    S.folders.set(obj.id, obj); await DB.put('folders', obj);
    d.close(); toast(editing ? 'Notebook saved' : `Created “${name}”`);
    if (!editing) go('notes', { type: 'folder', id: obj.id }); else render();
  };
  const del = $('#fd-del', d.el);
  if (del) del.onclick = async () => {
    if (f.vault && [...S.notes.values()].some((n) => n.folderId === f.id)) { toast('Move or permanently delete this vault’s notes first (including any in the trash).', true, 5000); return; }
    for (const n of [...S.notes.values()].filter((n) => n.folderId === f.id && !n.locked)) { n.deleted = now(); await saveNote(n, { snapshot: false, touch: false }); }
    for (const c of childFolders(f.id)) { c.parentId = f.parentId || null; await DB.put('folders', c); }
    S.folders.delete(f.id); await DB.del('folders', f.id); S.keys.delete(f.id);
    d.close(); toast('Notebook deleted'); go('notes');
  };
}

function vaultDialog() {
  const d = openDialog(`${dlgHead('New vault notebook')}
    <form class="dialog-b" id="vd-form">
      <p class="small" style="margin:0">Notes in a vault are encrypted on this device. You need the password to open them on any device. <b>A lost password cannot be reset.</b></p>
      <label class="field">Name<input class="input" id="vd-name" value="Private" required autofocus></label>
      <label class="field">Password (at least 8 characters)<input class="input" type="password" id="vd-pw" minlength="8" required autocomplete="new-password"></label>
      <label class="field">Confirm password<input class="input" type="password" id="vd-pw2" minlength="8" required autocomplete="new-password"></label>
      <p class="small muted" id="vd-err" style="margin:0"></p>
    </form>
    <div class="dialog-f"><button class="btn" data-close>Cancel</button><button class="btn primary" form="vd-form">Create vault</button></div>`);
  $('#vd-form', d.el).onsubmit = async (e) => {
    e.preventDefault();
    const pw = $('#vd-pw', d.el).value, pw2 = $('#vd-pw2', d.el).value;
    if (pw !== pw2) { $('#vd-err', d.el).textContent = 'The passwords don’t match.'; return; }
    $('#vd-err', d.el).textContent = 'Deriving key…';
    const f = await createVault($('#vd-name', d.el).value.trim() || 'Private', pw);
    d.close(); toast(`Vault “${f.name}” created and unlocked`); go('notes', { type: 'folder', id: f.id });
  };
}
function unlockDialog(fid) {
  const f = S.folders.get(fid); if (!f) return;
  const d = openDialog(`${dlgHead('Unlock ' + esc(f.name))}
    <form class="dialog-b" id="ud-form"><label class="field">Password<input class="input" type="password" id="ud-pw" required autofocus autocomplete="current-password"></label><p class="small" id="ud-err" style="margin:0;color:var(--bad)"></p></form>
    <div class="dialog-f"><button class="btn" data-close>Cancel</button><button class="btn primary" form="ud-form">Unlock</button></div>`);
  $('#ud-form', d.el).onsubmit = async (e) => {
    e.preventDefault(); $('#ud-err', d.el).textContent = '';
    try { await unlockVault(fid, $('#ud-pw', d.el).value); d.close(); go('notes', { type: 'folder', id: fid }); }
    catch (err) { $('#ud-err', d.el).textContent = err.message; $('#ud-pw', d.el).select(); }
  };
}

function templateDialog() {
  const tpls = liveNotes().filter((n) => n.folderId === S.settings.templateFolder && !n.locked);
  const d = openDialog(`${dlgHead('New note from template')}
    <form class="dialog-b" id="td-form">
      ${tpls.length ? `<label class="field">Template<select class="select" id="td-tpl">${tpls.map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}</select></label>
      <label class="field">Title<input class="input" id="td-title" placeholder="e.g. Weekly sync ${ymd()}" autofocus></label>
      <p class="small muted" style="margin:0">Templates live in the <b>Templates</b> notebook. Use <code>{{date}}</code>, <code>{{time}}</code>, <code>{{weekday}}</code> and <code>{{title}}</code> as placeholders.</p>`
      : `<p>No templates yet. Add notes to the <b>Templates</b> notebook and they will appear here.</p>`}
    </form>
    <div class="dialog-f"><button class="btn" data-close>Cancel</button>${tpls.length ? '<button class="btn primary" form="td-form">Create note</button>' : ''}</div>`);
  const form = $('#td-form', d.el);
  form.onsubmit = async (e) => {
    e.preventDefault(); if (!tpls.length) return;
    const t = S.notes.get($('#td-tpl', d.el).value); const title = $('#td-title', d.el).value.trim() || `${t.title} ${ymd()}`;
    d.close();
    const fid = S.ui.filter.type === 'folder' && S.ui.filter.id !== S.settings.templateFolder ? S.ui.filter.id : S.settings.inboxFolder;
    await createNote({ title, folderId: fid, body: fillTemplate(t.body, title), tags: (t.tags || []).filter((x) => x !== 'template') });
  };
}

function attachDialog() {
  const d = openDialog(`${dlgHead('Attach')}
    <div class="dialog-b">
      <button class="btn" data-a="img" style="justify-content:flex-start">Image — embeds it and recognizes any text in it so search finds it</button>
      <button class="btn" data-a="imgplain" style="justify-content:flex-start">Image only — no text recognition</button>
      <button class="btn" data-a="pdf" style="justify-content:flex-start">PDF — extracts its text into this note (scanned pages are recognized)</button>
      <button class="btn" data-a="file" style="justify-content:flex-start">Any file — stored with the note (up to 25 MB)</button>
      <p class="small muted" style="margin:0">You can also paste an image straight into the editor.</p>
    </div>`);
  d.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return; d.close();
    const a = b.dataset.a;
    if (a === 'img' || a === 'imgplain') for (const f of await pickFiles('image/*')) await attachImage(f, a === 'img');
    if (a === 'pdf') for (const f of await pickFiles('application/pdf')) await attachPdf(f);
    if (a === 'file') for (const f of await pickFiles('*/*')) {
      if (f.size > 25 * 1048576) { toast(`${f.name} is larger than 25 MB.`, true); continue; }
      const r = await addResource(S.ui.noteId, f.name, f.type || 'application/octet-stream', await readDataURL(f));
      insertAtCursor(`\n[${f.name}](gsres://${r.id})\n`);
    }
  });
}

async function historyDialog(n) {
  await maybeSnapshot(n, true);
  const vers = await getVersions(n);
  const d = openDialog(`${dlgHead('Version history — ' + esc(n.title || 'Untitled'))}
    <div class="dialog-b">
      ${vers.length ? `<p class="small muted" style="margin:0">GSNotes saves a version when you pause editing for a minute and a half. Pick one to compare it with the current note.</p>
      <div class="ver-list">${vers.map((v, i) => `<button data-v="${i}" class="${i === Math.min(1, vers.length - 1) ? 'sel' : ''}"><span>${new Date(v.at).toLocaleString()}</span><span>${i === 0 ? 'current' : (v.body.length + ' chars')}</span></button>`).join('')}</div>
      <div id="vd-diff"></div>` : '<p>No saved versions yet.</p>'}
    </div>
    <div class="dialog-f"><button class="btn" data-close>Close</button>${vers.length > 1 ? '<button class="btn primary" id="vd-restore">Restore this version</button>' : ''}</div>`, { wide: true });
  let sel = Math.min(1, vers.length - 1);
  const show = () => {
    const v = vers[sel]; if (!v) return;
    const diff = lineDiff(v.title + '\n\n' + v.body, n.title + '\n\n' + n.body);
    const changed = diff.filter((x) => x.t !== 'eq').length;
    $('#vd-diff', d.el).innerHTML = `<p class="small" style="margin:0 0 6px">${changed ? `<span class="chip bad">− removed since then</span> <span class="chip good">+ added since then</span>` : 'Identical to the current note.'}</p>
      <div class="diff">${diff.map((x) => `<div class="${x.t === 'add' ? 'add' : x.t === 'del' ? 'del' : ''}">${x.t === 'add' ? '+ ' : x.t === 'del' ? '− ' : '  '}${esc(x.s) || ' '}</div>`).join('')}</div>`;
  };
  show();
  d.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-v]');
    if (b) { sel = +b.dataset.v; $$('.ver-list button', d.el).forEach((x) => x.classList.toggle('sel', x === b)); show(); }
    if (e.target.id === 'vd-restore') {
      const v = vers[sel];
      await maybeSnapshot(n, true);
      n.title = v.title; n.body = v.body; await saveNote(n); await maybeSnapshot(n, true);
      d.close(); toast(`Restored the version from ${new Date(v.at).toLocaleString()}`); render();
    }
  });
}

function publishNote(n) {
  const html = publishHtml(n);
  const d = openDialog(`${dlgHead('Publish as a web page')}
    <div class="dialog-b">
      <p style="margin:0">GSNotes builds a single, read-only HTML page from this note, with its images included. Upload it to any web host (GitHub Pages, Netlify, a SharePoint library) or email it.</p>
      <p class="small muted" style="margin:0">Links to other notes become plain text. ${isVaultFolder(n.folderId) ? '<b>This note is in a vault — the published page is not encrypted.</b>' : ''}</p>
      <p class="small mono muted" style="margin:0">${(html.length / 1024).toFixed(1)} KB · ${esc(safeName(n.title))}.html</p>
    </div>
    <div class="dialog-f"><button class="btn" id="pb-copy">Copy HTML</button><button class="btn primary" id="pb-dl">Download page</button></div>`);
  $('#pb-dl', d.el).onclick = () => { download(safeName(n.title) + '.html', html, 'text/html'); d.close(); };
  $('#pb-copy', d.el).onclick = async () => { try { await navigator.clipboard.writeText(html); toast('HTML copied'); } catch { toast('Copy was blocked by the browser.', true); } };
}
function publishHtml(n) {
  const body = renderMd(n.body).replace(/<a [^>]*class="wl[^"]*"[^>]*>([\s\S]*?)<\/a>/g, '<span>$1</span>').replace(/<input type="checkbox" data-task="\d+"( checked)?>/g, (m, c) => `<input type="checkbox" disabled${c ? ' checked' : ''}>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(n.title || 'Untitled')}</title>
<style>:root{--bg:#fff;--fg:#17212c;--mut:#5b6877;--line:#dde3eb;--accent:#2547c9;--code:#f1f4f8}@media(prefers-color-scheme:dark){:root{--bg:#12171e;--fg:#e6ebf2;--mut:#9aa6b4;--line:#2a3442;--accent:#8aa2ff;--code:#1a222c}}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.65 "Atkinson Hyperlegible",system-ui,sans-serif}main{max-width:70ch;margin:0 auto;padding:48px 20px 80px}h1,h2,h3{line-height:1.25}h1.t{font-size:2.1em;margin:0 0 .2em}.meta{color:var(--mut);font-size:14px;margin-bottom:2em}a{color:var(--accent)}code{background:var(--code);padding:.1em .35em;border-radius:4px;font-size:.88em}pre{background:var(--code);padding:12px 14px;border-radius:6px;overflow-x:auto}pre code{background:none;padding:0}img{max-width:100%;border-radius:6px}blockquote{border-left:3px solid var(--line);margin:0;padding-left:14px;color:var(--mut)}table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:5px 10px}.card-line{display:flex;gap:8px;padding:4px 0;border-bottom:1px dashed var(--line)}footer{margin-top:4em;color:var(--mut);font-size:13px;border-top:1px solid var(--line);padding-top:1em}</style></head>
<body><main><h1 class="t">${esc(n.title || 'Untitled')}</h1><div class="meta">Updated ${new Date(n.updatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}${(n.tags || []).length ? ' · ' + n.tags.map((t) => '#' + esc(t)).join(' ') : ''}</div>${body}<footer>Published from GSNotes</footer></main></body></html>`;
}

/* ---------- quick capture ---------- */
function quickCapture() {
  const d = openDialog(`${dlgHead('Quick capture')}
    <form class="dialog-b" id="qc-form">
      <textarea class="input" id="qc-text" rows="6" placeholder="First line becomes the title. Saved to your Inbox." autofocus></textarea>
      <div class="row"><label class="row small"><input type="checkbox" id="qc-task"> Save as a task</label><label class="row small" id="qc-due-wrap">Due <input type="date" id="qc-due" class="input" style="width:auto;padding:2px 6px"></label><button type="button" class="btn sm" id="qc-voice" style="margin-left:auto">Dictate</button></div>
      <p class="small muted" style="margin:0"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> to save · <kbd>Esc</kbd> to discard</p>
    </form>
    <div class="dialog-f"><button class="btn" data-close>Discard</button><button class="btn primary" form="qc-form">Save to Inbox</button></div>`);
  const ta = $('#qc-text', d.el);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#qc-form', d.el).requestSubmit(); } });
  $('#qc-voice', d.el).onclick = () => toggleVoice(ta, $('#qc-voice', d.el));
  $('#qc-form', d.el).onsubmit = async (e) => {
    e.preventDefault();
    const text = ta.value.trim(); if (!text) return d.close();
    if (voice.active) stopVoice();
    const [first, ...rest] = text.split('\n');
    const isTodo = $('#qc-task', d.el).checked;
    const n = newNote({ folderId: S.settings.inboxFolder, title: first.replace(/^#+\s*/, '').slice(0, 120), body: rest.join('\n').trim(), isTodo, status: 'todo', due: isTodo ? $('#qc-due', d.el).value : '', tags: ['inbox'] });
    await saveNote(n, { snapshot: false });
    d.close(); toast('Captured to Inbox'); render();
  };
}

/* ---------- command palette ---------- */
function commands() {
  const c = [
    ['New note', 'Alt+N', () => createNote()], ['New task', '', () => createNote({ isTodo: true, status: 'todo' })],
    ['Today’s daily note', '', () => getOrCreateDaily().then((n) => openNote(n.id))], ['Quick capture', 'Alt+Q', quickCapture],
    ['New note from template', '', templateDialog], ['New notebook', '', () => folderDialog()], ['New vault notebook', '', vaultDialog],
    ['New project', '', newProjectDialog], ['Import CSV as a project', '', () => importCsvProject()],
    ['Go to All notes', '', () => go('notes')], ['Go to Tasks', '', () => go('tasks')], ['Go to Board', '', () => go('board')], ['Go to Calendar', '', () => go('calendar')],
    ['Go to Graph', '', () => go('graph')], ['Study flashcards', '', () => go('cards')], ['Ask my notes', '', () => go('ask')], ['Settings & sync', '', () => go('settings')],
    ['Search notes', '/', () => { go('notes'); setTimeout(() => $('#q')?.focus(), 30); }],
    ['Toggle dark mode', '', async () => { const dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches); S.settings.theme = dark ? 'light' : 'dark'; applyTheme(); await saveSettings(); if (S.ui.view === 'graph') renderView(); }],
    ['Sync now', '', syncNow], ['Back up now', '', backupNow], ['Restore from a backup', '', () => restoreFlow()], ['Backup & import', '', () => go('backup')],
    ['Import from Joplin (.jex)', '', async () => { const [f] = await pickFiles('.jex', false); if (f) importJex(f); }], ['Import from OneNote', '', () => window.gsDesktop?.oneNote ? importOneNoteNative() : go('backup')], ['Import a Markdown folder', '', () => importMdFolder()], ['Import Markdown files', '', importMarkdown], ['Import Evernote (.enex)', '', importEnex],
  ];
  for (const p of S.projects.values()) c.push([`Open project: ${p.name}`, '', () => openProject(p.id)]);
  if (S.keys.size) c.push(['Lock all vaults', '', () => lockAll()]);
  const n = cur();
  if (n && !n.locked && S.ui.view === 'notes') c.push(['Version history', '', () => historyDialog(n)], ['Summarize this note', '', () => aiSummarize(n)], ['Suggest tags', '', () => aiAutoTag(n)], ['Publish as web page', '', () => publishNote(n)], ['Attach image or PDF', '', attachDialog], ['Dictate into this note', '', () => toggleVoice()]);
  return c;
}
function openPalette() {
  const d = openDialog(`<div class="palette" style="display:flex;flex-direction:column;min-height:0"><input class="input" id="pl-q" placeholder="Type a command or a note title…" autofocus aria-label="Command"><div class="palette-list" id="pl-list"></div></div>`, { cls: 'palette' });
  const q = $('#pl-q', d.el), list = $('#pl-list', d.el);
  let items = [], sel = 0;
  const draw = () => {
    const t = q.value.toLowerCase().trim();
    const cmds = commands().filter(([l]) => !t || l.toLowerCase().includes(t)).map(([l, k, fn]) => ({ l, k, fn }));
    const notes = t ? liveNotes().filter((n) => !n.locked && (n.title || '').toLowerCase().includes(t)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12).map((n) => ({ l: '↳ ' + (n.title || 'Untitled'), k: S.folders.get(n.folderId)?.name || '', fn: () => openNote(n.id) })) : [];
    items = [...cmds, ...notes].slice(0, 40); sel = Math.min(sel, Math.max(0, items.length - 1));
    list.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${i === sel ? 'sel' : ''}"><span>${esc(it.l)}</span>${it.k ? `<kbd>${esc(it.k)}</kbd>` : ''}</button>`).join('') || '<p class="muted small" style="padding:8px 12px">No matches.</p>';
  };
  const run = (i) => { const it = items[i]; if (!it) return; d.close(); it.fn(); };
  q.addEventListener('input', () => { sel = 0; draw(); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, items.length); draw(); list.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + items.length) % Math.max(1, items.length); draw(); list.children[sel]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  });
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) run(+b.dataset.i); });
  draw();
}
