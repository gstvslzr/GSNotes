// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
/* ============================================================
   Backup & restore page, automatic backups, and importers
   (Joplin .jex, Markdown folders, OneNote, HTML/MHT, Word)
   ============================================================ */

/* ---------- small binary helpers: tar reader, zip writer ---------- */
function readTar(buf) {
  const u8 = new Uint8Array(buf); const out = []; const dec = new TextDecoder();
  const str = (o, n) => { let e = o; while (e < o + n && u8[e]) e++; return dec.decode(u8.subarray(o, e)); };
  let off = 0, longName = null;
  while (off + 512 <= u8.length) {
    if (u8.subarray(off, off + 512).every((b) => b === 0)) break;
    let name = str(off, 100); const size = parseInt(str(off + 124, 12).trim() || '0', 8) || 0; const type = String.fromCharCode(u8[off + 156] || 48);
    const prefix = str(off + 345, 155); if (prefix) name = prefix + '/' + name;
    const dataStart = off + 512; const data = u8.subarray(dataStart, dataStart + size);
    if (type === 'L') longName = dec.decode(data).replace(/\0+$/, '');
    else if (type === 'x' || type === 'g') { const m = /\d+ path=([^\n]+)\n/.exec(dec.decode(data)); if (m && type === 'x') longName = m[1]; }
    else { if (longName) { name = longName; longName = null; } if (type === '0' || type === '\0' || type === '7') out.push({ name: name.replace(/^\.\//, ''), data }); }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function makeZip(files) { // files: [{name, data: Uint8Array|string}] — stored (no compression), UTF-8 names
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  const d = new Date(); const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1); const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name); const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data; const crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
const u8ToDataUrl = (u8, mime) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(new Blob([u8], { type: mime })); });
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', html: 'text/html', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav', m4a: 'audio/mp4' };
const extOf = (n) => (/\.([a-z0-9]+)$/i.exec(n || '') || [])[1]?.toLowerCase() || '';
const mimeOf = (n) => MIME_BY_EXT[extOf(n)] || 'application/octet-stream';

/* ---------- notebook path helper for importers ---------- */
async function ensureFolderPath(segments) {
  let parent = null;
  for (const raw of segments) {
    const name = String(raw || '').trim() || 'Untitled';
    let f = [...S.folders.values()].find((x) => !x.vault && (x.parentId || null) === parent && x.name === name);
    if (!f) { f = { id: uid(), name, parentId: parent, createdAt: now() }; S.folders.set(f.id, f); await DB.put('folders', f); }
    parent = f.id;
  }
  return parent;
}
/* Create a note from HTML, storing images/attachments as resources. resolve(src) → {name, mime, data(dataURL)} | null */
async function noteFromHtml(htmlOrDoc, { title, folderId, created, updated, tags = [], resolve = () => null }) {
  const doc = typeof htmlOrDoc === 'string' ? new DOMParser().parseFromString(htmlOrDoc, 'text/html') : htmlOrDoc;
  const n = newNote({ folderId, title: title || doc.querySelector('title')?.textContent?.trim() || 'Untitled', tags });
  for (const svg of [...doc.querySelectorAll('svg')]) { // ink drawings → SVG image attachments
    const img = doc.createElement('img'); img.setAttribute('alt', 'drawing');
    img.setAttribute('src', 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(svg))))); svg.replaceWith(img);
  }
  const pending = []; let idx = 0;
  const md = htmlToMd(doc, {
    img: (src) => { const key = `__GSIMG${idx++}__`; pending.push({ key, src, kind: 'img' }); return key; },
    link: (href, a) => { if (/^onenote:/i.test(href)) { const t = a.textContent.trim(); return t ? `[[${t}]]` : ''; } if (!href || /^(https?:|mailto:|#)/i.test(href)) return href; const key = `__GSLNK${idx++}__`; pending.push({ key, src: href, kind: 'link', text: a.textContent.trim() }); return key; },
  });
  let body = md;
  for (const p of pending) {
    let r = null;
    if (p.src.startsWith('data:')) { const m = /^data:([^;,]+)/.exec(p.src); r = { name: (p.kind === 'img' ? 'image.' : 'file.') + ((m && m[1].split('/')[1]) || 'bin').replace('svg+xml', 'svg'), mime: m ? m[1] : 'application/octet-stream', data: p.src }; }
    else r = await resolve(p.src);
    if (r) { const res = await addResource(n.id, r.name, r.mime, r.data); body = body.replace(p.key, `gsres://${res.id}`); }
    else if (p.kind === 'img' && !/^https?:/i.test(p.src)) body = body.replace(new RegExp(`!\\[[^\\]]*\\]\\(${p.key}\\)`), '');
    else body = body.replace(p.key, p.src);
  }
  n.body = body.replace(/\[([^\]]*)\]\(gsres:\/\/([a-z0-9]+)\)/g, (m, t, id) => { const r = S.resources.get(id); return r && !r.mime.startsWith('image/') ? `[${t || r.name}](gsres://${id})` : m; });
  if (created) n.createdAt = created; n.updatedAt = updated || created || n.updatedAt;
  S.notes.set(n.id, n); await persistNote(n); syncCardsFor(n);
  return n;
}

/* ---------- import progress dialog ---------- */
function progressDialog(title) {
  const d = openDialog(`${dlgHead(esc(title))}<div class="dialog-b"><div class="progress"><i id="ip-bar"></i></div><p class="small" id="ip-msg" style="margin:0">Starting…</p></div><div class="dialog-f"><button class="btn" data-close id="ip-close" disabled>Close</button></div>`);
  return {
    set(frac, msg) { const b = $('#ip-bar', d.el); if (b) b.style.width = Math.round(frac * 100) + '%'; if (msg) $('#ip-msg', d.el).textContent = msg; },
    done(html) { this.set(1); $('#ip-msg', d.el).innerHTML = html; $('#ip-close', d.el).disabled = false; $('#ip-close', d.el).focus(); },
    close: d.close,
  };
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------- Joplin .jex ---------- */
function joplinUnserialize(text) {
  const lines = text.split('\n'); const props = {}; let i = lines.length - 1;
  for (; i >= 0; i--) { const line = lines[i].trim(); if (line === '') break; const p = line.indexOf(':'); if (p < 0) return null; props[line.slice(0, p).trim()] = line.slice(p + 1).trim(); }
  if (!props.type_) return null;
  for (const k in props) if (k !== 'body') props[k] = props[k].replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  const bodyLines = lines.slice(0, Math.max(0, i));
  props.title = bodyLines[0] ?? '';
  props.body = bodyLines.slice(2).join('\n');
  props.type_ = +props.type_;
  return props;
}
const jTime = (s) => { const t = Date.parse(s || ''); return isNaN(t) ? 0 : t; };
async function importJex(file) {
  const pd = progressDialog('Import from Joplin');
  try {
    const entries = readTar(await file.arrayBuffer()); const dec = new TextDecoder();
    const items = []; const resFiles = new Map();
    for (const e of entries) {
      const base = e.name.split('/').pop();
      if (/(^|\/)resources\//.test(e.name)) { resFiles.set(base.replace(/\.[^.]*$/, ''), e.data); continue; }
      if (!base.endsWith('.md')) continue;
      const it = joplinUnserialize(dec.decode(e.data)); if (it) items.push(it);
    }
    if (!items.length) throw new Error('No Joplin items found. Make sure the file is a Joplin Export File (.jex).');
    const encrypted = items.filter((x) => +x.encryption_applied === 1).length;
    const ok = items.filter((x) => +x.encryption_applied !== 1);
    const folders = new Map(ok.filter((x) => x.type_ === 2).map((x) => [x.id, x]));
    const notes = ok.filter((x) => x.type_ === 1); const resources = new Map(ok.filter((x) => x.type_ === 4).map((x) => [x.id, x]));
    const tags = new Map(ok.filter((x) => x.type_ === 5).map((x) => [x.id, x.title])); const noteTags = {};
    for (const nt of ok.filter((x) => x.type_ === 6)) if (tags.has(nt.tag_id)) (noteTags[nt.note_id] ||= []).push(tags.get(nt.tag_id).toLowerCase().replace(/\s+/g, '-'));
    const pathOf = (fid, guard = 0) => { const f = folders.get(fid); if (!f || guard > 30) return []; return [...pathOf(f.parent_id, guard + 1), f.title || 'Untitled']; };
    const folderIdCache = new Map();
    const target = async (fid) => { if (!folderIdCache.has(fid)) folderIdCache.set(fid, await ensureFolderPath(pathOf(fid).length ? pathOf(fid) : ['Joplin import'])); return folderIdCache.get(fid); };
    for (const f of folders.values()) await target(f.id); // keep empty notebooks too
    const titleById = new Map(notes.map((n) => [n.id, n.title || 'Untitled']));
    let done = 0, missingRes = 0;
    for (const j of notes) {
      const n = newNote({ folderId: await target(j.parent_id), title: j.title || 'Untitled', tags: noteTags[j.id] || [] });
      let body = j.body || '';
      if (+j.markup_language === 2) body = htmlToMd(body);
      const ids = [...new Set([...body.matchAll(/:\/([a-f0-9]{32})/g)].map((m) => m[1]))];
      for (const rid of ids) {
        if (titleById.has(rid)) { body = body.replace(new RegExp(`\\[([^\\]]*)\\]\\(:\\/${rid}(?:#[^)]*)?\\)`, 'g'), (m, t) => { const ti = titleById.get(rid); return t && t !== ti ? `[[${ti}|${t}]]` : `[[${ti}]]`; }); continue; }
        const meta = resources.get(rid); const data = resFiles.get(rid);
        if (!data) { missingRes++; continue; }
        const name = (meta?.title || rid) + (meta?.title && extOf(meta.title) ? '' : meta?.file_extension ? '.' + meta.file_extension : '');
        const mime = meta?.mime || mimeOf(name);
        const r = await addResource(n.id, name, mime, await u8ToDataUrl(data, mime));
        body = body.replace(new RegExp(`(!?)\\[([^\\]]*)\\]\\(:\\/${rid}\\)`, 'g'), (m, bang, t) => bang ? `![${t}](gsres://${r.id})` : `[${t || name}](gsres://${r.id})`)
          .replace(new RegExp(`<img([^>]*?)src=["']:\\/${rid}["']([^>]*)>`, 'g'), `![${name}](gsres://${r.id})`);
      }
      n.body = body;
      if (+j.is_todo === 1) { n.isTodo = true; n.done = +j.todo_completed > 0; n.status = n.done ? 'done' : 'todo'; if (+j.todo_due > 0) n.due = ymd(new Date(+j.todo_due)); }
      n.createdAt = jTime(j.user_created_time || j.created_time) || n.createdAt; n.updatedAt = jTime(j.user_updated_time || j.updated_time) || n.createdAt;
      S.notes.set(n.id, n); await persistNote(n); syncCardsFor(n);
      if (++done % 10 === 0) pd.set(done / notes.length, `Imported ${done} of ${notes.length} notes…`);
    }
    render();
    pd.done(`Imported <b>${plural(done, 'note')}</b> into ${plural(folders.size, 'notebook')}${tags.size ? `, with ${plural(tags.size, 'tag')}` : ''}.` +
      (encrypted ? `<br><span style="color:var(--bad)">${plural(encrypted, 'item')} ${encrypted === 1 ? 'was' : 'were'} encrypted with Joplin’s end-to-end encryption and ${encrypted === 1 ? 'was' : 'were'} skipped. Disable encryption in Joplin (or export from a decrypted device), then export again.</span>` : '') +
      (missingRes ? `<br>${plural(missingRes, 'attachment')} referenced in notes were not in the export.` : ''));
  } catch (e) { pd.done(`<span style="color:var(--bad)">${esc(e.message)}</span>`); }
}

/* ---------- Markdown folder (Joplin / Obsidian / any) ---------- */
function pickFolder() {
  return new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.webkitdirectory = true; i.multiple = true; i.onchange = () => res([...i.files]); i.click(); });
}
const normPath = (p) => { const out = []; for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return out.join('/'); };
async function importMdFolder(filesArg) {
  const files = filesArg || await pickFolder(); if (!files.length) return;
  const pd = progressDialog('Import a folder of Markdown files');
  try {
    const byPath = new Map(files.map((f) => [f.webkitRelativePath || f.name, f]));
    const mds = files.filter((f) => /\.(md|markdown|txt)$/i.test(f.name) && !/(^|\/)\.(obsidian|trash|git)\//.test(f.webkitRelativePath || ''));
    if (!mds.length) throw new Error('No Markdown (.md) files in that folder.');
    const rootName = (files[0].webkitRelativePath || '').split('/')[0] || 'Imported';
    const titleOfPath = new Map(); const parsed = [];
    for (const f of mds) {
      const rel = f.webkitRelativePath || f.name; const { meta, body } = parseFrontMatter(await f.text());
      let title = meta.title || f.name.replace(/\.(md|markdown|txt)$/i, ''); let b = body;
      const h1 = /^\s*#\s+(.+)\n/.exec(b); if (h1 && h1[1].trim() === title.trim()) b = b.slice(h1[0].length);
      titleOfPath.set(rel, title); parsed.push({ f, rel, meta, title, body: b });
    }
    let done = 0, attached = 0;
    for (const p of parsed) {
      const segs = p.rel.split('/'); segs.pop();
      const folderId = await ensureFolderPath(segs.length ? segs : [rootName]);
      const n = newNote({ folderId, title: p.title, tags: (Array.isArray(p.meta.tags) ? p.meta.tags : typeof p.meta.tags === 'string' ? p.meta.tags.split(/[,\s]+/) : []).filter(Boolean).map((t) => String(t).toLowerCase()) });
      const dir = segs.join('/');
      let body = p.body;
      const links = [...body.matchAll(/(!?)\[([^\]]*)\]\(<?([^)>\s]+)>?(?:\s+"[^"]*")?\)/g)];
      for (const m of links) {
        const [all, bang, text, hrefRaw] = m; if (/^(https?:|mailto:|#|gsres:)/i.test(hrefRaw)) continue;
        let href; try { href = decodeURIComponent(hrefRaw.split('#')[0]); } catch { href = hrefRaw.split('#')[0]; }
        const target = normPath((dir ? dir + '/' : '') + href);
        if (titleOfPath.has(target)) { const t = titleOfPath.get(target); body = body.replace(all, text && text !== t ? `[[${t}|${text}]]` : `[[${t}]]`); continue; }
        const file = byPath.get(target); if (!file) continue;
        const r = await addResource(n.id, file.name, file.type || mimeOf(file.name), await readDataURL(file)); attached++;
        body = body.replace(all, bang ? `![${text}](gsres://${r.id})` : `[${text || file.name}](gsres://${r.id})`);
      }
      for (const m of [...body.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)]) { // Obsidian embeds ![[image.png]]
        const name = m[1].trim(); const file = files.find((x) => x.name === name || (x.webkitRelativePath || '').endsWith('/' + name)); if (!file) continue;
        const r = await addResource(n.id, file.name, file.type || mimeOf(file.name), await readDataURL(file)); attached++;
        body = body.replace(m[0], `![${file.name}](gsres://${r.id})`);
      }
      n.body = body.trim();
      if (p.meta.created && !isNaN(Date.parse(p.meta.created))) n.createdAt = Date.parse(p.meta.created);
      n.updatedAt = p.meta.updated && !isNaN(Date.parse(p.meta.updated)) ? Date.parse(p.meta.updated) : Math.max(n.createdAt, p.f.lastModified || 0);
      if (p.meta.completed !== undefined || p.meta.due) { n.isTodo = true; n.done = p.meta.completed === true || p.meta.completed === 'true' || (p.meta.completed && p.meta.completed !== 'false' && !isNaN(Date.parse(p.meta.completed))); n.status = n.done ? 'done' : 'todo'; if (p.meta.due && !isNaN(Date.parse(p.meta.due))) n.due = ymd(new Date(p.meta.due)); }
      S.notes.set(n.id, n); await persistNote(n); syncCardsFor(n);
      if (++done % 10 === 0) pd.set(done / parsed.length, `Imported ${done} of ${parsed.length}…`);
    }
    render(); pd.done(`Imported <b>${plural(done, 'note')}</b> from “${esc(rootName)}”${attached ? ` with ${plural(attached, 'attachment')}` : ''}. Sub-folders became notebooks.`);
  } catch (e) { pd.done(`<span style="color:var(--bad)">${esc(e.message)}</span>`); }
}

/* ---------- HTML, MHT (OneNote “Single File Web Page”), Word ---------- */
function decodeQP(s) { return s.replace(/=\r?\n/g, '').replace(/(=[0-9A-F]{2})+/gi, (m) => { const bytes = m.match(/=([0-9A-F]{2})/gi).map((h) => parseInt(h.slice(1), 16)); return new TextDecoder().decode(new Uint8Array(bytes)); }); }
function parseMht(text) {
  const bm = /boundary="?([^";\r\n]+)"?/i.exec(text); if (!bm) return { html: text, parts: [] };
  const chunks = text.split('--' + bm[1]); const parts = [];
  for (const c of chunks) {
    const sep = c.search(/\r?\n\r?\n/); if (sep < 0) continue;
    const head = c.slice(0, sep); const bodyRaw = c.slice(sep).replace(/^\r?\n\r?\n/, '').replace(/\r?\n--\s*$/, '');
    const h = (k) => (new RegExp(`^${k}:\\s*([^\\r\\n]+)`, 'im').exec(head) || [])[1]?.trim() || '';
    const type = h('Content-Type').split(';')[0].toLowerCase(); if (!type) continue;
    const te = h('Content-Transfer-Encoding').toLowerCase(); const loc = h('Content-Location'); const cid = h('Content-ID').replace(/[<>]/g, '');
    const charset = (/charset="?([^";]+)/i.exec(h('Content-Type')) || [])[1] || 'utf-8';
    let data;
    if (te === 'base64') { const bin = atob(bodyRaw.replace(/\s+/g, '')); data = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i); }
    else if (te === 'quoted-printable') { const s = bodyRaw.replace(/=\r?\n/g, ''); const bytes = []; for (let i = 0; i < s.length; i++) { if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; } else bytes.push(s.charCodeAt(i) & 0xff); } data = new Uint8Array(bytes); }
    else data = new TextEncoder().encode(bodyRaw);
    parts.push({ type, loc, cid, data, charset });
  }
  const main = parts.find((p) => p.type === 'text/html');
  let html = main ? new TextDecoder(/^(utf-?8|windows-1252|iso-8859-1|utf-16)$/i.test(main.charset) ? main.charset : 'utf-8').decode(main.data) : '';
  return { html, parts: parts.filter((p) => p !== main) };
}
async function importHtmlLike(files, sourceLabel) {
  const pd = progressDialog(`Import ${sourceLabel}`);
  let done = 0; const errors = [];
  const folderId = await ensureFolderPath([sourceLabel === 'Word documents' ? 'Word import' : sourceLabel.includes('OneNote') ? 'OneNote import' : 'HTML import']);
  for (const f of files) {
    try {
      const ext = extOf(f.name); const title = f.name.replace(/\.[^.]+$/, '');
      if (ext === 'mht' || ext === 'mhtml') {
        const { html, parts } = parseMht(await f.text());
        const find = (src) => parts.find((p) => p.loc === src || (src.startsWith('cid:') && p.cid === src.slice(4)) || (p.loc && p.loc.split(/[\\/]/).pop() === src.split(/[\\/]/).pop()));
        const doc = new DOMParser().parseFromString(html, 'text/html'); const t = doc.querySelector('title')?.textContent?.trim();
        await noteFromHtml(doc, { title: t || title, folderId, created: f.lastModified, resolve: async (src) => { const p = find(src); return p ? { name: (p.loc || 'file').split(/[\\/]/).pop(), mime: p.type, data: await u8ToDataUrl(p.data, p.type) } : null; } });
      } else if (ext === 'docx') {
        const mammoth = await loadScript(window.GS_LIBS?.mammoth || 'https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js', 'mammoth');
        const r = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
        await noteFromHtml(`<html><body>${r.value}</body></html>`, { title, folderId, created: f.lastModified });
      } else {
        const html = await f.text(); const doc = new DOMParser().parseFromString(html, 'text/html');
        await noteFromHtml(doc, { title: doc.querySelector('title')?.textContent?.trim() || title, folderId, created: f.lastModified });
      }
      done++; pd.set(done / files.length, `Imported ${done} of ${files.length}…`);
    } catch (e) { errors.push(`${f.name}: ${e.message}`); }
  }
  render(); pd.done(`Imported <b>${plural(done, 'note')}</b> into the “${esc(S.folders.get(folderId)?.name || '')}” notebook.` + (errors.length ? `<br><span style="color:var(--bad)">${esc(errors.slice(0, 4).join(' · '))}</span>` : ''));
}

