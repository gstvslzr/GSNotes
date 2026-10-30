// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
/* ============================================================
   AI assistant (Ollama / OpenAI-compatible, with offline fallbacks)
   ============================================================ */
const embCache = new Map();
const aiOn = () => S.settings.ai.provider !== 'none';
const aiRemote = () => S.settings.ai.provider === 'openai';
// notes allowed to reach the AI: vault notes only go to a local (Ollama) model
const aiEligible = (n) => !n.deleted && !n.locked && n.folderId !== S.settings.templateFolder && (!isVaultFolder(n.folderId) || !aiRemote());

async function aiFetch(path, body) {
  const a = S.settings.ai;
  const headers = { 'Content-Type': 'application/json' };
  if (a.provider === 'openai' && a.key) headers.Authorization = 'Bearer ' + a.key;
  let res;
  try { res = await httpFetch(a.url.replace(/\/+$/, '') + path, { method: 'POST', headers, body: JSON.stringify(body) }); }
  catch { throw new Error(a.provider === 'ollama' ? 'Could not reach Ollama. Check that it is running and was started with OLLAMA_ORIGINS set to allow this app.' : 'Could not reach the AI provider. Check the server URL and your connection.'); }
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`AI provider returned ${res.status}${t ? ': ' + t.slice(0, 160) : ''}`); }
  return res.json();
}
async function aiChat(system, user) {
  const a = S.settings.ai; const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  if (a.provider === 'ollama') { const r = await aiFetch('/api/chat', { model: a.model, messages, stream: false, options: { temperature: 0.2 } }); return r.message?.content || ''; }
  const r = await aiFetch('/chat/completions', { model: a.model, messages, temperature: 0.2 }); return r.choices?.[0]?.message?.content || '';
}
async function aiEmbed(texts) {
  const a = S.settings.ai; const out = new Array(texts.length); const todo = [];
  const keys = await Promise.all(texts.map((t) => Crypt.sha(a.embedModel + '|' + t)));
  texts.forEach((t, i) => { if (embCache.has(keys[i])) out[i] = embCache.get(keys[i]); else todo.push(i); });
  for (let s = 0; s < todo.length; s += 16) {
    const batch = todo.slice(s, s + 16); const input = batch.map((i) => texts[i].slice(0, 6000));
    let vecs;
    if (a.provider === 'ollama') {
      try { vecs = (await aiFetch('/api/embed', { model: a.embedModel, input })).embeddings; }
      catch { vecs = []; for (const t of input) vecs.push((await aiFetch('/api/embeddings', { model: a.embedModel, prompt: t })).embedding); }
    } else vecs = (await aiFetch('/embeddings', { model: a.embedModel, input })).data.map((d) => d.embedding);
    batch.forEach((i, j) => { out[i] = vecs[j]; embCache.set(keys[i], vecs[j]); });
  }
  return out;
}
const cosine = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x * y) || 1); };

async function semanticScores(q) {
  const pool = liveNotes().filter(aiEligible);
  toast('Searching by meaning…', false, 1500);
  const [qv, ...vs] = await aiEmbed([q, ...pool.map((n) => `${n.title}\n${(n.tags || []).join(' ')}\n${stripMd(n.body).slice(0, 2000)}`)]);
  const m = new Map(); pool.forEach((n, i) => m.set(n.id, cosine(qv, vs[i]))); return m;
}

async function testAI() {
  const el = $('#ai-test'); if (el) el.textContent = 'Testing…';
  try {
    const t0 = performance.now(); const r = await aiChat('Reply with exactly: OK', 'ping');
    let emb = '';
    try { const [v] = await aiEmbed(['connection test ' + Date.now()]); emb = ` · embeddings OK (${v.length} dims)`; } catch (e) { emb = ' · embeddings failed: ' + e.message; }
    if (el) el.textContent = `Chat replied “${r.trim().slice(0, 30)}” in ${Math.round(performance.now() - t0)} ms${emb}`;
  } catch (e) { if (el) el.textContent = e.message; }
}

