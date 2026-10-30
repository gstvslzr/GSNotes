// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
/* ============================================================
   Markdown rendering, wiki links, flashcard parsing
   ============================================================ */
const WL_RE = /\[\[([^\[\]|\n`]+)(?:\|([^\]\n]+))?\]\]/g;
const CARD_RE = /^(?!\s*[-*>#|])(.+?)\s::\s(.+)$/;

function noteByTitle(title) {
  const t = title.trim().toLowerCase();
  let best = null;
  for (const n of S.notes.values()) if (!n.deleted && !n.locked && n.title.trim().toLowerCase() === t) { if (!best || n.updatedAt > best.updatedAt) best = n; }
  return best;
}
const noCode = (s) => String(s || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
function outLinks(n) { const out = new Set(); for (const m of noCode(n.body).matchAll(WL_RE)) out.add(m[1].trim().toLowerCase()); return [...out]; }
function backlinks(n) {
  if (!n.title) return [];
  const t = n.title.trim().toLowerCase();
  return [...S.notes.values()].filter((x) => x.id !== n.id && !x.deleted && !x.locked && outLinks(x).includes(t));
}

let mdReady = false;
function setupMarked() {
  if (mdReady || !window.marked) return;
  mdReady = true;
  marked.use({
    gfm: true, breaks: false,
    extensions: [
      {
        name: 'wikilink', level: 'inline',
        start(src) { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const m = /^\[\[([^\[\]|\n`]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
          if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), alias: (m[2] || m[1]).trim() };
        },
        renderer(t) { const ex = !!noteByTitle(t.target); return `<a href="#" class="wl${ex ? '' : ' missing'}" data-wl="${esc(t.target)}" title="${ex ? 'Open' : 'Create'} “${esc(t.target)}”">${esc(t.alias)}</a>`; },
      },
      {
        name: 'card', level: 'block',
        start(src) { const m = src.match(/^[^\n]+? :: [^\n]+/m); return m ? m.index : undefined; },
        tokenizer(src) {
          const m = /^([^\n]+?) :: ([^\n]+)(?:\n|$)/.exec(src);
          if (m && !/^\s*([-*>#|]|```)/.test(m[1]) && / :: /.test(m[0].replace(/`[^`\n]*`/g, ''))) return { type: 'card', raw: m[0], front: m[1].trim(), back: m[2].trim() };
        },
        renderer(t) { return `<div class="card-line"><b>${marked.parseInline(esc(t.front))}</b><span class="muted">→</span><span>${marked.parseInline(esc(t.back))}</span></div>`; },
      },
    ],
    renderer: {
      link(href, title, text) {
        if ((href || '').startsWith('gsres://')) return `<a href="#" class="res-link" data-res="${esc(href.slice(8))}">📎 ${text}</a>`;
        return false;
      },
      image(href, title, text) {
        let src = href || '';
        if (src.startsWith('gsres://')) { const r = S.resources.get(src.slice(8)); src = r ? r.data : ''; if (!r) return `<span class="chip">missing attachment</span>`; }
        return `<img src="${esc(src)}" alt="${esc(text || '')}"${title ? ` title="${esc(title)}"` : ''}>`;
      },
    },
  });
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href') && !node.classList.contains('wl')) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
  });
}

function renderMd(md) {
  if (!window.marked || !window.DOMPurify) return `<pre>${esc(md)}</pre><p class="muted small">Markdown preview needs the marked and DOMPurify libraries, which load from the internet the first time. Reconnect once and they will be cached.</p>`;
  setupMarked();
  let html = marked.parse(md || '');
  // make task checkboxes clickable (index matches source order)
  let i = 0;
  html = html.replace(/<input (?:checked="" )?disabled="" type="checkbox"( checked="")?>|<input (checked="" )?disabled="" type="checkbox">/g, (m) => `<input type="checkbox" data-task="${i++}"${/checked/.test(m) ? ' checked' : ''}>`);
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-wl', 'data-task', 'data-res', 'target'], ADD_DATA_URI_TAGS: ['img'] });
}

function toggleTaskInSource(body, idx) {
  let i = -1;
  return body.replace(/^(\s*[-*+] \[)( |x|X)(\])/gm, (m, a, c, b) => { i++; return i === idx ? a + (c === ' ' ? 'x' : ' ') + b : m; });
}

