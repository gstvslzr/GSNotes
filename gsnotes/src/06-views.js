// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
/* ============================================================
   Full-width views: Board, Calendar, Graph, Flashcards, Ask, Settings
   ============================================================ */
let graphAnim = null;
let calMonth = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
let study = null; // { queue: [cardIds], idx, shown }
let askState = { q: '', html: '' };

function viewHead(title, extra = '') {
  return `<div class="view-head"><button class="btn ghost sm mobile-only" data-vact="rail" aria-label="Back to navigation">☰</button><h2>${title}</h2>${extra}</div>`;
}
function renderView() {
  if (graphAnim) { cancelAnimationFrame(graphAnim); graphAnim = null; }
  const V = $('#view');
  const fn = { backup: viewBackup, project: viewProject, board: viewBoard, calendar: viewCalendar, graph: viewGraph, cards: viewCards, ask: viewAsk, settings: viewSettings }[S.ui.view];
  if (fn) fn(V);
}

/* ---------- Board ---------- */
function viewBoard(V) {
  const tasks = liveNotes().filter((n) => n.isTodo && !n.locked);
  const cols = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];
  const statusOf = (n) => n.done ? 'done' : (n.status || 'todo');
  V.innerHTML = viewHead('Board', `<span class="muted small">Drag cards between columns. ${tasks.length} task${tasks.length === 1 ? '' : 's'}.</span><button class="btn sm primary" data-vact="newtask" style="margin-left:auto">+ Task</button>`) +
    `<div class="view-body"><div class="board">${cols.map(([k, lbl]) => {
      const items = tasks.filter((n) => statusOf(n) === k).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
      return `<div class="col" data-col="${k}"><h3>${lbl}<span class="mono">${items.length}</span></h3>${items.map((n) => `
        <div class="kcard" draggable="true" data-id="${n.id}">
          <div class="t">${esc(n.title || 'Untitled')}</div>
          <div class="row small">${dueChip(n)}${n.folderId ? `<span class="muted">${esc(S.folders.get(n.folderId)?.name || '')}</span>` : ''}
            <span style="margin-left:auto;display:flex;gap:2px">${k !== 'todo' ? `<button class="btn ghost sm" data-move="${n.id}" data-to="${k === 'done' ? 'doing' : 'todo'}" aria-label="Move left">←</button>` : ''}${k !== 'done' ? `<button class="btn ghost sm" data-move="${n.id}" data-to="${k === 'todo' ? 'doing' : 'done'}" aria-label="Move right">→</button>` : ''}</span></div>
        </div>`).join('') || '<p class="muted small" style="margin:4px">Nothing here.</p>'}</div>`;
    }).join('')}</div></div>`;
}
async function moveTask(id, to) {
  const n = S.notes.get(id); if (!n) return;
  n.status = to; n.done = to === 'done';
  await saveNote(n, { snapshot: false }); renderView(); renderRail();
}

/* ---------- Calendar ---------- */
function viewCalendar(V) {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  const first = new Date(y, m, 1); const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const byDay = {};
  for (const n of liveNotes()) {
    if (n.locked) continue;
    if (n.isTodo && n.due) (byDay[n.due] ||= []).push({ n, kind: 'task' });
    if (n.folderId === S.settings.dailyFolder && /^\d{4}-\d{2}-\d{2}$/.test(n.title)) (byDay[n.title] ||= []).push({ n, kind: 'daily' });
  }
  const today = ymd();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = ymd(d);
    const evs = byDay[k] || [];
    cells += `<div class="day${d.getMonth() !== m ? ' other' : ''}${k === today ? ' today' : ''}" data-day="${k}"><span class="dn">${d.getDate()}</span>
      ${evs.slice(0, 4).map((e) => `<button class="ev${e.kind === 'daily' ? ' daily' : ''}${e.n.done ? ' done' : ''}" data-open="${e.n.id}" title="${esc(e.n.title)}">${e.kind === 'daily' ? 'Daily note' : esc(e.n.title || 'Untitled')}</button>`).join('')}
      ${evs.length > 4 ? `<span class="small muted">+${evs.length - 4} more</span>` : ''}</div>`;
  }
  V.innerHTML = viewHead(calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    `<div class="row"><button class="btn sm" data-vact="calprev" aria-label="Previous month">‹</button><button class="btn sm" data-vact="caltoday">Today</button><button class="btn sm" data-vact="calnext" aria-label="Next month">›</button></div><span class="muted small">Click an empty spot on a day to add a task due that day.</span>`) +
    `<div class="view-body"><div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells}</div></div>`;
}

