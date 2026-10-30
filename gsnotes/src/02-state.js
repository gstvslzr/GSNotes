// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
/* ============================================================
   State, persistence, vaults, versions
   ============================================================ */
const S = {
  projects: new Map(),   // id → project (fields, views)
  notes: new Map(),      // id → note (decrypted in memory, or {locked:true} for locked vault notes)
  folders: new Map(),
  cards: new Map(),
  resources: new Map(), // id → {id, noteId, name, mime, data} (data URL, decrypted)
  rawResources: new Map(),
  keys: new Map(),       // vault folderId → CryptoKey (only while unlocked)
  settings: null,
  tombstones: [],
  ui: { view: 'notes', filter: { type: 'all' }, noteId: null, query: '', searchMode: 'keyword', mode: 'split', pane: 'list', expanded: {} },
};
const DEFAULT_SETTINGS = {
  theme: 'system', editorMode: 'split', autoLockMin: 5, dailyFolder: null, templateFolder: null, inboxFolder: null,
  ai: { provider: 'none', url: 'http://localhost:11434', model: 'llama3.2', embedModel: 'nomic-embed-text', key: '' },
  sync: { webdavUrl: '', webdavUser: '', webdavPass: '', passphrase: '', lastSync: 0, dirName: '' },
  voiceLang: 'en-US', ocrLang: 'eng', remindersOn: false,
};

const isVaultFolder = (fid) => !!(fid && S.folders.get(fid)?.vault);
const vaultUnlocked = (fid) => S.keys.has(fid);
const noteVisible = (n) => !n.locked;

async function persistNote(n) {
  const base = { id: n.id, folderId: n.folderId, projectId: n.projectId || null, createdAt: n.createdAt, updatedAt: n.updatedAt, deleted: n.deleted || 0 };
  if (isVaultFolder(n.folderId)) {
    const key = S.keys.get(n.folderId);
    if (!key) throw new Error('Unlock the vault before saving to it.');
    const { title, body, tags, isTodo, done, status, due, remindAt, reminded, props } = n;
    base.enc = await Crypt.enc(key, { title, body, tags, isTodo, done, status, due, remindAt, reminded, props });
    await DB.put('notes', base);
  } else {
    await DB.put('notes', { ...base, title: n.title, body: n.body, tags: n.tags, isTodo: n.isTodo, done: n.done, status: n.status, due: n.due, remindAt: n.remindAt, reminded: n.reminded, props: n.props || {} });
  }
}

function newNote(over = {}) {
  const t = now();
  return { id: uid(), folderId: S.ui.filter.type === 'folder' ? S.ui.filter.id : (S.settings.inboxFolder || null), title: '', body: '', tags: [], projectId: null, props: {}, isTodo: false, done: false, status: 'todo', due: '', remindAt: '', reminded: false, createdAt: t, updatedAt: t, deleted: 0, ...over };
}

async function saveNote(n, { snapshot = true, touch = true } = {}) {
  if (touch) n.updatedAt = now();
  S.notes.set(n.id, n);
  await persistNote(n);
  if (snapshot) await maybeSnapshot(n);
  syncCardsFor(n);
}

/* ---------- version history ---------- */
const lastSnap = new Map();
async function maybeSnapshot(n, force = false) {
  const prev = lastSnap.get(n.id);
  const content = n.title + '\n' + n.body;
  if (!force && prev && (prev.content === content || now() - prev.at < 90 * 1000)) return;
  if (prev && prev.content === content) return;
  lastSnap.set(n.id, { content, at: now() });
  const v = { id: uid(), noteId: n.id, at: now() };
  if (isVaultFolder(n.folderId)) v.enc = await Crypt.enc(S.keys.get(n.folderId), { title: n.title, body: n.body });
  else { v.title = n.title; v.body = n.body; }
  await DB.put('versions', v);
}
async function getVersions(n) {
  const all = (await DB.all('versions')).filter((v) => v.noteId === n.id).sort((a, b) => b.at - a.at);
  const out = [];
  for (const v of all) {
    if (v.enc) { const k = S.keys.get(n.folderId); if (!k) continue; try { Object.assign(v, await Crypt.dec(k, v.enc)); } catch { continue; } }
    out.push(v);
  }
  return out;
}