/* ---------- OneNote notebooks (.onepkg / .one / OneDrive .zip) — desktop app ---------- */
async function importOneNoteNative(paths) {
  if (!window.gsDesktop?.oneNote) return toast('Opening OneNote files needs the GSNotes desktop app.', true, 5000);
  const pd = progressDialog('Import from OneNote'); pd.set(0.1, 'Reading the OneNote file… large notebooks take a minute.');
  try {
    const r = await window.gsDesktop.oneNote(paths || null);
    if (r.cancelled) return pd.close();
    if (r.error) throw new Error(r.error);
    if (!r.pages.length) throw new Error('No pages found. ' + (r.warnings[0] || ''));
    let done = 0;
    for (const pg of r.pages) {
      const segs = pg.path.filter((s, i, a) => i === 0 || s !== a[i - 1]); // OneDrive zips repeat the notebook folder
      const folderId = await ensureFolderPath(segs.length ? segs : ['OneNote import']);
      const doc = new DOMParser().parseFromString(pg.html, 'text/html');
      doc.querySelector('.title')?.remove();
      const meta = (n) => +doc.querySelector(`meta[name="${n}"]`)?.getAttribute('content') || 0;
      await noteFromHtml(doc, { title: doc.querySelector('title')?.textContent?.trim() || pg.name, folderId, created: meta('X-Created-Time') * 1000 || undefined, updated: meta('X-Updated-Time') * 1000 || undefined,
        resolve: (src) => { let key; try { key = decodeURIComponent(src); } catch { key = src; } key = key.split(/[\\/]/).pop(); const f = pg.files[key]; return f ? { name: key, mime: mimeOf(key), data: f } : null; } });
      if (++done % 5 === 0) pd.set(0.1 + 0.9 * done / r.pages.length, `Imported ${done} of ${r.pages.length} pages…`);
    }
    render();
    pd.done(`Imported <b>${plural(done, 'page')}</b> from OneNote. Notebooks and sections became notebooks in GSNotes.` + (r.warnings.length ? `<br><span class="muted">${esc(r.warnings.slice(0, 3).join(' · '))}</span>` : ''));
  } catch (e) { pd.done(`<span style="color:var(--bad)">${esc(e.message)}</span>`); }
}