/* ---------- Graph ---------- */
function viewGraph(V) {
  V.innerHTML = viewHead('Graph', `<label class="row small"><input type="checkbox" id="g-tags" ${S.ui.graphTags ? 'checked' : ''}> Show tags</label><label class="row small"><input type="checkbox" id="g-orph" ${S.ui.graphOrphans !== false ? 'checked' : ''}> Show unlinked notes</label>`) +
    `<div class="graph-wrap"><canvas id="graph" aria-label="Graph of linked notes"></canvas><div class="graph-legend">Drag to pan · scroll to zoom · click a note to open it</div></div>`;
  const canvas = $('#graph'); const ctx = canvas.getContext('2d');
  const notes = liveNotes().filter((n) => !n.locked && n.folderId !== S.settings.templateFolder);
  const nodes = []; const idx = new Map(); const edges = [];
  const addNode = (id, label, kind) => { if (idx.has(id)) return idx.get(id); const o = { id, label, kind, x: (Math.random() - .5) * 400, y: (Math.random() - .5) * 400, vx: 0, vy: 0, deg: 0 }; idx.set(id, o); nodes.push(o); return o; };
  for (const n of notes) addNode(n.id, n.title || 'Untitled', 'note');
  for (const n of notes) for (const t of outLinks(n)) { const target = noteByTitle(t); if (target && idx.has(target.id) && target.id !== n.id) edges.push([idx.get(n.id), idx.get(target.id)]); }
  if (S.ui.graphTags) for (const n of notes) for (const t of n.tags || []) edges.push([idx.get(n.id), addNode('tag:' + t, '#' + t, 'tag')]);
  for (const [a, b] of edges) { a.deg++; b.deg++; }
  if (S.ui.graphOrphans === false) { for (let i = nodes.length - 1; i >= 0; i--) if (!nodes[i].deg) { idx.delete(nodes[i].id); nodes.splice(i, 1); } }
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  let W, H, dpr = window.devicePixelRatio || 1;
  const view = { x: 0, y: 0, k: 1 };
  const resize = () => { const r = canvas.getBoundingClientRect(); W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr; };
  resize();
  let hover = null, alpha = 1;
  const tick = () => {
    if (alpha > 0.01) {
      for (const a of nodes) { a.vx -= a.x * 0.0025 * alpha; a.vy -= a.y * 0.0025 * alpha; }
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy || 1;
        if (d2 > 160000) continue; const f = 1800 / d2 * alpha; const d = Math.sqrt(d2); dx /= d; dy /= d;
        a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
      }
      for (const [a, b] of edges) { const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - 130) * 0.02 * alpha; a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f; }
      for (const a of nodes) { if (a.fixed) continue; a.vx *= 0.82; a.vy *= 0.82; a.x += a.vx; a.y += a.vy; }
      alpha *= 0.992;
    }
    draw(); graphAnim = requestAnimationFrame(tick);
  };
  const toScreen = (n) => [W / 2 + (n.x + view.x) * view.k, H / 2 + (n.y + view.y) * view.k];
  const radius = (n) => n.kind === 'tag' ? 4 : 5 + Math.min(9, n.deg * 1.6);
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1; ctx.strokeStyle = col('--line');
    const hl = hover ? new Set(edges.filter(([a, b]) => a === hover || b === hover).flatMap(([a, b]) => [a, b])) : null;
    for (const [a, b] of edges) { const [x1, y1] = toScreen(a), [x2, y2] = toScreen(b); ctx.strokeStyle = hl && hl.has(a) && hl.has(b) ? col('--accent') : col('--line'); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
    ctx.font = `12px ${col('--f-body')}`; ctx.textAlign = 'center';
    for (const n of nodes) {
      const [x, y] = toScreen(n); const r = radius(n) * Math.max(.6, Math.min(1.4, view.k));
      const dim = hl && !hl.has(n);
      ctx.globalAlpha = dim ? .3 : 1;
      ctx.fillStyle = n.kind === 'tag' ? col('--amber') : n === hover ? col('--accent') : n.deg ? col('--accent') : col('--fg-3');
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      if (n === hover || n.deg >= 2 || view.k > 1.3 || (hl && hl.has(n))) { ctx.fillStyle = col('--fg'); ctx.fillText(n.label.length > 28 ? n.label.slice(0, 27) + '…' : n.label, x, y - r - 5); }
      ctx.globalAlpha = 1;
    }
    if (!nodes.length) { ctx.fillStyle = col('--fg-3'); ctx.fillText('No notes to show yet. Link notes with [[Title]].', W / 2, H / 2); }
  }
  const pick = (mx, my) => { let best = null, bd = 1e9; for (const n of nodes) { const [x, y] = toScreen(n); const d = (x - mx) ** 2 + (y - my) ** 2; if (d < bd && d < (radius(n) + 8) ** 2) { bd = d; best = n; } } return best; };
  let drag = null, moved = false;
  canvas.onpointerdown = (e) => { const r = canvas.getBoundingClientRect(); const n = pick(e.clientX - r.left, e.clientY - r.top); drag = { n, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; moved = false; canvas.setPointerCapture(e.pointerId); if (n) { n.fixed = true; alpha = Math.max(alpha, .3); } };
  canvas.onpointermove = (e) => {
    const r = canvas.getBoundingClientRect();
    if (drag) { const dx = (e.clientX - drag.sx) / view.k, dy = (e.clientY - drag.sy) / view.k; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true; if (drag.n) { drag.n.x = (e.clientX - r.left - W / 2) / view.k - view.x; drag.n.y = (e.clientY - r.top - H / 2) / view.k - view.y; } else { view.x = drag.vx + dx; view.y = drag.vy + dy; } }
    else { hover = pick(e.clientX - r.left, e.clientY - r.top); canvas.style.cursor = hover ? 'pointer' : 'grab'; }
  };
  canvas.onpointerup = () => { if (drag?.n) { drag.n.fixed = false; if (!moved) { const n = drag.n; drag = null; if (n.kind === 'note') return openNote(n.id); return go('notes', { type: 'tag', tag: n.id.slice(4) }); } } drag = null; };
  canvas.onwheel = (e) => { e.preventDefault(); view.k = Math.max(.25, Math.min(4, view.k * (e.deltaY < 0 ? 1.1 : 0.9))); };
  new ResizeObserver(resize).observe(canvas);
  tick();
}