/* ---------- vaults ---------- */
async function createVault(name, password) {
  const f = { id: uid(), name, parentId: null, vault: true, salt: Crypt.newSalt(), createdAt: now() };
  const key = await Crypt.deriveKey(password, f.salt);
  f.check = await Crypt.enc(key, { ok: 'gsnotes-vault' });
  S.folders.set(f.id, f); S.keys.set(f.id, key);
  await DB.put('folders', f);
  return f;
}
async function unlockVault(fid, password) {
  const f = S.folders.get(fid);
  const key = await Crypt.deriveKey(password, f.salt);
  try { const c = await Crypt.dec(key, f.check); if (c.ok !== 'gsnotes-vault') throw 0; } catch { throw new Error('Wrong password.'); }
  S.keys.set(fid, key);
  const raw = (await DB.all('notes')).filter((r) => r.folderId === fid && r.enc);
  for (const r of raw) {
    try { const d = await Crypt.dec(key, r.enc); S.notes.set(r.id, { id: r.id, folderId: r.folderId, projectId: r.projectId || null, createdAt: r.createdAt, updatedAt: r.updatedAt, deleted: r.deleted, tags: [], props: {}, ...d }); }
    catch { /* skip corrupt */ }
  }
  for (const r of S.rawResources.values()) if (r.enc && S.notes.get(r.noteId)?.folderId === fid) {
    try { S.resources.set(r.id, { id: r.id, noteId: r.noteId, ...(await Crypt.dec(key, r.enc)) }); } catch {}
  }
  toast(`${f.name} unlocked`);
}
function lockVault(fid, silent) {
  if (!S.keys.has(fid)) return;
  S.keys.delete(fid);
  for (const n of S.notes.values()) if (n.folderId === fid) S.notes.set(n.id, { id: n.id, folderId: fid, projectId: n.projectId || null, props: {}, locked: true, createdAt: n.createdAt, updatedAt: n.updatedAt, deleted: n.deleted, title: '', body: '', tags: [] });
  for (const r of S.rawResources.values()) if (r.enc) S.resources.delete(r.id);
  if (S.ui.noteId && S.notes.get(S.ui.noteId)?.locked) S.ui.noteId = null;
  if (!silent) toast(`${S.folders.get(fid)?.name || 'Vault'} locked`);
}
function lockAll(silent) { [...S.keys.keys()].forEach((k) => lockVault(k, true)); if (!silent) toast('All vaults locked'); render(); }

/* ---------- resources (attachments, OCR'd images) ---------- */
async function addResource(noteId, name, mime, data) {
  const r = { id: uid(), noteId, name, mime, data };
  const n = S.notes.get(noteId);
  S.resources.set(r.id, r);
  if (n && isVaultFolder(n.folderId)) {
    const rec = { id: r.id, noteId, enc: await Crypt.enc(S.keys.get(n.folderId), { name, mime, data }) };
    S.rawResources.set(r.id, rec); await DB.put('resources', rec);
  } else { S.rawResources.set(r.id, r); await DB.put('resources', r); }
  return r;
}

/* ---------- settings ---------- */
async function saveSettings() { await DB.put('meta', { id: 'settings', value: S.settings }); }
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/* ---------- folders ---------- */
function folderPath(fid) { const parts = []; let f = S.folders.get(fid); let guard = 0; while (f && guard++ < 20) { parts.unshift(f.name); f = S.folders.get(f.parentId); } return parts.join(' / '); }
function childFolders(pid) { return [...S.folders.values()].filter((f) => (f.parentId || null) === (pid || null)).sort((a, b) => a.name.localeCompare(b.name)); }
function descendantIds(fid) { const out = [fid]; for (const c of childFolders(fid)) out.push(...descendantIds(c.id)); return out; }
async function ensureFolder(name, opts = {}) {
  let f = [...S.folders.values()].find((x) => x.name === name && !x.parentId && !x.vault);
  if (!f) { f = { id: uid(), name, parentId: null, createdAt: now(), ...opts }; S.folders.set(f.id, f); await DB.put('folders', f); }
  return f;
}