/* ---------- full export to Markdown (.zip) ---------- */
async function exportMarkdownZip() {
  const files = []; const used = new Set();
  const resName = new Map();
  for (const n of liveNotes()) {
    if (n.locked) continue;
    const p = n.projectId && S.projects.get(n.projectId);
    const dir = (p ? ['Projects', p.name] : (n.folderId ? folderPath(n.folderId).split(' / ') : ['No notebook'])).map(safeName).join('/');
    let name = `${dir}/${safeName(n.title)}.md`; let k = 2; while (used.has(name)) name = `${dir}/${safeName(n.title)} (${k++}).md`; used.add(name);
    const depth = dir.split('/').length;
    const body = n.body.replace(/\(gsres:\/\/([a-z0-9]+)\)/g, (m, id) => { const r = S.resources.get(id); if (!r) return m; if (!resName.has(id)) { const nm = `_resources/${id}-${safeName(r.name)}`; resName.set(id, nm); files.push({ name: nm, data: Uint8Array.from(atob(r.data.split(',')[1] || ''), (c) => c.charCodeAt(0)) }); } return `(${'../'.repeat(depth)}${encodeURI(resName.get(id))})`; });
    files.push({ name, data: noteToMd({ ...n, body }).replace(/\(gsres:\/\/[^)]*\)/g, '') });
  }
  const ok = await download(`gsnotes-markdown-${ymd()}.zip`, makeZip(files), 'application/zip');
  if (ok !== false) toast(`Exported ${plural(files.filter((f) => f.name.endsWith('.md')).length, 'note')} as Markdown`);
}