function parseCards(body) {
  const out = []; let inFence = false;
  for (const line of String(body || '').split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = CARD_RE.exec(line);
    if (m && / :: /.test(line.replace(/`[^`\n]*`/g, ''))) out.push({ front: m[1].trim(), back: m[2].trim() });
  }
  return out;
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

async function syncCardsFor(n) {
  const existing = [...S.cards.values()].filter((c) => c.noteId === n.id);
  const eligible = !n.deleted && !n.locked && !isVaultFolder(n.folderId) && n.folderId !== S.settings.templateFolder;
  const want = eligible ? parseCards(n.body) : [];
  const ids = new Set();
  const puts = [];
  for (const w of want) {
    const id = n.id + ':' + hashStr(w.front.toLowerCase());
    ids.add(id);
    const c = S.cards.get(id);
    if (!c) { const nc = { id, noteId: n.id, front: w.front, back: w.back, ef: 2.5, interval: 0, reps: 0, lapses: 0, due: 0 }; S.cards.set(id, nc); puts.push(nc); }
    else if (c.back !== w.back || c.front !== w.front) { c.back = w.back; c.front = w.front; puts.push(c); }
  }
  for (const c of existing) if (!ids.has(c.id)) { S.cards.delete(c.id); await DB.del('cards', c.id); }
  if (puts.length) await DB.putMany('cards', puts);
}

/* SM-2 spaced repetition. grade: 0 again, 1 hard, 2 good, 3 easy */
function schedule(card, grade) {
  const q = [1, 3, 4, 5][grade];
  if (q < 3) { card.reps = 0; card.interval = 0; card.lapses = (card.lapses || 0) + 1; card.due = now() + 10 * 60 * 1000; }
  else {
    card.reps += 1;
    card.interval = card.reps === 1 ? 1 : card.reps === 2 ? (grade === 3 ? 4 : 3) : Math.round(card.interval * card.ef * (grade === 1 ? 0.8 : grade === 3 ? 1.3 : 1));
    card.due = now() + card.interval * 864e5;
  }
  card.ef = Math.max(1.3, card.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  return card;
}
function previewInterval(card, grade) { const c = schedule(structuredClone(card), grade); return c.interval ? `${c.interval}d` : '10m'; }

/* HTML → Markdown (for Evernote import and pasted HTML) */
function htmlToMd(html, opts = {}) {
  const doc = typeof html === 'string' ? new DOMParser().parseFromString(html, 'text/html') : html;
  const walk = (node, ctx = {}) => {
    if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    const kids = () => [...node.childNodes].map((c) => walk(c, ctx)).join('');
    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': return `\n\n${'#'.repeat(+tag[1])} ${kids().trim()}\n\n`;
      case 'p': return `\n\n${kids().trim()}\n\n`;
      case 'div': return `\n${kids().trim()}\n`;
      case 'br': return '  \n';
      case 'b': case 'strong': { const k = kids().trim(); return k ? `**${k}**` : ''; }
      case 'i': case 'em': { const k = kids().trim(); return k ? `*${k}*` : ''; }
      case 'code': return '`' + node.textContent + '`';
      case 'pre': return '\n```\n' + node.textContent + '\n```\n';
      case 'a': { const href = opts.link ? opts.link(node.getAttribute('href') || '', node) : node.getAttribute('href') || ''; const k = kids().trim(); if (!href) return k; if (href.startsWith('[[')) return href; return `[${k || href}](${href})`; }
      case 'img': { const src = opts.img ? opts.img(node.getAttribute('src') || '', node) : node.getAttribute('src') || ''; return src ? `![${node.getAttribute('alt') || ''}](${src})` : ''; }
      case 'en-todo': return '\n- ' + (node.getAttribute('checked') === 'true' ? '[x] ' : '[ ] ') + kids();
      case 'ul': case 'ol': return '\n' + [...node.children].map((li, i) => (tag === 'ol' ? `${i + 1}. ` : '- ') + walk(li, ctx).trim()).join('\n') + '\n';
      case 'blockquote': return '\n' + kids().trim().split('\n').map((l) => '> ' + l).join('\n') + '\n';
      case 'hr': return '\n---\n';
      case 'table': return '\n\n' + [...node.querySelectorAll('tr')].map((tr, i) => { const cells = [...tr.children].map((c) => c.textContent.trim().replace(/\|/g, '\\|')); return '| ' + cells.join(' | ') + ' |' + (i === 0 ? '\n|' + cells.map(() => ' --- ').join('|') + '|' : ''); }).join('\n') + '\n\n';
      case 'en-media': return '\n*(attachment not imported)*\n';
      case 'style': case 'script': case 'head': case 'title': case 'meta': return '';
      case 'h5': case 'h6': return `\n\n#### ${kids().trim()}\n\n`;
      case 'u': return kids();
      case 's': case 'strike': case 'del': { const k = kids().trim(); return k ? `~~${k}~~` : ''; }
      case 'input': return node.getAttribute('type') === 'checkbox' ? (node.hasAttribute('checked') ? '[x] ' : '[ ] ') : '';
      default: return kids();
    }
  };
  return walk(doc.body).replace(/\n{3,}/g, '\n\n').trim();
}
