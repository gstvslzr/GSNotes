// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
/* ============================================================
   Editor: title, properties, Markdown source + preview, backlinks
   ============================================================ */
const cur = () => S.notes.get(S.ui.noteId);
let saveState = 'saved';
let aiPanel = null; // { noteId, kind, html }

function folderOptions(sel) {
  const opts = ['<option value="">No notebook</option>'];
  const walk = (pid, depth) => { for (const f of childFolders(pid)) { if (f.vault && !vaultUnlocked(f.id) && f.id !== sel) continue; opts.push(`<option value="${f.id}"${f.id === sel ? ' selected' : ''}>${' '.repeat(depth)}${f.vault ? '🔒 ' : ''}${esc(f.name)}</option>`); walk(f.id, depth + 1); } };
  walk(null, 0); return opts.join('');
}

function renderEditor() {
  const n = cur();
  const E = $('#editor');
  if (!n || (n.deleted && S.ui.filter.type !== 'trash' && !S.ui.query)) {
    E.innerHTML = `<div class="empty" style="margin:auto"><h3>No note open</h3><p>Pick a note from the list, or start a new one.</p>
      <div class="row" style="justify-content:center"><button class="btn primary" data-act="new">New note</button><button class="btn" data-act="today">Today’s note</button><button class="btn" data-act="tpl">From template</button></div>
      <p class="small"><kbd>Ctrl</kbd>+<kbd>K</kbd> commands · <kbd>Alt</kbd>+<kbd>Q</kbd> quick capture · <kbd>Alt</kbd>+<kbd>N</kbd> new note</p></div>`;
    return;
  }
  if (n.locked) {
    E.innerHTML = `<div class="lock-card"><div class="big">🔒</div><h3 style="margin:0">This note is in a locked vault</h3><button class="btn primary" data-act="unlock">Unlock ${esc(S.folders.get(n.folderId)?.name || 'vault')}</button></div>`;
    return;
  }
  const inVault = isVaultFolder(n.folderId);
  const bl = backlinks(n);
  const missing = outLinks(n).filter((t) => !noteByTitle(t));
  const mode = S.ui.mode;
  E.innerHTML = `
    <div class="ed-bar" role="toolbar" aria-label="Editor tools">
      ${n.projectId && S.projects.has(n.projectId) ? `<button class="btn sm" data-act="to-project" title="Back to the project">← ${esc(S.projects.get(n.projectId).name)}</button>` : '<button class="btn ghost sm mobile-only" data-act="back" aria-label="Back to list">←</button>'}
      ${n.deleted ? `<span class="chip bad">In trash</span><button class="btn sm" data-act="restore">Restore</button><button class="btn sm danger" data-act="purge">Delete forever</button>` : `
      <button class="btn sm" data-mode="edit" aria-pressed="${mode === 'edit'}">Edit</button>
      <button class="btn sm" data-mode="split" aria-pressed="${mode === 'split'}">Split</button>
      <button class="btn sm" data-mode="view" aria-pressed="${mode === 'view'}">View</button>
      <span class="sep"></span>
      <button class="btn ghost sm" data-fmt="bold" title="Bold (Ctrl+B)"><b>B</b></button>
      <button class="btn ghost sm" data-fmt="italic" title="Italic (Ctrl+I)"><i>I</i></button>
      <button class="btn ghost sm" data-fmt="h2" title="Heading">H</button>
      <button class="btn ghost sm" data-fmt="task" title="Checklist item">☑</button>
      <button class="btn ghost sm" data-fmt="code" title="Code">{ }</button>
      <button class="btn ghost sm" data-fmt="wiki" title="Link to a note">[[ ]]</button>
      <button class="btn ghost sm" data-fmt="card" title="Flashcard line">::</button>
      <span class="sep"></span>
      <button class="btn ghost sm" data-act="attach" title="Attach image (with text recognition), PDF, or file">Attach</button>
      <button class="btn ghost sm" data-act="voice" id="voice-btn" title="Dictate">${voice.active ? '<span class="rec-dot"></span> Stop' : 'Dictate'}</button>
      <span class="sep"></span>
      <button class="btn ghost sm" data-act="summarize" title="Summarize this note">Summarize</button>
      <button class="btn ghost sm" data-act="autotag" title="Suggest tags">Suggest tags</button>
      <button class="btn ghost sm" data-act="ai-cards" title="Generate flashcards from this note">Make cards</button>
      <span class="sep"></span>
      <button class="btn ghost sm" data-act="history" title="Version history">History</button>
      <button class="btn ghost sm" data-act="publish" title="Export as a read-only web page">Publish</button>
      <button class="btn ghost sm" data-act="export" title="Export as Markdown">.md</button>
      <button class="btn ghost sm danger" data-act="trash" title="Move to trash">Delete</button>`}
    </div>
    <div class="ed-meta">
      <input class="ed-title" id="ed-title" value="${esc(n.title)}" placeholder="Untitled" aria-label="Title" ${n.deleted ? 'readonly' : ''}>
      <div class="ed-props">
        <select id="ed-folder" aria-label="Notebook">${folderOptions(n.folderId)}</select>
        <label class="row" style="gap:4px"><input type="checkbox" id="ed-todo" ${n.isTodo ? 'checked' : ''}> Task</label>
        ${n.isTodo ? `
          <select id="ed-status" aria-label="Status">${['todo', 'doing', 'done'].map((s) => `<option value="${s}"${n.status === s ? ' selected' : ''}>${{ todo: 'To do', doing: 'In progress', done: 'Done' }[s]}</option>`).join('')}</select>
          <label class="row" style="gap:4px">Due <input type="date" id="ed-due" value="${esc(n.due || '')}"></label>
          <label class="row" style="gap:4px">Remind <input type="datetime-local" id="ed-remind" value="${esc(n.remindAt || '')}"></label>` : ''}
        <div class="tag-edit" id="ed-tags">${(n.tags || []).map((t) => `<span class="chip accent">#${esc(t)} <button class="btn ghost sm" style="padding:0 2px;color:inherit" data-rmtag="${esc(t)}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join('')}<input id="ed-tag-in" placeholder="+ tag" aria-label="Add tag"></div>
      </div>
    </div>
    ${n.projectId && S.projects.has(n.projectId) && !n.deleted ? itemPropsBlock(n) : ''}
    <div class="ed-body mode-${mode}">
      <div class="src"><textarea id="ed-src" spellcheck="true" aria-label="Note body (Markdown)" ${n.deleted ? 'readonly' : ''} placeholder="Write in Markdown. [[ links a note · question :: answer makes a flashcard">${esc(n.body)}</textarea></div>
      <div class="preview"><div class="md" id="ed-prev">${renderMd(n.body)}</div></div>
    </div>
    ${aiPanel && aiPanel.noteId === n.id ? `<div class="ed-side" id="ai-panel"><div class="row"><h4 class="grow">${esc(aiPanel.title)}</h4><button class="btn ghost sm" data-act="close-ai">Close</button></div>${aiPanel.html}</div>` : ''}
    ${(bl.length || missing.length) ? `<div class="ed-side"><h4>Backlinks (${bl.length})</h4>
      <div class="row">${bl.map((b) => `<button class="chip" data-open="${b.id}">← ${esc(b.title || 'Untitled')}</button>`).join('') || '<span class="muted small">No notes link here yet.</span>'}</div>
      ${missing.length ? `<h4>Links to notes that don’t exist yet</h4><div class="row">${missing.map((t) => `<button class="chip" data-wlcreate="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>` : ''}</div>` : ''}
    <div class="ed-foot"><span id="ed-stats">${statText(n.body)}</span><span>Created ${fmtWhen(n.createdAt)}</span><span>Edited ${fmtWhen(n.updatedAt)}</span>${inVault ? '<span class="chip accent">🔒 encrypted vault</span>' : ''}<span id="ed-save" style="margin-left:auto">${saveState === 'saving' ? 'Saving…' : 'Saved'}</span></div>`;
}
function statText(b) { const w = (stripMd(b).match(/\S+/g) || []).length; return `${w} word${w === 1 ? '' : 's'} · ${b.length} chars`; }

const persistSoon = debounce(async () => {
  const n = cur(); if (!n) return;
  try { await saveNote(n); saveState = 'saved'; } catch (e) { toast(e.message, true); }
  const s = $('#ed-save'); if (s) s.textContent = 'Saved';
  renderRail();
  const row = $(`.note-row[data-id="${n.id}"]`); if (row) row.outerHTML = noteRow(n);
}, 600);
const refreshPreview = debounce(() => { const n = cur(); const p = $('#ed-prev'); if (n && p) p.innerHTML = renderMd(n.body); const st = $('#ed-stats'); if (st && n) st.textContent = statText(n.body); }, 160);

function markDirty() { saveState = 'saving'; const s = $('#ed-save'); if (s) s.textContent = 'Saving…'; persistSoon(); }

/* text insertion helpers */
function insertAtCursor(text, selectInner) {
  const ta = $('#ed-src'); if (!ta) return;
  const { selectionStart: a, selectionEnd: b, value } = ta;
  ta.value = value.slice(0, a) + text + value.slice(b);
  const pos = a + (selectInner ?? text.length);
  ta.setSelectionRange(pos, pos); ta.focus();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
function wrapSel(before, after = before, placeholder = '') {
  const ta = $('#ed-src'); if (!ta) return;
  const { selectionStart: a, selectionEnd: b, value } = ta;
  const sel = value.slice(a, b) || placeholder;
  ta.value = value.slice(0, a) + before + sel + after + value.slice(b);
  ta.setSelectionRange(a + before.length, a + before.length + sel.length); ta.focus();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
function linePrefix(prefix) {
  const ta = $('#ed-src'); if (!ta) return;
  const { selectionStart: a, value } = ta;
  const ls = value.lastIndexOf('\n', a - 1) + 1;
  ta.value = value.slice(0, ls) + prefix + value.slice(ls);
  ta.setSelectionRange(a + prefix.length, a + prefix.length); ta.focus();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
function applyFmt(f) {
  ({
    bold: () => wrapSel('**', '**', 'bold'), italic: () => wrapSel('*', '*', 'italic'), h2: () => linePrefix('## '),
    task: () => linePrefix('- [ ] '), code: () => wrapSel('`', '`', 'code'), wiki: () => wrapSel('[[', ']]', ''),
    card: () => insertAtCursor('\nQuestion :: Answer\n', 1),
  })[f]?.();
}

/* ---------- [[ autocomplete ---------- */
let ac = null;
function caretCoords(ta) {
  const div = document.createElement('div'); const cs = getComputedStyle(ta);
  for (const p of ['fontFamily', 'fontSize', 'lineHeight', 'padding', 'border', 'letterSpacing', 'whiteSpace', 'wordWrap', 'tabSize', 'boxSizing']) div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: ta.clientWidth + 'px' });
  div.textContent = ta.value.slice(0, ta.selectionStart);
  const span = document.createElement('span'); span.textContent = '​'; div.appendChild(span);
  document.body.appendChild(div);
  const r = { top: span.offsetTop - ta.scrollTop, left: span.offsetLeft };
  div.remove(); return r;
}
function updateAutocomplete() {
  const ta = $('#ed-src'); closeAc();
  if (!ta) return;
  const before = ta.value.slice(0, ta.selectionStart);
  const m = /\[\[([^\]\n|]{0,60})$/.exec(before);
  if (!m) return;
  const q = m[1].toLowerCase();
  const items = liveNotes().filter((n) => !n.locked && n.id !== S.ui.noteId && n.title && n.title.toLowerCase().includes(q)).sort((a, b) => (a.title.toLowerCase().startsWith(q) ? -1 : 1) - (b.title.toLowerCase().startsWith(q) ? -1 : 1) || b.updatedAt - a.updatedAt).slice(0, 8);
  if (!items.length && !q) return;
  const c = caretCoords(ta);
  ac = { items: items.map((n) => n.title).concat(q && !items.some((n) => n.title.toLowerCase() === q) ? [m[1] + ' (new)'] : []), sel: 0, start: ta.selectionStart - m[1].length };
  const el = document.createElement('div'); el.className = 'ac'; el.id = 'ac';
  el.style.top = Math.min(c.top + 26, ta.clientHeight - 40) + 'px'; el.style.left = Math.min(c.left + 10, ta.clientWidth - 230) + 'px';
  el.innerHTML = ac.items.map((t, i) => `<button data-i="${i}" class="${i === 0 ? 'sel' : ''}">${esc(t)}</button>`).join('');
  ta.parentElement.appendChild(el);
  el.addEventListener('mousedown', (e) => { const b = e.target.closest('button'); if (b) { e.preventDefault(); pickAc(+b.dataset.i); } });
}
function closeAc() { $('#ac')?.remove(); ac = null; }
function pickAc(i) {
  const ta = $('#ed-src'); if (!ac || !ta) return;
  const title = ac.items[i].replace(/ \(new\)$/, '');
  const after = ta.value.slice(ta.selectionStart);
  const close = after.startsWith(']]') ? '' : ']]';
  ta.setSelectionRange(ac.start, ta.selectionStart);
  closeAc();
  insertAtCursor(title + close);
  if (!close) ta.setSelectionRange(ta.selectionStart + 2, ta.selectionStart + 2);
}

async function followWikiLink(title) {
  let n = noteByTitle(title);
  if (!n) {
    const src = cur();
    n = newNote({ title, folderId: src && !isVaultFolder(src.folderId) ? src.folderId : S.settings.inboxFolder, body: src ? `Linked from [[${src.title}]]\n\n` : '' });
    await saveNote(n, { snapshot: false });
    toast(`Created “${title}”`);
  }
  openNote(n.id);
}

function editorEvents() {
  const E = $('#editor');
  E.addEventListener('input', (e) => {
    const n = cur(); if (!n || n.deleted) return;
    if (e.target.id === 'ed-src') { n.body = e.target.value; markDirty(); refreshPreview(); updateAutocomplete(); }
    if (e.target.id === 'ed-title') { n.title = e.target.value; markDirty(); }
  });
  E.addEventListener('change', async (e) => {
    if (e.target.closest('#item-props')) return onItemPropChange(e.target);
    const n = cur(); if (!n) return;
    const id = e.target.id;
    if (id === 'ed-folder') {
      const to = e.target.value || null;
      if (to && isVaultFolder(to) && !vaultUnlocked(to)) { toast('Unlock that vault first.', true); return renderEditor(); }
      const wasVault = isVaultFolder(n.folderId);
      n.folderId = to;
      await saveNote(n);
      if (wasVault && !isVaultFolder(to)) toast('Moved out of the vault. This note is no longer encrypted.');
      if (isVaultFolder(to)) {
        toast('Moved into the vault and encrypted.');
        // re-encrypt attachments that belong to this note
        for (const r of [...S.resources.values()].filter((r) => r.noteId === n.id)) { await DB.del('resources', r.id); S.rawResources.delete(r.id); S.resources.delete(r.id); await addResourceWithId(r); }
      }
      return render();
    }
    if (id === 'ed-todo') { n.isTodo = e.target.checked; if (n.isTodo && !n.status) n.status = 'todo'; await saveNote(n, { snapshot: false }); return render(); }
    if (id === 'ed-status') { n.status = e.target.value; n.done = n.status === 'done'; await saveNote(n, { snapshot: false }); return render(); }
    if (id === 'ed-due') { n.due = e.target.value; await saveNote(n, { snapshot: false }); return renderList(); }
    if (id === 'ed-remind') { n.remindAt = e.target.value; n.reminded = false; await saveNote(n, { snapshot: false }); if (n.remindAt) ensureNotifyPermission(); return; }
  });
  E.addEventListener('keydown', (e) => {
    if (e.target.id === 'ed-tag-in' && (e.key === 'Enter' || e.key === ',')) {
      e.preventDefault(); const v = e.target.value.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-');
      const n = cur(); if (v && n && !n.tags.includes(v)) { n.tags.push(v); saveNote(n, { snapshot: false }).then(() => { render(); $('#ed-tag-in')?.focus(); }); }
      return;
    }
    if (e.target.id === 'ed-title' && e.key === 'Enter') { e.preventDefault(); $('#ed-src')?.focus(); return; }
    if (e.target.id !== 'ed-src') return;
    if (ac) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ac.sel = (ac.sel + (e.key === 'ArrowDown' ? 1 : -1) + ac.items.length) % ac.items.length; $$('#ac button').forEach((b, i) => b.classList.toggle('sel', i === ac.sel)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return pickAc(ac.sel); }
      if (e.key === 'Escape') { e.preventDefault(); return closeAc(); }
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); applyFmt('bold'); }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); applyFmt('italic'); }
    if (e.key === 'Tab' && !mod) { e.preventDefault(); insertAtCursor('  '); }
    if (e.key === 'Enter' && !mod && !e.shiftKey) {
      // continue lists
      const ta = e.target; const before = ta.value.slice(0, ta.selectionStart);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      const m = /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)\. )/.exec(line);
      if (m) {
        e.preventDefault();
        if (line.trim() === m[2].trim()) { ta.setSelectionRange(ta.selectionStart - line.length, ta.selectionStart); insertAtCursor('\n'); return; }
        let next = m[2]; if (m[3]) next = `${+m[3] + 1}. `; if (/\[[xX]\]/.test(next)) next = next.replace(/\[[xX]\]/, '[ ]');
        insertAtCursor('\n' + m[1] + next);
      }
    }
  });
  E.addEventListener('blur', (e) => { if (e.target.id === 'ed-src') setTimeout(closeAc, 150); }, true);
  E.addEventListener('paste', async (e) => {
    if (e.target.id !== 'ed-src') return;
    const img = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (img) { e.preventDefault(); await attachImage(img.getAsFile(), true); }
  });
  E.addEventListener('click', async (e) => {
    const wl = e.target.closest('a.wl'); if (wl) { e.preventDefault(); return followWikiLink(wl.dataset.wl); }
    const rl = e.target.closest('a.res-link'); if (rl) { e.preventDefault(); const r = S.resources.get(rl.dataset.res); if (!r) return toast('Attachment not available (is its vault locked?)', true); const blob = await (await fetch(r.data)).blob(); return download(r.name, blob, r.mime); }
    const cb = e.target.closest('input[data-task]');
    if (cb) { const n = cur(); n.body = toggleTaskInSource(n.body, +cb.dataset.task); const ta = $('#ed-src'); if (ta) ta.value = n.body; markDirty(); refreshPreview(); return; }
    const ob = e.target.closest('#item-props [data-opt]'); if (ob) { ob.setAttribute('aria-pressed', ob.getAttribute('aria-pressed') !== 'true'); return onItemPropChange(ob); }
    const b = e.target.closest('button'); if (!b) return;
    const n = cur();
    if (b.dataset.mode) { S.ui.mode = b.dataset.mode; S.settings.editorMode = S.ui.mode; saveSettings(); return renderEditor(); }
    if (b.dataset.fmt) return applyFmt(b.dataset.fmt);
    if (b.dataset.open) return openNote(b.dataset.open);
    if (b.dataset.wlcreate) return followWikiLink(b.dataset.wlcreate);
    if (b.dataset.rmtag) { n.tags = n.tags.filter((t) => t !== b.dataset.rmtag); await saveNote(n, { snapshot: false }); return render(); }
    if (b.dataset.addtag) { if (!n.tags.includes(b.dataset.addtag)) { n.tags.push(b.dataset.addtag); await saveNote(n, { snapshot: false }); } b.remove(); return renderRail(); }
    switch (b.dataset.act) {
      case 'new': return createNote();
      case 'today': return getOrCreateDaily().then((d) => openNote(d.id));
      case 'tpl': return templateDialog();
      case 'unlock': return unlockDialog(n.folderId);
      case 'back': return setPane('list');
      case 'to-project': return openProject(n.projectId);
      case 'trash': n.deleted = now(); await saveNote(n, { snapshot: false, touch: false }); toast('Moved to trash'); S.ui.noteId = null; return render();
      case 'restore': n.deleted = 0; await saveNote(n, { snapshot: false }); toast('Restored'); return render();
      case 'purge': return confirmDialog('Delete forever?', `“${n.title || 'Untitled'}” and its history will be permanently deleted.`, 'Delete forever', () => purgeNotes([n]));
      case 'attach': return attachDialog();
      case 'voice': return toggleVoice();
      case 'summarize': return aiSummarize(n);
      case 'autotag': return aiAutoTag(n);
      case 'ai-cards': return aiCards(n);
      case 'close-ai': aiPanel = null; return renderEditor();
      case 'ai-insert': if (aiPanel?.insert) { n.body = aiPanel.insert + n.body; aiPanel = null; await saveNote(n); toast('Added to the top of the note'); } return renderEditor();
      case 'ai-append': if (aiPanel?.insert) { n.body = n.body.replace(/\s*$/, '') + aiPanel.insert; aiPanel = null; await saveNote(n); toast('Flashcards added'); } return renderEditor();
      case 'history': return historyDialog(n);
      case 'publish': return publishNote(n);
      case 'export': return download(safeName(n.title) + '.md', noteToMd(n), 'text/markdown');
    }
  });
}
async function addResourceWithId(r) {
  const n = S.notes.get(r.noteId); S.resources.set(r.id, r);
  if (n && isVaultFolder(n.folderId)) { const rec = { id: r.id, noteId: r.noteId, enc: await Crypt.enc(S.keys.get(n.folderId), { name: r.name, mime: r.mime, data: r.data }) }; S.rawResources.set(r.id, rec); await DB.put('resources', rec); }
  else { S.rawResources.set(r.id, r); await DB.put('resources', r); }
}
const safeName = (s) => (s || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80).trim() || 'Untitled';
function noteToMd(n) {
  const fm = ['---', `title: ${JSON.stringify(n.title || '')}`, `id: ${n.id}`, `notebook: ${JSON.stringify(folderPath(n.folderId))}`, `tags: [${(n.tags || []).map((t) => JSON.stringify(t)).join(', ')}]`, `created: ${new Date(n.createdAt).toISOString()}`, `updated: ${new Date(n.updatedAt).toISOString()}`];
  if (n.isTodo) fm.push(`task: true`, `status: ${n.status || 'todo'}`, `due: ${n.due || ''}`);
  fm.push('---', '');
  return fm.join('\n') + n.body.replace(/\(gsres:\/\/([a-z0-9]+)\)/g, (m, id) => { const r = S.resources.get(id); return r ? `(${r.data})` : m; });
}