/* ---------- backups ---------- */
async function lastBackupInfo() { return (await DB.get('meta', 'lastBackup'))?.value || null; }
async function markBackup(kind, where) { const v = { at: now(), kind, where }; S.lastBackupAt = v.at; await DB.put('meta', { id: 'lastBackup', value: v }); renderRail(); return v; }
async function backupNow() {
  const p = await sealPayload(await buildPayload());
  const ok = await download(`gsnotes-backup-${ymd()}-${hm().replace(':', '')}.json`, JSON.stringify(p), 'application/json');
  if (ok === false) return;
  await markBackup('manual', 'download'); toast(p.encrypted ? 'Encrypted backup saved' : 'Backup saved (vault notes stay encrypted)');
  if (S.ui.view === 'backup') renderView(); renderRail();
}
function payloadCounts(p) {
  const live = (p.notes || []).filter((n) => !n.deleted);
  return { notes: live.filter((n) => !n.projectId).length, items: live.filter((n) => n.projectId).length, folders: (p.folders || []).filter((f) => !f.vault).length, vaults: (p.folders || []).filter((f) => f.vault).length, projects: (p.projects || []).length, cards: (p.cards || []).length, files: (p.resources || []).length };
}
async function restoreFlow(fileArg) {
  const f = fileArg || (await pickFiles('.json,application/json', false))[0]; if (!f) return;
  let payload;
  try { payload = await openPayload(JSON.parse(await f.text())); } catch (e) { return toast(e instanceof SyntaxError ? 'That file isn’t a GSNotes backup (it isn’t valid JSON).' : e.message, true, 6000); }
  const c = payloadCounts(payload); const cur = payloadCounts({ notes: [...S.notes.values()], folders: [...S.folders.values()], projects: [...S.projects.values()], cards: [...S.cards.values()], resources: [...S.rawResources.values()] });
  const d = openDialog(`${dlgHead('Restore from backup')}
    <form class="dialog-b" id="rs-form">
      <p style="margin:0"><b>${esc(f.name)}</b>${payload.exportedAt ? ` · made ${esc(new Date(payload.exportedAt).toLocaleString())}` : ''}</p>
      <table class="ctable"><thead><tr><th></th><th class="c-num">In backup</th><th class="c-num">On this device</th></tr></thead><tbody>
        ${[['Notes', 'notes'], ['Project items', 'items'], ['Notebooks', 'folders'], ['Vault notebooks', 'vaults'], ['Projects', 'projects'], ['Flashcards', 'cards'], ['Attachments', 'files']].map(([l, k]) => `<tr><td>${l}</td><td class="c-num">${c[k]}</td><td class="c-num">${cur[k]}</td></tr>`).join('')}</tbody></table>
      <label class="tpl"><input type="radio" name="rs-mode" value="merge" checked><span><b>Merge</b><br><span class="small muted">Add what’s missing and keep the newer copy of each note. Nothing on this device is deleted.</span></span></label>
      <label class="tpl"><input type="radio" name="rs-mode" value="replace"><span><b>Replace everything</b><br><span class="small muted">Erase this device’s notes, notebooks, projects and flashcards, then load the backup exactly. Settings are kept.</span></span></label>
      <p class="small" id="rs-warn" style="margin:0;color:var(--bad)"></p>
    </form><div class="dialog-f"><button class="btn" data-close>Cancel</button><button class="btn primary" form="rs-form" id="rs-go">Restore</button></div>`, { wide: true });
  let armed = false;
  d.el.addEventListener('change', () => { armed = false; $('#rs-warn', d.el).textContent = ''; $('#rs-go', d.el).textContent = 'Restore'; });
  $('#rs-form', d.el).onsubmit = async (e) => {
    e.preventDefault(); const mode = $('input[name="rs-mode"]:checked', d.el).value;
    if (mode === 'replace' && !armed) { armed = true; $('#rs-warn', d.el).textContent = `This erases all ${cur.notes + cur.items} notes and items on this device, then loads the ${c.notes + c.items} in the backup. Click again to confirm.`; $('#rs-go', d.el).textContent = 'Erase and restore'; return; }
    d.close();
    if (mode === 'replace') {
      for (const st of ['notes', 'folders', 'versions', 'cards', 'resources', 'projects']) await DB.clear(st);
      S.tombstones = []; await DB.put('meta', { id: 'tombstones', value: [] });
      S.keys.clear(); S.ui.noteId = null;
    }
    const r = await mergePayload(payload);
    for (const k of ['inboxFolder', 'dailyFolder', 'templateFolder']) if (S.settings[k] && !S.folders.has(S.settings[k])) S.settings[k] = null;
    if (!S.settings.inboxFolder) S.settings.inboxFolder = (await ensureFolder('Inbox')).id;
    await saveSettings();
    toast(mode === 'replace' ? `Restored the backup (${c.notes} notes, ${c.projects} projects)` : `Merged: ${r.added} added, ${r.updated} updated`, false, 5000);
    go('notes');
  };
}