/* ---------- load + seed ---------- */
async function loadAll() {
  const persistent = await DB.open();
  const meta = await DB.all('meta');
  S.settings = structuredClone(DEFAULT_SETTINGS);
  const sm = meta.find((m) => m.id === 'settings');
  if (sm) { S.settings = { ...S.settings, ...sm.value, ai: { ...S.settings.ai, ...(sm.value.ai || {}) }, sync: { ...S.settings.sync, ...(sm.value.sync || {}) } }; }
  S.tombstones = meta.find((m) => m.id === 'tombstones')?.value || [];
  S.lastBackupAt = meta.find((m) => m.id === 'lastBackup')?.value?.at || 0;
  for (const f of await DB.all('folders')) S.folders.set(f.id, f);
  for (const r of await DB.all('notes')) {
    if (r.enc) S.notes.set(r.id, { id: r.id, folderId: r.folderId, projectId: r.projectId || null, props: {}, locked: true, createdAt: r.createdAt, updatedAt: r.updatedAt, deleted: r.deleted, title: '', body: '', tags: [] });
    else S.notes.set(r.id, { tags: [], props: {}, ...r });
  }
  for (const c of await DB.all('cards')) S.cards.set(c.id, c);
  for (const r of await DB.all('resources')) { S.rawResources.set(r.id, r); if (!r.enc) S.resources.set(r.id, r); }
  for (const p of await DB.all('projects')) S.projects.set(p.id, p);
  if (!sm) await seed();
  if (!meta.find((m) => m.id === 'projectsSeeded')) { await seedSampleProject(); await DB.put('meta', { id: 'projectsSeeded', value: true }); }
  S.ui.mode = S.settings.editorMode || 'split';
  return persistent;
}