/* retrieval over note chunks */
async function retrieve(q, k = 6) {
  const chunks = [];
  for (const n of liveNotes().filter(aiEligible)) chunk(n.body).forEach((c, i) => chunks.push({ id: n.id + '#' + i, noteId: n.id, title: n.title || 'Untitled', text: c }));
  if (!chunks.length) return [];
  if (aiOn()) {
    try {
      const [qv, ...vs] = await aiEmbed([q, ...chunks.map((c) => c.title + '\n' + c.text)]);
      return chunks.map((c, i) => ({ ...c, score: cosine(qv, vs[i]) })).sort((a, b) => b.score - a.score).slice(0, k);
    } catch (e) { toast('Embeddings unavailable, using keyword match: ' + e.message, true, 4500); }
  }
  const ranked = bm25(chunks.map((c) => ({ id: c.id, text: c.title + ' ' + stripMd(c.text) })), q);
  const byId = new Map(chunks.map((c) => [c.id, c]));
  return ranked.slice(0, k).map((r) => ({ ...byId.get(r.id), score: r.score }));
}
async function askNotes(q) {
  const hits = await retrieve(q);
  if (!hits.length) return `<div class="note-box">No notes matched that question. Try different words.</div>`;
  const srcList = (cite) => `<div class="ask-src"><h4 class="muted small" style="margin:6px 0 0;text-transform:uppercase;letter-spacing:.08em">${cite ? 'Sources' : 'Best-matching passages'}</h4>${hits.map((h, i) => `<button data-open="${h.noteId}"><b>${cite ? `[${i + 1}] ` : ''}${esc(h.title)}</b><br>${esc(stripMd(h.text).slice(0, cite ? 180 : 420))}${stripMd(h.text).length > (cite ? 180 : 420) ? '…' : ''}</button>`).join('')}</div>`;
  if (!aiOn()) return srcList(false);
  const ctx = hits.map((h, i) => `[${i + 1}] Note: ${h.title}\n${h.text}`).join('\n\n---\n\n');
  const ans = await aiChat('You answer questions using ONLY the user’s notes provided as numbered sources. Cite sources inline like [1] or [2]. If the notes do not contain the answer, say so plainly and do not guess. Be concise. Answer in the language of the question.', `Sources:\n\n${ctx}\n\nQuestion: ${q}`);
  const html = renderMd(ans).replace(/\[(\d+)\]/g, (m, d) => hits[d - 1] ? `<a href="#" class="wl" data-src="${hits[d - 1].noteId}">[${d}]</a>` : m);
  return `<div class="md" style="max-width:none">${html}</div>${srcList(true)}`;
}

function showAiPanel(n, title, html, insert) { aiPanel = { noteId: n.id, title, html, insert }; renderEditor(); $('#ai-panel')?.scrollIntoView({ block: 'nearest' }); }
async function withBusy(label, fn) { toast(label, false, 1800); try { return await fn(); } catch (e) { toast(e.message, true, 5000); } }