/* ---------- Flashcards ---------- */
function cardPool() { const f = S.ui.cardFilter || ''; return [...S.cards.values()].filter((c) => { const n = S.notes.get(c.noteId); return n && !n.deleted && (!f || (n.tags || []).includes(f) || n.folderId === f); }); }
function viewCards(V) {
  const pool = cardPool();
  const due = pool.filter((c) => c.due <= now());
  const fresh = pool.filter((c) => !c.reps && !c.lapses);
  const tagSet = new Set(); [...S.cards.values()].forEach((c) => (S.notes.get(c.noteId)?.tags || []).forEach((t) => tagSet.add(t)));
  const filterSel = `<select class="select" id="fc-filter" style="width:auto" aria-label="Deck"><option value="">All decks</option>${[...tagSet].sort().map((t) => `<option value="${esc(t)}"${S.ui.cardFilter === t ? ' selected' : ''}>#${esc(t)}</option>`).join('')}</select>`;
  let body;
  if (study && study.queue.length && study.idx < study.queue.length) {
    const c = S.cards.get(study.queue[study.idx]);
    const n = S.notes.get(c.noteId);
    body = `<div class="fc-stage">
      <div class="row"><span class="muted small">Card ${study.idx + 1} of ${study.queue.length}</span><button class="btn ghost sm" data-open="${n.id}" style="margin-left:auto">From: ${esc(n.title)}</button><button class="btn ghost sm" data-vact="endstudy">End session</button></div>
      <div class="progress"><i style="width:${(study.idx / study.queue.length) * 100}%"></i></div>
      <div class="fc-card"><div><div class="q">${window.marked ? marked.parseInline(esc(c.front)) : esc(c.front)}</div>${study.shown ? `<div class="a">${window.marked ? marked.parseInline(esc(c.back)) : esc(c.back)}</div>` : ''}</div></div>
      ${study.shown ? `<div class="fc-grades">${['Again', 'Hard', 'Good', 'Easy'].map((g, i) => `<button class="btn${i === 2 ? ' primary' : ''}" data-grade="${i}">${g}<small>${previewInterval(c, i)} · ${i + 1}</small></button>`).join('')}</div>`
        : `<button class="btn primary" data-vact="show" style="justify-self:center;padding:10px 28px">Show answer <kbd style="margin-left:6px">Space</kbd></button>`}
    </div>`;
  } else {
    const done = study && study.idx >= study.queue.length;
    body = `<div class="fc-stage">
      <div class="stat-row"><div class="stat"><b>${due.length}</b><span>Due now</span></div><div class="stat"><b>${fresh.length}</b><span>New</span></div><div class="stat"><b>${pool.length}</b><span>Total cards</span></div></div>
      ${done ? `<div class="note-box">Session complete — ${study.queue.length} card${study.queue.length === 1 ? '' : 's'} reviewed.</div>` : ''}
      ${pool.length ? `<div class="row"><button class="btn primary" data-vact="study" ${due.length ? '' : 'disabled'}>Study ${due.length} due card${due.length === 1 ? '' : 's'}</button><button class="btn" data-vact="cram">Review all ${pool.length}</button></div>`
        : `<div class="empty"><h3>No flashcards yet</h3><p>Write lines like <code>Port for HTTPS :: 443</code> in any note, or use <b>Make cards</b> in the editor toolbar.</p></div>`}
      <p class="muted small">Cards come from lines written as <code>question :: answer</code>. Notes in vaults and templates are left out. Scheduling uses the SM-2 spaced-repetition method.</p>
      ${pool.length ? `<details><summary class="small">Browse all cards</summary><div class="ask-src" style="margin-top:8px">${pool.slice(0, 300).map((c) => `<button data-open="${c.noteId}"><b>${esc(c.front)}</b> → ${esc(c.back)} <span class="muted mono">· ${c.due <= now() ? 'due' : 'next ' + new Date(c.due).toLocaleDateString()}</span></button>`).join('')}</div></details>` : ''}
    </div>`;
  }
  V.innerHTML = viewHead('Flashcards', filterSel) + `<div class="view-body">${body}</div>`;
}
function startStudy(all) {
  const pool = cardPool(); const q = (all ? pool : pool.filter((c) => c.due <= now())).sort((a, b) => a.due - b.due).slice(0, 100);
  for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); if (q[i].due === q[j].due) [q[i], q[j]] = [q[j], q[i]]; }
  study = { queue: q.map((c) => c.id), idx: 0, shown: false }; renderView();
}
async function gradeCard(g) {
  const c = S.cards.get(study.queue[study.idx]); schedule(c, g); await DB.put('cards', c);
  study.idx++; study.shown = false; renderView(); renderRail();
}

