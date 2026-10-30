// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
'use strict';
/* ============================================================
   GSNotes — core utilities, storage (IndexedDB), crypto
   ============================================================ */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 20) : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const now = () => Date.now();
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const hm = (d = new Date()) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const IN_FRAME = (() => { try { return window.self !== window.top; } catch { return true; } })();
const IS_DESKTOP = !!window.gsDesktop;
/* fetch that avoids browser CORS limits in the desktop app (requests go through the main process) */
async function httpFetch(url, opts = {}) {
  if (window.gsDesktop?.http) {
    const r = await window.gsDesktop.http({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body ?? null });
    if (r.error) throw new TypeError('Failed to fetch');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body, json: async () => JSON.parse(r.body) };
  }
  return fetch(url, opts);
}

function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts), n = new Date();
  if (ymd(d) === ymd(n)) return hm(d);
  const diff = (n - d) / 864e5;
  if (diff < 6) return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + hm(d);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
}

function toast(msg, isErr = false, ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

async function download(name, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  if (IN_FRAME && window.claude?.use) { // claude.ai preview: downloads go through the viewer's save prompt
    try {
      const dl = await window.claude.use('downloads');
      if (dl) { await dl.save({ filename: name, data: blob }); return true; }
    } catch (e) {
      if (e?.code === 'declined') return false;
      if (e?.code === 'rejected_extension') { toast('This preview can’t save that file type. Use the installed app.', true, 5000); return false; }
    }
    toast('Saving files is not available in this preview. Use the installed app.', true, 5000); return false;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function pickFiles(accept, multiple = true) {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.onchange = () => res([...i.files]);
    i.click();
  });
}
const readText = (f) => f.text();
const readDataURL = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

function loadScript(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = () => res(globalName ? window[globalName] : true);
    s.onerror = () => rej(new Error('Could not load ' + src.split('/').slice(-2).join('/') + '. Check your connection.'));
    document.head.appendChild(s);
  });
}

/* ---------- IndexedDB wrapper with in-memory fallback ---------- */
const DB = (() => {
  const STORES = ['notes', 'folders', 'versions', 'cards', 'resources', 'meta', 'projects'];
  let db = null, mem = null;
  function open() {
    return new Promise((res) => {
      try {
        const req = indexedDB.open('gsnotes', 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        };
        req.onsuccess = () => { db = req.result; res(true); };
        req.onerror = () => { mem = Object.fromEntries(STORES.map((s) => [s, new Map()])); res(false); };
        setTimeout(() => { if (!db && !mem) { mem = Object.fromEntries(STORES.map((s) => [s, new Map()])); res(false); } }, 2500);
      } catch { mem = Object.fromEntries(STORES.map((s) => [s, new Map()])); res(false); }
    });
  }
  const tx = (store, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(store, mode); const st = t.objectStore(store);
    const r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
  });
  return {
    open,
    get persistent() { return !!db; },
    async all(store) { if (mem) return [...mem[store].values()]; return tx(store, 'readonly', (s) => s.getAll()); },
    async put(store, obj) { if (mem) { mem[store].set(obj.id, structuredClone(obj)); return; } return tx(store, 'readwrite', (s) => s.put(obj)); },
    async putMany(store, arr) { if (mem) { arr.forEach((o) => mem[store].set(o.id, structuredClone(o))); return; } return tx(store, 'readwrite', (s) => { arr.forEach((o) => s.put(o)); }); },
    async del(store, id) { if (mem) { mem[store].delete(id); return; } return tx(store, 'readwrite', (s) => s.delete(id)); },
    async get(store, id) { if (mem) return mem[store].get(id); return tx(store, 'readonly', (s) => s.get(id)); },
    async clear(store) { if (mem) { mem[store].clear(); return; } return tx(store, 'readwrite', (s) => s.clear()); },
  };
})();

/* ---------- Crypto: PBKDF2-SHA256 → AES-256-GCM ---------- */
const Crypt = {
  ITER: 310000,
  b64(buf) { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); },
  unb64(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
  async deriveKey(password, saltB64, iter = this.ITER) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: this.unb64(saltB64), iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  newSalt() { return this.b64(crypto.getRandomValues(new Uint8Array(16))); },
  async enc(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { iv: this.b64(iv), ct: this.b64(ct) };
  },
  async dec(key, box) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: this.unb64(box.iv) }, key, this.unb64(box.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  },
  async sha(text) { const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return this.b64(h).slice(0, 16); },
};