async function aiSummarize(n) {
  if (!n.body.trim()) return toast('This note is empty.', true);
  if (!aiOn() || !aiEligible(n)) {
    const s = extractiveSummary(n.body, 3);
    const text = s.map((x) => '- ' + x).join('\n');
    return showAiPanel(n, 'Key sentences (offline summary)', `${s.length ? `<div class="md small">${renderMd(text)}</div><div class="row"><button class="btn sm" data-act="ai-insert">Insert at top</button><span class="muted small">Connect an AI provider for written summaries.</span></div>` : '<p class="small">This note is too short to summarize.</p>'}`, `> **Summary**\n${text.split('\n').map((l) => '> ' + l).join('\n')}\n\n`);
  }
  await withBusy('Summarizing…', async () => {
    const out = await aiChat('Summarize the note in 3-5 short bullet points. Use Markdown bullets. Same language as the note. No preamble.', `Title: ${n.title}\n\n${n.body.slice(0, 12000)}`);
    showAiPanel(n, 'Summary', `<div class="md small">${renderMd(out)}</div><div class="row"><button class="btn sm" data-act="ai-insert">Insert at top</button></div>`, `> **Summary**\n${out.trim().split('\n').map((l) => '> ' + l).join('\n')}\n\n`);
  });
}
async function aiAutoTag(n) {
  let tags;
  if (!aiOn() || !aiEligible(n)) tags = keywords(n.title + ' ' + n.body, liveNotes().filter((x) => !x.locked).map((x) => x.title + ' ' + stripMd(x.body)), 6);
  else tags = await withBusy('Suggesting tags…', async () => {
    const existing = [...new Set(liveNotes().flatMap((x) => x.tags || []))].slice(0, 80).join(', ');
    const out = await aiChat('Suggest 3 to 6 short lowercase tags for the note. Prefer reusing existing tags when they fit. Reply with ONLY a JSON array of strings.', `Existing tags: ${existing || '(none)'}\n\nTitle: ${n.title}\n\n${n.body.slice(0, 8000)}`);
    try { return JSON.parse(out.match(/\[[\s\S]*\]/)[0]); } catch { return out.split(/[,\n]/).map((s) => s.replace(/[^\p{L}\p{N}-]/gu, '')).filter(Boolean); }
  });
  if (!tags) return;
  tags = tags.map((t) => String(t).toLowerCase().trim().replace(/\s+/g, '-')).filter((t) => t && !(n.tags || []).includes(t)).slice(0, 8);
  showAiPanel(n, aiOn() ? 'Suggested tags' : 'Suggested tags (from distinctive words)', tags.length ? `<div class="row">${tags.map((t) => `<button class="chip" data-addtag="${esc(t)}">+ #${esc(t)}</button>`).join('')}</div><p class="small muted" style="margin:0">Click a tag to add it.</p>` : '<p class="small">No new tag ideas for this note.</p>');
}
async function aiCards(n) {
  let lines;
  if (!aiOn() || !aiEligible(n)) {
    // offline: turn "**Term** — definition", "Term: definition" and "## Heading" + first sentence into cards
    lines = [];
    for (const l of n.body.split('\n')) {
      let m = /^\s*[-*]?\s*\*\*(.+?)\*\*\s*[—:–-]\s*(.+)$/.exec(l) || /^\s*[-*]\s+([^:]{2,60}):\s+(.{3,})$/.exec(l);
      if (m && !l.includes('::')) lines.push(`${m[1].trim()} :: ${m[2].trim()}`);
    }
    const heads = [...n.body.matchAll(/^#{2,3}\s+(.+)\n+([^#\n][^\n]{10,})/gm)];
    for (const h of heads) lines.push(`${h[1].trim()} :: ${sentences(h[2])[0] || h[2].trim()}`);
    lines = [...new Set(lines)].slice(0, 20);
  } else {
    lines = await withBusy('Writing flashcards…', async () => {
      const out = await aiChat('Create 4-10 flashcards from the note. Each card on its own line in the exact format: question :: answer. Short, factual, only from the note. No numbering, no other text.', `Title: ${n.title}\n\n${n.body.slice(0, 12000)}`);
      return out.split('\n').map((l) => l.replace(/^\s*[-*\d.]+\s*/, '').trim()).filter((l) => / :: /.test(l));
    });
  }
  if (!lines) return;
  showAiPanel(n, aiOn() ? 'Generated flashcards' : 'Flashcards from definitions and headings', lines.length
    ? `<div class="md small">${renderMd(lines.join('\n'))}</div><div class="row"><button class="btn sm" data-act="ai-append">Add to end of note</button><span class="muted small">${lines.length} card${lines.length === 1 ? '' : 's'}</span></div>`
    : `<p class="small">No definitions found. Write lines like <code>**Term** — meaning</code>, or connect an AI provider.</p>`, '\n\n## Flashcards\n' + lines.join('\n') + '\n');
}

/* ============================================================
   Voice dictation (Web Speech API)
   ============================================================ */
const voice = { active: false, rec: null, target: null, btn: null };
function toggleVoice(target, btn) { if (voice.active) return stopVoice(); startVoice(target, btn); }
function startVoice(target, btn) {
  if (IS_DESKTOP) return toast('Dictation is not available in the desktop app: it relies on a speech service that only Chrome, Edge and Safari provide. Open GSNotes in one of those browsers to dictate.', true, 7000);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('This browser has no built-in dictation. Use Chrome, Edge or Safari, or your operating system’s dictation (Win+H on Windows, Fn Fn on Mac).', true, 6000);
  const rec = new SR(); rec.lang = S.settings.voiceLang; rec.continuous = true; rec.interimResults = false;
  voice.rec = rec; voice.target = target || null; voice.btn = btn || null; voice.active = true;
  rec.onresult = (e) => {
    let text = ''; for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
    text = text.trim(); if (!text) return;
    const ta = voice.target || $('#ed-src'); if (!ta) return;
    const pre = ta.value.slice(0, ta.selectionStart); const sep = pre && !/\s$/.test(pre) ? ' ' : '';
    const out = sep + text.charAt(0).toUpperCase() + text.slice(1);
    if (ta.id === 'ed-src') { ta.focus(); insertAtCursor(out); } else { const a = ta.selectionStart; ta.value = ta.value.slice(0, a) + out + ta.value.slice(ta.selectionEnd); ta.setSelectionRange(a + out.length, a + out.length); }
  };
  rec.onerror = (e) => { toast(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone access was blocked. Allow it in your browser’s site settings.' : 'Dictation stopped: ' + e.error, true, 5000); stopVoice(); };
  rec.onend = () => { if (voice.active) { try { rec.start(); } catch { stopVoice(); } } };
  try { rec.start(); toast('Listening… click Stop when done'); } catch (e) { toast('Could not start dictation: ' + e.message, true); voice.active = false; }
  paintVoice();
}
function stopVoice() { voice.active = false; try { voice.rec?.stop(); } catch {} voice.rec = null; paintVoice(); }
function paintVoice() {
  const b = voice.btn || $('#voice-btn'); if (b) b.innerHTML = voice.active ? '<span class="rec-dot"></span> Stop' : 'Dictate';
}

/* ============================================================
   Images, OCR (Tesseract.js) and PDF text (pdf.js) — loaded on demand
   ============================================================ */
const LIB = window.GS_LIBS || {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
};
async function shrinkImage(dataUrl, max = 2000) {
  const img = new Image(); img.src = dataUrl; await img.decode().catch(() => {});
  if (!img.naturalWidth || (img.naturalWidth <= max && img.naturalHeight <= max && dataUrl.length < 1.5e6)) return dataUrl;
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}
async function ocr(image) {
  const T = await loadScript(LIB.tesseract, 'Tesseract');
  const r = await T.recognize(image, S.settings.ocrLang, window.GS_TESS_OPTS || {});
  return (r.data.text || '').replace(/\n{3,}/g, '\n\n').trim();
}
async function attachImage(file, doOcr) {
  const n = cur(); if (!n) return;
  const data = await shrinkImage(await readDataURL(file));
  const name = file.name || `pasted-${ymd()}.png`;
  const r = await addResource(n.id, name, data.slice(5, data.indexOf(';')), data);
  insertAtCursor(`\n![${name}](gsres://${r.id})\n`);
  if (!doOcr) return;
  toast('Reading text in the image…', false, 2500);
  try {
    const text = await ocr(data);
    if (!text) return toast('No text found in that image.');
    const note = S.notes.get(n.id);
    note.body = note.body.replace(`(gsres://${r.id})\n`, `(gsres://${r.id})\n\n<details><summary>Text in image</summary>\n\n${text}\n\n</details>\n`);
    await saveNote(note);
    if (S.ui.noteId === n.id) renderEditor();
    toast('Image text added — search will find it');
  } catch (e) { toast('Text recognition failed: ' + e.message, true, 5000); }
}
async function attachPdf(file) {
  const n = cur(); if (!n) return;
  toast('Reading PDF…', false, 2000);
  try {
    const lib = await loadScript(LIB.pdf, 'pdfjsLib');
    lib.GlobalWorkerOptions.workerSrc = LIB.pdfWorker;
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = []; let ocrCount = 0;
    for (let p = 1; p <= Math.min(pdf.numPages, 200); p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      let text = tc.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+\n/g, '\n').trim();
      if (text.length < 25 && ocrCount < 15) {
        const vp = page.getViewport({ scale: 2 }); const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        text = await ocr(c.toDataURL('image/png')); ocrCount++;
      }
      if (text) pages.push(`**Page ${p}**\n\n${text}`);
    }
    insertAtCursor(`\n\n## ${file.name}\n\n${pages.join('\n\n') || '*No text found.*'}\n`);
    toast(`Extracted ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}${ocrCount ? ` (${ocrCount} scanned)` : ''}`);
  } catch (e) { toast('Could not read that PDF: ' + e.message, true, 5000); }
}

/* ============================================================
   Sync, backup, import
   ============================================================ */
async function buildPayload() {
  return { app: 'gsnotes', version: 1, exportedAt: new Date().toISOString(), folders: await DB.all('folders'), notes: await DB.all('notes'), cards: await DB.all('cards'), resources: await DB.all('resources'), projects: await DB.all('projects'), tombstones: S.tombstones };
}
async function sealPayload(p) {
  const pass = S.settings.sync.passphrase; if (!pass) return p;
  const salt = Crypt.newSalt(); const key = await Crypt.deriveKey(pass, salt);
  return { app: 'gsnotes', version: 1, encrypted: true, salt, box: await Crypt.enc(key, p) };
}
async function openPayload(p, askPass = true) {
  if (!p || p.app !== 'gsnotes') throw new Error('That file is not a GSNotes backup or sync file.');
  if (!p.encrypted) return p;
  let pass = S.settings.sync.passphrase;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (pass) { try { return await Crypt.dec(await Crypt.deriveKey(pass, p.salt), p.box); } catch {} }
    if (!askPass) break;
    pass = await passPrompt(attempt ? 'Wrong passphrase. Try again.' : 'This file is encrypted. Enter its sync passphrase.');
    if (pass == null) break;
  }
  throw new Error('Could not decrypt the sync file — the passphrase does not match.');
}
function passPrompt(msg) {
  return new Promise((res) => {
    const d = openDialog(`${dlgHead('Passphrase needed')}<form class="dialog-b" id="pp-f"><p style="margin:0">${esc(msg)}</p><input class="input" type="password" id="pp-in" autofocus></form><div class="dialog-f"><button class="btn" data-close id="pp-c">Cancel</button><button class="btn primary" form="pp-f">Unlock</button></div>`);
    $('#pp-f', d.el).onsubmit = (e) => { e.preventDefault(); const v = $('#pp-in', d.el).value; d.close(); res(v); };
    $('#pp-c', d.el).onclick = () => res(null);
  });
}
async function mergePayload(p) {
  const tomb = new Map([...S.tombstones, ...(p.tombstones || [])].map((t) => [t.id, t]));
  S.tombstones = [...tomb.values()].slice(-5000);
  await DB.put('meta', { id: 'tombstones', value: S.tombstones });
  let added = 0, updated = 0;
  const localNotes = new Map((await DB.all('notes')).map((n) => [n.id, n]));
  for (const id of tomb.keys()) if (localNotes.has(id)) { await DB.del('notes', id); localNotes.delete(id); }
  for (const r of p.notes || []) {
    if (tomb.has(r.id)) continue;
    const l = localNotes.get(r.id);
    if (!l) { await DB.put('notes', r); added++; } else if ((r.updatedAt || 0) > (l.updatedAt || 0) || (r.deleted || 0) > (l.deleted || 0) && (r.updatedAt || 0) >= (l.updatedAt || 0)) { await DB.put('notes', r); updated++; }
  }
  const lf = new Map((await DB.all('folders')).map((f) => [f.id, f]));
  for (const f of p.folders || []) { const l = lf.get(f.id); if (!l || (f.updatedAt || f.createdAt || 0) > (l.updatedAt || l.createdAt || 0)) await DB.put('folders', f); }
  const lc = new Map((await DB.all('cards')).map((c) => [c.id, c]));
  for (const c of p.cards || []) { const l = lc.get(c.id); if (!l || (c.reps + (c.lapses || 0)) > (l.reps + (l.lapses || 0)) || c.due > l.due) await DB.put('cards', c); }
  const lp = new Map((await DB.all('projects')).map((x) => [x.id, x]));
  for (const id of tomb.keys()) if (lp.has(id)) { await DB.del('projects', id); lp.delete(id); }
  for (const x of p.projects || []) { if (tomb.has(x.id)) continue; const l = lp.get(x.id); if (!l || (x.updatedAt || 0) > (l.updatedAt || 0)) await DB.put('projects', x); }
  const lr = new Set((await DB.all('resources')).map((r) => r.id));
  for (const r of p.resources || []) if (!lr.has(r.id) && !tomb.has(r.noteId)) await DB.put('resources', r);
  await reloadFromDB();
  return { added, updated };
}
async function reloadFromDB() {
  const keys = new Map(S.keys);
  S.notes.clear(); S.folders.clear(); S.projects.clear(); S.cards.clear(); S.resources.clear(); S.rawResources.clear(); S.keys.clear();
  for (const f of await DB.all('folders')) S.folders.set(f.id, f);
  for (const x of await DB.all('projects')) S.projects.set(x.id, x);
  for (const r of await DB.all('notes')) {
    if (r.enc) S.notes.set(r.id, { id: r.id, folderId: r.folderId, projectId: r.projectId || null, props: {}, locked: true, createdAt: r.createdAt, updatedAt: r.updatedAt, deleted: r.deleted, title: '', body: '', tags: [] });
    else S.notes.set(r.id, { tags: [], props: {}, ...r });
  }
  for (const c of await DB.all('cards')) S.cards.set(c.id, c);
  for (const r of await DB.all('resources')) { S.rawResources.set(r.id, r); if (!r.enc) S.resources.set(r.id, r); }
  for (const [fid, key] of keys) {
    if (!S.folders.has(fid)) continue; S.keys.set(fid, key);
    for (const r of await DB.all('notes')) if (r.folderId === fid && r.enc) { try { S.notes.set(r.id, { id: r.id, folderId: fid, projectId: r.projectId || null, createdAt: r.createdAt, updatedAt: r.updatedAt, deleted: r.deleted, tags: [], props: {}, ...(await Crypt.dec(key, r.enc)) }); } catch {} }
    for (const r of S.rawResources.values()) if (r.enc && S.notes.get(r.noteId)?.folderId === fid) { try { S.resources.set(r.id, { id: r.id, noteId: r.noteId, ...(await Crypt.dec(key, r.enc)) }); } catch {} }
  }
  for (const n of S.notes.values()) if (!n.locked) syncCardsFor(n);
  render();
}

async function backupAll() {
  const p = await sealPayload(await buildPayload());
  download(`gsnotes-backup-${ymd()}.json`, JSON.stringify(p), 'application/json');
  toast(p.encrypted ? 'Encrypted backup downloaded' : 'Backup downloaded (vault notes stay encrypted)');
}
async function restoreBackup() {
  const [f] = await pickFiles('.json,application/json', false); if (!f) return;
  try { const p = await openPayload(JSON.parse(await f.text())); const r = await mergePayload(p); toast(`Restored: ${r.added} new, ${r.updated} updated`); }
  catch (e) { toast(e.message, true, 5000); }
}
function parseFrontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text); if (!m) return { meta: {}, body: text };
  const meta = {}; for (const line of m[1].split('\n')) { const kv = /^(\w+):\s*(.*)$/.exec(line); if (kv) { let v = kv[2].trim(); try { v = JSON.parse(v); } catch { if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean); } meta[kv[1]] = v; } }
  return { meta, body: text.slice(m[0].length) };
}
async function importMarkdown() {
  const files = await pickFiles('.md,.markdown,.txt,text/markdown,text/plain'); if (!files.length) return;
  const fid = S.ui.filter.type === 'folder' && S.ui.filter.id && !isVaultFolder(S.ui.filter.id) ? S.ui.filter.id : S.settings.inboxFolder;
  for (const f of files) {
    const { meta, body } = parseFrontMatter(await f.text());
    const title = meta.title || f.name.replace(/\.(md|markdown|txt)$/i, '');
    const n = newNote({ folderId: fid, title, body: body.trim(), tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [], isTodo: meta.task === true, status: meta.status || 'todo', due: meta.due || '' });
    if (meta.created && !isNaN(Date.parse(meta.created))) n.createdAt = Date.parse(meta.created);
    await saveNote(n, { snapshot: false });
  }
  toast(`Imported ${files.length} file${files.length === 1 ? '' : 's'}`); go('notes', { type: 'folder', id: fid });
}
async function importEnex() {
  const [f] = await pickFiles('.enex', false); if (!f) return;
  try {
    const xml = new DOMParser().parseFromString(await f.text(), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('That file isn’t valid Evernote XML.');
    const folder = await ensureFolder('Evernote import');
    const evDate = (s) => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || ''); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : now(); };
    let count = 0, skippedMedia = 0;
    for (const el of xml.querySelectorAll('note')) {
      const content = el.querySelector('content')?.textContent || '';
      skippedMedia += (content.match(/<en-media/g) || []).length;
      const n = newNote({ folderId: folder.id, title: el.querySelector('title')?.textContent || 'Untitled', body: htmlToMd(content.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, '').replace(/<\/?en-note[^>]*>/g, '')), tags: [...el.querySelectorAll('tag')].map((t) => t.textContent.toLowerCase().replace(/\s+/g, '-')) });
      n.createdAt = evDate(el.querySelector('created')?.textContent); n.updatedAt = evDate(el.querySelector('updated')?.textContent) || n.createdAt;
      await saveNote(n, { snapshot: false, touch: false }); count++;
    }
    toast(`Imported ${count} Evernote note${count === 1 ? '' : 's'}${skippedMedia ? ` · ${skippedMedia} attachment${skippedMedia === 1 ? '' : 's'} not imported` : ''}`, false, 5000);
    go('notes', { type: 'folder', id: folder.id });
  } catch (e) { toast(e.message, true, 5000); }
}