/* automatic backups: desktop writes to a folder through the app; Chrome/Edge use a chosen folder */
const autoDirSupported = () => !!window.gsDesktop?.backupWrite || 'showDirectoryPicker' in window;
async function chooseAutoBackupFolder() {
  try {
    if (window.gsDesktop?.pickFolder) { const dir = await window.gsDesktop.pickFolder(S.settings.autoBackup?.dir); if (!dir) return; S.settings.autoBackup = { ...S.settings.autoBackup, dir, label: dir, on: true }; }
    else { const h = await window.showDirectoryPicker({ id: 'gsnotes-backups', mode: 'readwrite' }); await DB.put('meta', { id: 'backupDirHandle', value: h }); S.settings.autoBackup = { ...S.settings.autoBackup, label: h.name, on: true }; }
    await saveSettings(); await runAutoBackup(true); renderView();
  } catch (e) { if (e.name !== 'AbortError') toast('Could not use that folder: ' + e.message, true); }
}
let autoBackupBusy = false;
async function runAutoBackup(force = false) {
  const ab = S.settings.autoBackup; if (!ab?.on || autoBackupBusy) return;
  const every = (ab.everyHours || 24) * 3600e3; const last = ab.lastAt || 0;
  if (!force && now() - last < every) return;
  autoBackupBusy = true;
  try {
    const name = `gsnotes-backup-${ymd()}-${hm().replace(':', '')}.json`; const data = JSON.stringify(await sealPayload(await buildPayload())); const keep = ab.keep || 10;
    if (window.gsDesktop?.backupWrite) { const r = await window.gsDesktop.backupWrite({ dir: ab.dir, name, data, keep }); if (r.error) throw new Error(r.error); }
    else {
      const h = (await DB.get('meta', 'backupDirHandle'))?.value; if (!h) throw new Error('Choose the backup folder again.');
      if ((await h.queryPermission({ mode: 'readwrite' })) !== 'granted') { if (!force) return; if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Folder access was not granted.'); }
      const w = await (await h.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close();
      const old = []; for await (const [n] of h.entries()) if (/^gsnotes-backup-.*\.json$/.test(n)) old.push(n);
      old.sort().reverse().slice(keep).forEach((n) => h.removeEntry(n).catch(() => {}));
    }
    S.settings.autoBackup = { ...ab, lastAt: now(), lastError: '' }; await saveSettings(); await markBackup('auto', ab.label);
    if (force) toast(`Backup written to ${ab.label}`);
  } catch (e) { S.settings.autoBackup = { ...ab, lastError: e.message }; await saveSettings(); if (force) toast('Automatic backup failed: ' + e.message, true, 6000); }
  finally { autoBackupBusy = false; if (S.ui.view === 'backup') renderView(); }
}

/* ---------- Backup & import page ---------- */
async function viewBackup(V) {
  const last = await lastBackupInfo(); const ab = S.settings.autoBackup || {};
  const desk = !!window.gsDesktop; const age = last ? (now() - last.at) / 864e5 : Infinity;
  const c = payloadCounts({ notes: [...S.notes.values()], folders: [...S.folders.values()], projects: [...S.projects.values()], cards: [...S.cards.values()], resources: [...S.rawResources.values()] });
  V.innerHTML = viewHead('Backup &amp; import') + `<div class="view-body"><div class="settings">
    <section><h3>Back up</h3>
      <div class="row">${last ? `<span class="chip ${age > 7 ? 'amber' : 'good'}">Last backup ${esc(fmtWhen(last.at))}${age > 7 ? ` · ${Math.floor(age)} days ago` : ''}</span>` : '<span class="chip amber">No backup yet</span>'}<span class="muted small">${plural(c.notes, 'note')} · ${plural(c.items, 'project item')} · ${plural(c.projects, 'project')} · ${plural(c.folders, 'notebook')} · ${plural(c.files, 'attachment')}</span></div>
      <p>A backup is one <code>.json</code> file with everything: notes, notebooks, projects, flashcards, attachments and vaults. Vault notes stay encrypted inside it. ${S.settings.sync.passphrase ? 'Your sync passphrase also encrypts the whole file.' : 'To encrypt the whole file, set a sync passphrase in Settings.'}</p>
      <div class="row"><button class="btn primary" data-bk="now">Back up now</button><button class="btn" data-bk="mdzip">Export everything as Markdown (.zip)</button></div>
      <h4 style="margin:8px 0 0">Automatic backups</h4>
      ${autoDirSupported() ? `<p class="small">${desk ? 'GSNotes writes a backup file to a folder you choose while the app is open.' : 'Chrome and Edge can write backups to a folder you choose. The browser asks for permission again after a restart.'} Pick a folder that OneDrive, Dropbox or another backup tool already copies.</p>
        <div class="grid2"><label class="field">How often<select class="select" id="ab-every">${[[6, 'Every 6 hours'], [24, 'Daily'], [168, 'Weekly']].map(([h, l]) => `<option value="${h}"${(ab.everyHours || 24) === h ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Keep the newest<select class="select" id="ab-keep">${[5, 10, 30, 90].map((k) => `<option value="${k}"${(ab.keep || 10) === k ? ' selected' : ''}>${k} backups</option>`).join('')}</select></label></div>
        <div class="row"><button class="btn" data-bk="pickdir">${ab.label ? 'Change folder' : 'Choose folder'}</button>${ab.label ? `<label class="row small"><input type="checkbox" id="ab-on"${ab.on ? ' checked' : ''}> On</label><span class="muted small">Folder: ${esc(ab.label)}${ab.lastAt ? ` · last ${esc(fmtWhen(ab.lastAt))}` : ''}</span><button class="btn sm" data-bk="runauto">Run now</button>` : ''}</div>
        ${ab.lastError ? `<p class="small" style="color:var(--bad)">Last automatic backup failed: ${esc(ab.lastError)}</p>` : ''}`
      : '<p class="small muted">This browser can’t write to folders. Use “Back up now” regularly, or install the desktop app for automatic backups.</p>'}
    </section>
    <section><h3>Restore</h3>
      <p>Open a GSNotes backup file. You’ll see what’s in it and choose to <b>merge</b> it with this device or <b>replace</b> everything.</p>
      <div class="row"><button class="btn primary" data-bk="restore">Restore from a backup…</button></div>
    </section>
    <section><h3>Import from another app</h3>
      <div class="imp-grid">
        <div class="imp"><b>Joplin</b><span class="small muted">In Joplin: File → Export all → JEX. Keeps notebooks, tags, to-dos, images and links between notes.</span><div class="row"><button class="btn sm" data-bk="jex">Import .jex file</button></div></div>
        <div class="imp"><b>OneNote</b><span class="small muted">${desk ? 'Open a notebook package (.onepkg from File → Export), a section (.one), or a notebook downloaded from OneDrive as .zip.' : 'Notebook files (.onepkg, .one, OneDrive .zip) need the desktop app. Here you can import pages saved as Single File Web Page (.mht) or Word (.docx).'}</span>
          <div class="row">${desk ? '<button class="btn sm" data-bk="onenote">Import notebook…</button>' : ''}<button class="btn sm" data-bk="mht">Import .mht / .html</button><button class="btn sm" data-bk="docx">Import .docx</button></div></div>
        <div class="imp"><b>Markdown folder</b><span class="small muted">A folder exported from Joplin (Markdown), Obsidian, or any app. Sub-folders become notebooks; images and links come along.</span><div class="row"><button class="btn sm" data-bk="mdfolder">Choose folder</button><button class="btn sm" data-bk="mdfiles">Pick files</button></div></div>
        <div class="imp"><b>Evernote</b><span class="small muted">Export a notebook as .enex. Text and formatting are imported; attachments are counted but skipped.</span><div class="row"><button class="btn sm" data-bk="enex">Import .enex</button></div></div>
        <div class="imp"><b>Spreadsheet</b><span class="small muted">A CSV file becomes a project with typed fields and views.</span><div class="row"><button class="btn sm" data-bk="csv">Import .csv</button></div></div>
      </div>
    </section>
  </div></div>`;
}
function backupEvents() {
  const V = $('#view');
  V.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-bk]'); if (!b || S.ui.view !== 'backup') return;
    switch (b.dataset.bk) {
      case 'now': return backupNow();
      case 'mdzip': return exportMarkdownZip();
      case 'restore': return restoreFlow();
      case 'pickdir': return chooseAutoBackupFolder();
      case 'runauto': return runAutoBackup(true);
      case 'jex': { const [f] = await pickFiles('.jex,application/x-tar', false); if (f) importJex(f); return; }
      case 'onenote': return importOneNoteNative();
      case 'mht': { const fs = await pickFiles('.mht,.mhtml,.html,.htm'); if (fs.length) importHtmlLike(fs, 'OneNote pages'); return; }
      case 'docx': { const fs = await pickFiles('.docx'); if (fs.length) importHtmlLike(fs, 'Word documents'); return; }
      case 'mdfolder': return importMdFolder();
      case 'mdfiles': return importMarkdown();
      case 'enex': return importEnex();
      case 'csv': return importCsvProject();
    }
  });
  V.addEventListener('change', async (e) => {
    if (S.ui.view !== 'backup') return; const ab = S.settings.autoBackup ||= {};
    if (e.target.id === 'ab-every') ab.everyHours = +e.target.value;
    else if (e.target.id === 'ab-keep') ab.keep = +e.target.value;
    else if (e.target.id === 'ab-on') ab.on = e.target.checked;
    else return;
    await saveSettings(); toast('Backup settings saved');
  });
}