/* ---------- Ask my notes ---------- */
function viewAsk(V) {
  const ai = S.settings.ai.provider !== 'none';
  V.innerHTML = viewHead('Ask my notes', `<span class="chip ${ai ? 'good' : ''}">${ai ? `AI: ${esc(S.settings.ai.provider === 'ollama' ? 'Ollama (local)' : 'OpenAI-compatible')} · ${esc(S.settings.ai.model)}` : 'No AI provider — showing best-matching passages'}</span>`) +
    `<div class="view-body"><div class="ask-out">
      <form id="ask-form" class="row"><input class="input grow" id="ask-q" placeholder="e.g. What did we decide about image imports?" value="${esc(askState.q)}" aria-label="Question"><button class="btn primary" type="submit">Ask</button></form>
      ${ai ? '' : `<p class="muted small">Without an AI provider, GSNotes finds the passages most likely to answer your question. Connect a local model (Ollama) or an OpenAI-compatible API in <button class="btn ghost sm" data-vact="settings">Settings</button> for written answers with citations.</p>`}
      <div id="ask-res">${askState.html}</div>
    </div></div>`;
}

/* ---------- Settings ---------- */
function viewSettings(V) {
  const s = S.settings, ai = s.ai, sy = s.sync;
  const fsOk = 'showDirectoryPicker' in window;
  const vaults = [...S.folders.values()].filter((f) => f.vault);
  V.innerHTML = viewHead('Settings &amp; sync') + `<div class="view-body"><div class="settings">
    <section><h3>Appearance</h3>
      <div class="grid2">
        <label class="field">Theme<select class="select" id="st-theme">${[['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<option value="${v}"${s.theme === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Editor opens in<select class="select" id="st-mode">${[['edit', 'Edit'], ['split', 'Split'], ['view', 'View']].map(([v, l]) => `<option value="${v}"${s.editorMode === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div></section>

    <section><h3>Vaults &amp; auto-lock</h3>
      <p>Vault notebooks are encrypted on this device with AES-256-GCM. The key comes from your password (PBKDF2, 310,000 rounds) and is never stored. <b>If you forget a vault password, its notes cannot be recovered.</b></p>
      <div class="grid2"><label class="field">Lock vaults after idle (minutes)<input class="input" type="number" min="1" max="240" id="st-lock" value="${s.autoLockMin}"></label></div>
      <div class="row">${vaults.map((v) => `<span class="chip ${vaultUnlocked(v.id) ? 'good' : ''}">${vaultUnlocked(v.id) ? '◌' : '🔒'} ${esc(v.name)}</span>`).join('') || '<span class="muted small">No vaults yet.</span>'}<button class="btn sm" data-vact="newvault">New vault</button></div></section>

    <section><h3>AI assistant</h3>
      <p>Powers meaning search, Ask my notes, summaries, tag suggestions and card generation. <b>Ollama</b> runs on your own computer, so notes never leave it. An <b>OpenAI-compatible API</b> sends the relevant note text to that provider. Without a provider, GSNotes uses built-in offline methods.</p>
      <div class="grid2">
        <label class="field">Provider<select class="select" id="st-ai">${[['none', 'None (offline methods)'], ['ollama', 'Ollama (local)'], ['openai', 'OpenAI-compatible API']].map(([v, l]) => `<option value="${v}"${ai.provider === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Server URL<input class="input" id="st-ai-url" value="${esc(ai.url)}" placeholder="http://localhost:11434"></label>
        <label class="field">Chat model<input class="input" id="st-ai-model" value="${esc(ai.model)}"></label>
        <label class="field">Embedding model<input class="input" id="st-ai-emb" value="${esc(ai.embedModel)}"></label>
        <label class="field">API key (OpenAI-compatible only)<input class="input" type="password" id="st-ai-key" value="${esc(ai.key)}" autocomplete="off"></label>
      </div>
      <div class="row"><button class="btn" data-vact="testai">Test connection</button><span class="muted small" id="ai-test"></span></div>
      <p class="small muted">${IS_DESKTOP ? 'The desktop app talks to Ollama directly; no extra Ollama settings are needed.' : 'Ollama must allow requests from this app’s address: start it with <code>OLLAMA_ORIGINS=*</code> (or your exact URL).'} The API key is stored on this device only.</p></section>

    <section><h3>Capture</h3>
      <div class="grid2">
        <label class="field">Dictation language<select class="select" id="st-voice">${[['en-US', 'English (US)'], ['es-US', 'Spanish (US)'], ['es-ES', 'Spanish (Spain)'], ['es-MX', 'Spanish (Mexico)'], ['en-GB', 'English (UK)']].map(([v, l]) => `<option value="${v}"${s.voiceLang === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Text recognition (OCR) language<select class="select" id="st-ocr">${[['eng', 'English'], ['spa', 'Spanish'], ['eng+spa', 'English + Spanish']].map(([v, l]) => `<option value="${v}"${s.ocrLang === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <p class="small muted">Dictation uses your browser’s speech service. In Chrome and Edge that service runs on the browser maker’s servers, so audio leaves your device. Text recognition runs on your device after a one-time download of its language data.</p>
      <label class="row"><input type="checkbox" id="st-notify" ${s.remindersOn ? 'checked' : ''}> Show reminder notifications</label>
      <p class="small muted">Reminders fire while GSNotes is open (as a tab or installed app). A web app cannot wake itself when fully closed without a push server.</p></section>

    <section><h3>Sync &amp; backup</h3>
      <p>Your notes live on this device. Sync copies them to a place you control. Choose a sync passphrase to encrypt the sync file end-to-end; vault notes stay encrypted either way.</p>
      <label class="field">Sync passphrase (optional, encrypts the sync file)<input class="input" type="password" id="st-pass" value="${esc(sy.passphrase)}" autocomplete="new-password"></label>
      <h4 style="margin:6px 0 0">Folder sync ${fsOk ? '' : '<span class="chip">Chrome / Edge only</span>'}</h4>
      <p class="small">Pick a folder inside <b>OneDrive</b>, <b>SharePoint</b> (synced library), <b>Dropbox</b> or <b>iCloud Drive</b> and that service’s desktop app carries it to the cloud. GSNotes writes <code>gsnotes-sync.json</code> plus one readable <code>.md</code> file per note.</p>
      <div class="row"><button class="btn" data-vact="pickdir" ${fsOk ? '' : 'disabled'}>Choose folder</button><button class="btn primary" data-vact="syncdir" ${fsOk && sy.dirName ? '' : 'disabled'}>Sync now</button><span class="muted small">${sy.dirName ? 'Folder: ' + esc(sy.dirName) : 'No folder chosen'}</span></div>
      <h4 style="margin:6px 0 0">WebDAV (Nextcloud, ownCloud, Synology, self-hosted)</h4>
      <div class="grid2">
        <label class="field">File URL<input class="input" id="st-dav" value="${esc(sy.webdavUrl)}" placeholder="https://cloud.example.com/remote.php/dav/files/me/gsnotes-sync.json"></label>
        <label class="field">Username<input class="input" id="st-dav-u" value="${esc(sy.webdavUser)}" autocomplete="off"></label>
        <label class="field">App password<input class="input" type="password" id="st-dav-p" value="${esc(sy.webdavPass)}" autocomplete="off"></label>
      </div>
      <div class="row"><button class="btn primary" data-vact="syncdav">Sync with WebDAV</button><span class="muted small">${sy.lastSync ? 'Last sync ' + fmtWhen(sy.lastSync) : 'Never synced'}</span></div>
      ${IS_DESKTOP ? '' : '<p class="small muted">The WebDAV server must allow cross-origin requests (CORS) from this app’s address.</p>'}
      <h4 style="margin:6px 0 0">Backup &amp; import</h4>
      <div class="row">
        <button class="btn" data-vact="backup">Download full backup</button>
        <button class="btn" data-vact="restore">Restore backup</button>
        <button class="btn" data-vact="importmd">Import Markdown files</button>
        <button class="btn" data-vact="importenex">Import Evernote (.enex)</button>
        <button class="btn primary" data-view-go="backup">Open Backup &amp; import</button>
      </div></section>

    <section><h3>App</h3>
      <div class="row">${IS_DESKTOP ? '' : `<button class="btn" data-vact="install" id="install-btn" ${deferredInstall ? '' : 'disabled'}>Install GSNotes</button>`}<span class="muted small" id="storage-est"></span></div>
      <p class="small muted">${IS_DESKTOP ? 'Desktop app ' + esc(window.gsDesktop.version || '') + '. Notes are stored in your user profile. Press Ctrl+Alt+N anywhere for quick capture.' : IN_FRAME ? 'You are viewing a preview. Downloads, dictation, notifications, folder sync and installation work in the installed app.' : 'Installed apps work offline after the first load.'}</p>
      <div class="row"><button class="btn danger" data-vact="wipe">Erase all data on this device</button></div></section>
  </div></div>`;
  navigator.storage?.estimate?.().then((e) => { const el = $('#storage-est'); if (el && e.usage != null) el.textContent = `Using ${(e.usage / 1048576).toFixed(1)} MB of storage`; }).catch(() => {});
}

function viewEvents() {
  const V = $('#view');
  V.addEventListener('click', async (e) => {
    const src = e.target.closest('[data-src]'); if (src) { e.preventDefault(); return openNote(src.dataset.src); }
    if (S.ui.view === 'calendar') {
      const ev = e.target.closest('[data-open]'); if (ev) return openNote(ev.dataset.open);
      const day = e.target.closest('.day');
      if (day && !e.target.closest('button')) return createNote({ isTodo: true, status: 'todo', due: day.dataset.day, title: '' });
    }
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.open) return openNote(b.dataset.open);
    if (b.dataset.move) return moveTask(b.dataset.move, b.dataset.to);
    if (b.dataset.grade) return gradeCard(+b.dataset.grade);
    if (b.dataset.viewGo) return go(b.dataset.viewGo);
    const s = S.settings;
    switch (b.dataset.vact) {
      case 'rail': return setPane('rail');
      case 'newtask': return createNote({ isTodo: true, status: 'todo' });
      case 'calprev': calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); return renderView();
      case 'calnext': calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); return renderView();
      case 'caltoday': { const d = new Date(); calMonth = new Date(d.getFullYear(), d.getMonth(), 1); return renderView(); }
      case 'study': return startStudy(false);
      case 'cram': return startStudy(true);
      case 'show': study.shown = true; return renderView();
      case 'endstudy': study = null; return renderView();
      case 'settings': return go('settings');
      case 'newvault': return vaultDialog();
      case 'testai': return testAI();
      case 'pickdir': return pickSyncDir();
      case 'syncdir': return syncFolder();
      case 'syncdav': return syncWebDAV();
      case 'backup': return backupNow();
      case 'restore': return restoreFlow();
      case 'importmd': return importMarkdown();
      case 'importenex': return importEnex();
      case 'install': if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } return;
      case 'wipe': return confirmDialog('Erase everything?', 'This deletes every note, notebook, vault, flashcard and setting stored on this device. Make a backup first if you might need them.', 'Erase all data', wipeAll);
    }
  });
  V.addEventListener('change', async (e) => {
    const s = S.settings, id = e.target.id, val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (id === 'g-tags') { S.ui.graphTags = val; return renderView(); }
    if (id === 'g-orph') { S.ui.graphOrphans = val; return renderView(); }
    if (id === 'fc-filter') { S.ui.cardFilter = val; study = null; return renderView(); }
    const map = { 'st-theme': () => { s.theme = val; applyTheme(); }, 'st-mode': () => { s.editorMode = val; S.ui.mode = val; }, 'st-lock': () => { s.autoLockMin = Math.max(1, Math.min(240, +val || 5)); },
      'st-ai': () => { s.ai.provider = val; if (val === 'openai' && s.ai.url.includes('11434')) { s.ai.url = 'https://api.openai.com/v1'; s.ai.model = 'gpt-4o-mini'; s.ai.embedModel = 'text-embedding-3-small'; } if (val === 'ollama' && !s.ai.url.includes('11434')) { s.ai.url = 'http://localhost:11434'; s.ai.model = 'llama3.2'; s.ai.embedModel = 'nomic-embed-text'; } embCache.clear(); },
      'st-ai-url': () => { s.ai.url = val.replace(/\/+$/, ''); embCache.clear(); }, 'st-ai-model': () => { s.ai.model = val; }, 'st-ai-emb': () => { s.ai.embedModel = val; embCache.clear(); }, 'st-ai-key': () => { s.ai.key = val; },
      'st-voice': () => { s.voiceLang = val; }, 'st-ocr': () => { s.ocrLang = val; }, 'st-notify': () => { s.remindersOn = val; if (val) ensureNotifyPermission(); },
      'st-pass': () => { s.sync.passphrase = val; }, 'st-dav': () => { s.sync.webdavUrl = val.trim(); }, 'st-dav-u': () => { s.sync.webdavUser = val; }, 'st-dav-p': () => { s.sync.webdavPass = val; } };
    if (map[id]) { map[id](); await saveSettings(); if (id === 'st-ai') renderView(); toast('Settings saved'); }
  });
  V.addEventListener('submit', async (e) => {
    if (e.target.id !== 'ask-form') return;
    e.preventDefault(); askState.q = $('#ask-q').value.trim(); if (!askState.q) return;
    $('#ask-res').innerHTML = '<p class="muted">Searching your notes…</p>';
    try { askState.html = await askNotes(askState.q); } catch (err) { askState.html = `<div class="note-box">${esc(err.message)}</div>`; }
    if (S.ui.view === 'ask') $('#ask-res').innerHTML = askState.html;
  });
  V.addEventListener('dragstart', (e) => { const c = e.target.closest('.kcard'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; } });
  V.addEventListener('dragover', (e) => { const col = e.target.closest('.col'); if (col) { e.preventDefault(); $$('.col').forEach((x) => x.classList.toggle('drop', x === col)); } });
  V.addEventListener('dragleave', (e) => { if (!e.relatedTarget?.closest?.('.col')) $$('.col').forEach((x) => x.classList.remove('drop')); });
  V.addEventListener('drop', (e) => { const col = e.target.closest('.col'); if (!col) return; e.preventDefault(); $$('.col').forEach((x) => x.classList.remove('drop')); moveTask(e.dataTransfer.getData('text/plain'), col.dataset.col); });
  V.addEventListener('click', (e) => { const c = e.target.closest('.kcard'); if (c && !e.target.closest('button')) openNote(c.dataset.id); });
}