/* folder sync (File System Access API) */
async function pickSyncDir() {
  try {
    const h = await window.showDirectoryPicker({ id: 'gsnotes', mode: 'readwrite' });
    await DB.put('meta', { id: 'dirHandle', value: h });
    S.settings.sync.dirName = h.name; await saveSettings();
    toast(`Sync folder set to “${h.name}”`); renderView(); syncFolder();
  } catch (e) { if (e.name !== 'AbortError') toast('Could not use that folder: ' + e.message, true); }
}
async function syncFolder() {
  const rec = await DB.get('meta', 'dirHandle'); const h = rec?.value;
  if (!h) return toast('Choose a sync folder first (Settings → Sync).', true);
  if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return toast('Folder access was not granted.', true);
  try {
    let remote = null;
    try { const fh = await h.getFileHandle('gsnotes-sync.json'); remote = JSON.parse(await (await fh.getFile()).text()); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
    let res = { added: 0, updated: 0 };
    if (remote) res = await mergePayload(await openPayload(remote));
    const out = await sealPayload(await buildPayload());
    const w = await (await h.getFileHandle('gsnotes-sync.json', { create: true })).createWritable(); await w.write(JSON.stringify(out)); await w.close();
    if (!S.settings.sync.passphrase) {
      const dir = await h.getDirectoryHandle('notes', { create: true }); const keep = new Set();
      for (const n of liveNotes()) {
        if (n.locked || isVaultFolder(n.folderId)) continue;
        const name = `${safeName(n.title)}-${n.id.slice(0, 6)}.md`; keep.add(name);
        const fw = await (await dir.getFileHandle(name, { create: true })).createWritable(); await fw.write(noteToMd(n)); await fw.close();
      }
      for await (const [name] of dir.entries()) if (/-[a-z0-9]{6}\.md$/.test(name) && !keep.has(name)) await dir.removeEntry(name).catch(() => {});
    }
    S.settings.sync.lastSync = now(); await saveSettings();
    toast(`Synced with “${h.name}” · ${res.added} new, ${res.updated} updated`);
    if (S.ui.view === 'settings') renderView();
  } catch (e) { toast('Folder sync failed: ' + e.message, true, 5000); }
}
async function syncWebDAV() {
  const s = S.settings.sync; if (!s.webdavUrl) return toast('Enter a WebDAV file URL first.', true);
  const headers = {}; if (s.webdavUser) headers.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(s.webdavUser + ':' + s.webdavPass)));
  try {
    let res = { added: 0, updated: 0 };
    const g = await httpFetch(s.webdavUrl, { headers, cache: 'no-store' });
    if (g.ok) res = await mergePayload(await openPayload(await g.json()));
    else if (g.status !== 404) throw new Error(`server returned ${g.status}`);
    const p = await httpFetch(s.webdavUrl, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(await sealPayload(await buildPayload())) });
    if (!p.ok) throw new Error(`upload returned ${p.status}`);
    s.lastSync = now(); await saveSettings();
    toast(`WebDAV sync done · ${res.added} new, ${res.updated} updated`); if (S.ui.view === 'settings') renderView();
  } catch (e) { toast('WebDAV sync failed: ' + (e.message === 'Failed to fetch' ? 'could not reach the server (check the URL and CORS settings).' : e.message), true, 6000); }
}
async function syncNow() {
  const s = S.settings.sync;
  if (s.dirName) await syncFolder();
  if (s.webdavUrl) await syncWebDAV();
  if (!s.dirName && !s.webdavUrl) { toast('Set up folder or WebDAV sync first.'); go('settings'); }
}
async function wipeAll() {
  for (const st of ['notes', 'folders', 'versions', 'cards', 'resources', 'meta', 'projects']) await DB.clear(st);
  toast('All data erased. Reloading…'); setTimeout(() => location.reload(), 900);
}