async function seed() {
  const inbox = await ensureFolder('Inbox');
  const projects = await ensureFolder('Projects');
  const study = await ensureFolder('Study');
  const daily = await ensureFolder('Daily');
  const tpl = await ensureFolder('Templates');
  Object.assign(S.settings, { inboxFolder: inbox.id, dailyFolder: daily.id, templateFolder: tpl.id });
  await saveSettings();
  const d = (days) => { const x = new Date(); x.setDate(x.getDate() + days); return ymd(x); };
  const mk = (o) => ({ ...newNote(), ...o });
  const notes = [
    mk({ folderId: inbox.id, title: 'Welcome to GSNotes', tags: ['sample', 'guide'], body:
`These are **sample notes** so you can see each feature working. Delete them any time.

## Find your way
- Press **Ctrl+K** (⌘K on Mac) for the command palette — every action lives there.
- Press **Alt+Q** for quick capture into your Inbox.
- **Today** opens (or creates) your daily note from the *Daily note* template.

## Link your thinking
Type \`[[\` to link another note, like [[Project Alpha plan]] or [[Network ports]].
The panel under each note lists its **backlinks**. Open **Graph** to see the whole web.

## Study with flashcards
Any line written as \`question :: answer\` becomes a flashcard. See [[Network ports]], then open **Flashcards**.

## Keep secrets secret
Create a **vault notebook** (the 🔒 button next to Notebooks). Notes inside are encrypted with AES-256-GCM using a key derived from your password. Vaults lock themselves after a few idle minutes.

## Tasks
Turn any note into a task (☐ in the toolbar), give it a due date and a reminder, then drag it across the **Board** or find it on the **Calendar**.

- [x] Read this note
- [ ] Try quick capture with Alt+Q
- [ ] Create a vault notebook` }),
    mk({ folderId: study.id, title: 'Network ports', tags: ['networking', 'flashcards'], body:
`Common well-known ports. Each \`::\` line is a flashcard.

HTTPS :: 443/TCP
SSH :: 22/TCP
DNS :: 53/UDP and TCP
SMTP :: 25/TCP
RDP :: 3389/TCP
LDAPS :: 636/TCP
SNMP (queries) :: 161/UDP
Kerberos :: 88/TCP and UDP

Related: [[Welcome to GSNotes]]` }),
    mk({ folderId: projects.id, title: 'Project Alpha plan', tags: ['project', 'alpha'], body:
`## Goal
Move the team wiki into GSNotes and retire the old shared drive folder.

## Milestones
1. Export the old pages as Markdown
2. Import into the **Projects** notebook
3. Review links — see [[Meeting notes 2026-10-01]]

## Risks
- Some pages embed images; import them with **Attach → Image (OCR)** so their text stays searchable.` }),
    mk({ folderId: projects.id, title: 'Meeting notes 2026-10-01', tags: ['meeting', 'alpha'], body:
`**Attendees:** Dana, Luis, Priya

## Decisions
- Use Markdown everywhere; no proprietary formats.
- Keep anything with credentials in a vault notebook.

## Action items
- [ ] Luis: list pages with embedded images
- [x] Priya: confirm export format

Back to [[Project Alpha plan]].` }),
    mk({ folderId: projects.id, title: 'Renew domain registration', tags: ['admin'], isTodo: true, status: 'todo', due: d(3), body: 'Renew before it lapses. Check auto-renew settings on the registrar.' }),
    mk({ folderId: projects.id, title: 'Draft quarterly report', tags: ['report'], isTodo: true, status: 'doing', due: d(8), body: 'Outline: wins, misses, next quarter priorities. Link supporting notes with [[ ]].' }),
    mk({ folderId: inbox.id, title: 'Back up notes to a folder', tags: ['admin'], isTodo: true, status: 'done', done: true, due: d(-2), body: 'Settings → Sync → Choose folder. Pick a folder inside OneDrive or Dropbox to keep a cloud copy.' }),
    mk({ folderId: tpl.id, title: 'Daily note', tags: ['template'], body:
`# {{weekday}}, {{date}}

## Top 3
- [ ]
- [ ]
- [ ]

## Log
- {{time}} —

## Notes
` }),
    mk({ folderId: tpl.id, title: 'Meeting notes', tags: ['template'], body:
`**Date:** {{date}}
**Attendees:**

## Agenda

## Decisions

## Action items
- [ ]
` }),
  ];
  for (const n of notes) { S.notes.set(n.id, n); await persistNote(n); }
  await getOrCreateDaily(true);
  for (const n of notes) syncCardsFor(n);
}

function fillTemplate(body, title) {
  const d = new Date();
  return body.replace(/\{\{date\}\}/g, ymd(d)).replace(/\{\{time\}\}/g, hm(d)).replace(/\{\{title\}\}/g, title || '')
    .replace(/\{\{weekday\}\}/g, d.toLocaleDateString(undefined, { weekday: 'long' }));
}
async function getOrCreateDaily(silent) {
  const title = ymd();
  const fid = S.settings.dailyFolder || (await ensureFolder('Daily')).id;
  let n = [...S.notes.values()].find((x) => !x.deleted && x.folderId === fid && x.title === title);
  if (!n) {
    const tpl = [...S.notes.values()].find((x) => !x.deleted && x.folderId === S.settings.templateFolder && x.title === 'Daily note');
    n = newNote({ folderId: fid, title, tags: ['daily'], body: tpl ? fillTemplate(tpl.body, title) : `# ${title}\n\n` });
    await saveNote(n);
    if (!silent) toast('Created today’s note');
  }
  return n;
}