/* ---------- text helpers: tokenizing, BM25, extractive summary, keywords ---------- */
const STOP = new Set('a an and are as at be but by for from has have he her his i if in into is it its me my no not of on or our she so than that the their them then there these they this to was we were what when which who will with you your de la el en y los las un una que por con para del al lo se es su'.split(' '));
const tokens = (s) => (s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9][a-z0-9+#.'-]*[a-z0-9+#]|[a-z0-9]/g) || []).filter((w) => !STOP.has(w));
function stripMd(s) {
  return String(s || '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/<\/?(details|summary)>/g, ' ').replace(/^\s*([-*+]|\d+\.)\s+(\[[ xX]\]\s*)?/gm, '').replace(/[#>*_`~|]+/g, ' ').replace(/(^|\s)-{2,}(\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
}
function bm25(docs, query) {
  // docs: [{id, text}] → [{id, score}]
  const q = [...new Set(tokens(query))]; if (!q.length) return [];
  const toks = docs.map((d) => tokens(d.text));
  const N = docs.length, avg = toks.reduce((a, t) => a + t.length, 0) / Math.max(1, N);
  const df = {}; for (const t of toks) for (const w of new Set(t)) df[w] = (df[w] || 0) + 1;
  const k1 = 1.4, b = 0.75;
  return docs.map((d, i) => {
    const tf = {}; for (const w of toks[i]) tf[w] = (tf[w] || 0) + 1;
    let score = 0;
    for (const w of q) {
      // prefix match so "encrypt" finds "encryption"
      let f = tf[w] || 0, dfw = df[w] || 0;
      if (!f && w.length > 3) for (const k in tf) if (k.startsWith(w)) { f += tf[k] * 0.7; dfw = Math.max(dfw, df[k]); }
      if (!f) continue;
      const idf = Math.log(1 + (N - dfw + 0.5) / (dfw + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * toks[i].length / (avg || 1)));
    }
    return { id: d.id, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
}
function sentences(text) { return stripMd(text).split(/(?<=[.!?])\s+(?=[A-Z0-9¿¡])/).map((s) => s.trim()).filter((s) => s.length > 20); }
function extractiveSummary(text, n = 3) {
  const ss = sentences(text); if (ss.length <= n) return ss;
  const freq = {}; for (const w of tokens(text)) freq[w] = (freq[w] || 0) + 1;
  const scored = ss.map((s, i) => ({ s, i, v: tokens(s).reduce((a, w) => a + (freq[w] || 0), 0) / Math.sqrt(tokens(s).length + 1) }));
  return scored.sort((a, b) => b.v - a.v).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s);
}
function keywords(text, allTexts, n = 6) {
  const tf = {}; for (const w of tokens(stripMd(text))) if (w.length > 2 && !/^\d+$/.test(w)) tf[w] = (tf[w] || 0) + 1;
  const N = allTexts.length || 1; const df = {};
  for (const t of allTexts) for (const w of new Set(tokens(t))) df[w] = (df[w] || 0) + 1;
  return Object.entries(tf).map(([w, f]) => [w, f * Math.log(1 + N / (df[w] || 1))]).sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
}
function chunk(text, size = 700) {
  const paras = String(text).split(/\n{2,}/); const out = []; let cur = '';
  for (const p of paras) { if ((cur + '\n\n' + p).length > size && cur) { out.push(cur); cur = p; } else cur = cur ? cur + '\n\n' + p : p; }
  if (cur) out.push(cur); return out;
}
/* line diff (LCS) */
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n'); const n = A.length, m = B.length;
  if (n * m > 4e6) return [{ t: 'del', s: '(note too large to diff — showing new version)' }, ...B.map((s) => ({ t: 'add', s }))];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { out.push({ t: 'eq', s: A[i] }); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: 'del', s: A[i++] }); else out.push({ t: 'add', s: B[j++] }); }
  while (i < n) out.push({ t: 'del', s: A[i++] }); while (j < m) out.push({ t: 'add', s: B[j++] });
  return out;
}