/* ============================================================
   Reminders, auto-lock, install, keyboard
   ============================================================ */
async function ensureNotifyPermission() {
  if (!('Notification' in window)) return toast('This browser can’t show notifications. Reminders will appear inside GSNotes.', false, 4500);
  if (Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} }
  if (Notification.permission === 'granted') { if (!S.settings.remindersOn) { S.settings.remindersOn = true; saveSettings(); } }
  else toast('Notifications are blocked, so reminders will appear inside GSNotes.', false, 4500);
}
function checkReminders() {
  const t = new Date(); const nowLocal = `${ymd(t)}T${hm(t)}`;
  for (const n of liveNotes()) {
    if (n.locked || !n.isTodo || n.done || !n.remindAt || n.reminded || n.remindAt > nowLocal) continue;
    n.reminded = true; saveNote(n, { snapshot: false, touch: false });
    const body = n.due ? `Due ${n.due}` : 'Reminder';
    if (S.settings.remindersOn && 'Notification' in window && Notification.permission === 'granted') {
      try { const no = new Notification(n.title || 'GSNotes reminder', { body, tag: n.id }); no.onclick = () => { window.focus(); openNote(n.id); }; } catch { toast(`⏰ ${n.title} — ${body}`, false, 8000); }
    } else toast(`⏰ ${n.title || 'Reminder'} — ${body}`, false, 8000);
  }
}
let lastActivity = now();
function checkIdle() { if (S.keys.size && now() - lastActivity > S.settings.autoLockMin * 60000) { lockAll(true); toast('Vaults locked after inactivity'); } }

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; const b = $('#install-btn'); if (b) b.disabled = false; });

function globalKeys(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { const s = $$('#overlay .scrim').pop(); if (s) { s.remove(); e.preventDefault(); return; } }
  if ($('#overlay .scrim')) return;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); return openPalette(); }
  if (e.altKey && e.code === 'KeyQ') { e.preventDefault(); return quickCapture(); }
  if (e.altKey && e.code === 'KeyN') { e.preventDefault(); return createNote(); }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); const n = cur(); if (n && !n.locked) { saveNote(n).then(() => maybeSnapshot(n, true)).then(() => toast('Saved')); } return; }
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); if (S.ui.view !== 'notes') go('notes'); setTimeout(() => $('#q')?.focus(), 20); return; }
  if (S.ui.view === 'cards' && study && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
    if (e.code === 'Space' && !study.shown) { e.preventDefault(); study.shown = true; renderView(); }
    else if (study.shown && /^[1-4]$/.test(e.key)) gradeCard(+e.key - 1);
  }
}
