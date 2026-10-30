// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
/* ============================================================
   Projects: typed fields, items-as-notes, and saved views
   (Grid, Kanban, Calendar, Timeline, Charts, Gallery)
   ============================================================ */
const FIELD_TYPES = [['text', 'Text'], ['number', 'Number'], ['select', 'Select'], ['multi', 'Multi-select'], ['date', 'Date'], ['checkbox', 'Checkbox'], ['url', 'Link']];
const VIEW_TYPES = [['grid', 'Grid', '▤'], ['kanban', 'Kanban', '▥'], ['calendar', 'Calendar', '▦'], ['timeline', 'Timeline', '═'], ['charts', 'Charts', '▂▆'], ['gallery', 'Gallery', '▣']];
const viewIcon = (t) => (VIEW_TYPES.find((v) => v[0] === t) || [])[2] || '▤';
const NOVAL = '__none';
const pjUI = { month: {}, search: '', tip: null };

/* ---------- basics ---------- */
const pf = (name, type, extra = {}) => ({ id: 'f' + uid().slice(0, 8), name, type, ...extra });
const opts = (...names) => names.map((name, i) => ({ id: 'o' + uid().slice(0, 7), name, color: (i % 8) + 1 }));
const pv = (name, type, config = {}) => ({ id: 'v' + uid().slice(0, 8), name, type, config: { filters: [], sort: null, ...config } });
const curProject = () => S.projects.get(S.ui.projectId);
const curView = (p = curProject()) => p && (p.views.find((v) => v.id === p.lastView) || p.views[0]);
const fieldById = (p, id) => id === 'title' ? { id: 'title', name: 'Title', type: 'text' } : p.fields.find((f) => f.id === id);
const fieldsOfType = (p, ...types) => p.fields.filter((f) => types.includes(f.type));
const allItems = (p) => [...S.notes.values()].filter((n) => n.projectId === p.id && !n.deleted);
const projectItems = (p) => allItems(p).filter((n) => !n.locked);
const getVal = (n, fid) => fid === 'title' ? n.title : (n.props || {})[fid];
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const optOf = (f, id) => (f.options || []).find((o) => o.id === id);

async function saveProject(p, touch = true) { if (touch) p.updatedAt = now(); S.projects.set(p.id, p); await DB.put('projects', p); }

function parseDay(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) / 864e5 : null; }
function dayToYmd(d) { const x = new Date(d * 864e5); return `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`; }
function shortDate(s) { const d = parseDay(s); if (d == null) return ''; const x = new Date(d * 864e5); return x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: x.getUTCFullYear() === new Date().getFullYear() ? undefined : 'numeric', timeZone: 'UTC' }); }

function fmtNum(f, v, compact = false) {
  if (v == null || v === '' || isNaN(v)) return '';
  const n = +v;
  if (f && f.format === 'currency') return n.toLocaleString(undefined, { style: 'currency', currency: f.currency || 'USD', maximumFractionDigits: compact && Math.abs(n) >= 1000 ? 0 : 2, notation: compact && Math.abs(n) >= 10000 ? 'compact' : 'standard' });
  if (f && f.format === 'percent') return n.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%';
  return n.toLocaleString(undefined, { maximumFractionDigits: 2, notation: compact && Math.abs(n) >= 10000 ? 'compact' : 'standard' });
}
const chip = (o) => o ? `<span class="opt" style="--oc:var(--c${o.color || 1})">${esc(o.name)}</span>` : '';
function fmtCell(f, v) {
  if (isEmpty(v)) return '';
  switch (f.type) {
    case 'number': return `<span class="num">${esc(fmtNum(f, v))}</span>`;
    case 'select': return chip(optOf(f, v));
    case 'multi': return (v || []).map((id) => chip(optOf(f, id))).join(' ');
    case 'date': return `<span class="mono">${esc(shortDate(v))}</span>`;
    case 'checkbox': return v ? '✓' : '';
    case 'url': return `<a href="${esc(/^https?:\/\//i.test(v) ? v : 'https://' + v)}" target="_blank" rel="noopener noreferrer">${esc(String(v).replace(/^https?:\/\/(www\.)?/i, '').slice(0, 40))}</a>`;
    default: return esc(v);
  }
}
function plainVal(f, v) { // for CSV, search and sorting text
  if (isEmpty(v)) return '';
  if (f.type === 'select') return optOf(f, v)?.name || '';
  if (f.type === 'multi') return (v || []).map((id) => optOf(f, id)?.name).filter(Boolean).join('; ');
  if (f.type === 'checkbox') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

/* ---------- filters & sort ---------- */
const OPS = {
  text: [['contains', 'contains'], ['is', 'is'], ['empty', 'is empty'], ['filled', 'is not empty']],
  url: [['contains', 'contains'], ['empty', 'is empty'], ['filled', 'is not empty']],
  number: [['eq', '='], ['ne', '≠'], ['gt', '>'], ['lt', '<'], ['ge', '≥'], ['le', '≤'], ['empty', 'is empty'], ['filled', 'is not empty']],
  select: [['is', 'is'], ['isnot', 'is not'], ['empty', 'is empty'], ['filled', 'is not empty']],
  multi: [['has', 'has'], ['hasnot', 'does not have'], ['empty', 'is empty'], ['filled', 'is not empty']],
  date: [['is', 'is'], ['before', 'is before'], ['after', 'is after'], ['next7', 'is within the next 7 days'], ['past', 'is in the past'], ['empty', 'is empty'], ['filled', 'is not empty']],
  checkbox: [['checked', 'is checked'], ['unchecked', 'is not checked']],
};
const opNeedsValue = (op) => !['empty', 'filled', 'next7', 'past', 'checked', 'unchecked'].includes(op);
function matchFilter(n, fl, f) {
  const v = getVal(n, fl.field); const x = fl.value;
  switch (fl.op) {
    case 'empty': return isEmpty(v);
    case 'filled': return !isEmpty(v);
    case 'contains': return String(v || '').toLowerCase().includes(String(x || '').toLowerCase());
    case 'is': return f.type === 'date' ? v === x : f.type === 'select' ? v === x : String(v || '').toLowerCase() === String(x || '').toLowerCase();
    case 'isnot': return v !== x;
    case 'has': return (v || []).includes(x);
    case 'hasnot': return !(v || []).includes(x);
    case 'eq': return !isEmpty(v) && +v === +x;
    case 'ne': return isEmpty(v) || +v !== +x;
    case 'gt': return !isEmpty(v) && +v > +x;
    case 'lt': return !isEmpty(v) && +v < +x;
    case 'ge': return !isEmpty(v) && +v >= +x;
    case 'le': return !isEmpty(v) && +v <= +x;
    case 'before': return !isEmpty(v) && v < x;
    case 'after': return !isEmpty(v) && v > x;
    case 'next7': { const d = parseDay(v), t = parseDay(ymd()); return d != null && d >= t && d <= t + 7; }
    case 'past': { const d = parseDay(v); return d != null && d < parseDay(ymd()); }
    case 'checked': return !!v;
    case 'unchecked': return !v;
  }
  return true;
}
function sortKey(f, v) {
  if (isEmpty(v)) return null;
  if (f.type === 'number') return +v;
  if (f.type === 'select') { const i = (f.options || []).findIndex((o) => o.id === v); return i < 0 ? null : i; }
  if (f.type === 'checkbox') return v ? 1 : 0;
  if (f.type === 'multi') return plainVal(f, v).toLowerCase();
  return String(v).toLowerCase();
}
function rowsFor(p, view, { search = pjUI.search } = {}) {
  let rows = projectItems(p);
  for (const fl of view.config.filters || []) { const f = fieldById(p, fl.field); if (f) rows = rows.filter((n) => matchFilter(n, fl, f)); }
  const q = search.trim().toLowerCase();
  if (q) rows = rows.filter((n) => (n.title || '').toLowerCase().includes(q) || p.fields.some((f) => ['text', 'url', 'select', 'multi'].includes(f.type) && plainVal(f, getVal(n, f.id)).toLowerCase().includes(q)));
  const s = view.config.sort; const sf = s && fieldById(p, s.field);
  if (sf) rows.sort((a, b) => { const x = sortKey(sf, getVal(a, sf.id)), y = sortKey(sf, getVal(b, sf.id)); if (x === y) return a.createdAt - b.createdAt; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : 1) * (s.dir === 'desc' ? -1 : 1); });
  else rows.sort((a, b) => a.createdAt - b.createdAt);
  return rows;
}

/* ---------- templates ---------- */
function makeTemplate(kind, name) {
  const p = { id: uid(), name, icon: '◆', description: '', fields: [], views: [], createdAt: now(), updatedAt: now() };
  const F = (n, t, x) => { const f = pf(n, t, x); p.fields.push(f); return f; };
  if (kind === 'tracker') {
    p.icon = '◆';
    const status = F('Status', 'select', { options: opts('Backlog', 'To do', 'In progress', 'Review', 'Done') });
    const prio = F('Priority', 'select', { options: opts('High', 'Medium', 'Low') });
    const owner = F('Owner', 'text'); const start = F('Start', 'date'); const due = F('Due', 'date');
    const est = F('Estimate (h)', 'number', { format: 'plain' }); const prog = F('Progress', 'number', { format: 'percent' });
    const area = F('Area', 'multi', { options: opts('Network', 'Server', 'Security', 'Docs') });
    p.views.push(pv('All tasks', 'grid'), pv('Board', 'kanban', { groupBy: status.id, cardFields: [prio.id, owner.id, due.id] }),
      pv('Timeline', 'timeline', { startField: start.id, endField: due.id, scale: 'week', colorBy: status.id }), pv('Due dates', 'calendar', { dateField: due.id }),
      pv('Dashboard', 'charts', { charts: [chartCfg('Tasks by status', 'bar', status.id, 'count'), chartCfg('Hours by owner', 'hbar', owner.id, 'sum', est.id), chartCfg('Tasks by priority', 'donut', prio.id, 'count'), chartCfg('Total estimate', 'number', '', 'sum', est.id)] }));
    void area;
  } else if (kind === 'expense') {
    p.icon = '$';
    const cat = F('Category', 'select', { options: opts('Hardware', 'Software', 'Services', 'Travel', 'Office') });
    const amt = F('Amount', 'number', { format: 'currency', currency: 'USD' }); const date = F('Date', 'date');
    F('Vendor', 'text'); F('Paid', 'checkbox'); F('Receipt', 'url');
    p.views.push(pv('All expenses', 'grid', { sort: { field: date.id, dir: 'desc' } }),
      pv('Spending', 'charts', { charts: [chartCfg('Spend by category', 'hbar', cat.id, 'sum', amt.id), chartCfg('Spend by month', 'line', date.id, 'sum', amt.id), chartCfg('Share by category', 'donut', cat.id, 'sum', amt.id), chartCfg('Total spend', 'number', '', 'sum', amt.id)] }),
      pv('Calendar', 'calendar', { dateField: date.id }));
  } else if (kind === 'content') {
    p.icon = '✎';
    const status = F('Status', 'select', { options: opts('Idea', 'Drafting', 'Editing', 'Scheduled', 'Published') });
    const ch = F('Channel', 'multi', { options: opts('Blog', 'LinkedIn', 'Newsletter', 'YouTube') });
    const pub = F('Publish date', 'date'); const owner = F('Owner', 'text'); F('Link', 'url');
    p.views.push(pv('Pipeline', 'kanban', { groupBy: status.id, cardFields: [ch.id, pub.id] }), pv('Calendar', 'calendar', { dateField: pub.id }),
      pv('All content', 'grid'), pv('Gallery', 'gallery', { cardFields: [status.id, ch.id, owner.id] }));
  } else {
    p.icon = '▤';
    const status = F('Status', 'select', { options: opts('Not started', 'In progress', 'Done') }); F('Date', 'date'); F('Notes', 'text');
    p.views.push(pv('Grid', 'grid'), pv('Board', 'kanban', { groupBy: status.id, cardFields: [] }));
  }
  p.lastView = p.views[0].id;
  return p;
}
function chartCfg(title, type, groupBy, measure, field = '') { return { id: 'c' + uid().slice(0, 7), title, type, groupBy, measure, field, table: false }; }

async function createItem(p, props = {}, title = '', body = '') {
  const n = newNote({ projectId: p.id, folderId: null, props: { ...props }, title, body, tags: [] });
  await saveNote(n, { snapshot: false });
  return n;
}

async function seedSampleProject() {
  const p = makeTemplate('tracker', 'Home lab upgrade (sample)');
  p.description = 'Sample project showing every view. Delete it whenever you like.';
  const [status, prio, owner, start, due, est, prog, area] = p.fields;
  const o = (f, name) => f.options.find((x) => x.name === name).id;
  const d = (k) => { const x = new Date(); x.setDate(x.getDate() + k); return ymd(x); };
  const rows = [
    ['Inventory current hardware', 'Done', 'Medium', 'Gus', -20, -15, 4, 100, ['Docs'], 'List every device with model, serial and warranty date.\n\nSee [[Network ports]] for the services each box exposes.'],
    ['Replace core switch', 'In progress', 'High', 'Gus', -6, 5, 10, 60, ['Network'], 'Move to a managed switch with VLAN support.\n\n- [x] Order switch\n- [ ] Plan VLAN layout\n- [ ] Cut over after hours'],
    ['Segment IoT devices into a VLAN', 'To do', 'High', 'Luis', 4, 14, 6, 0, ['Network', 'Security'], 'Isolate cameras and smart plugs from the main LAN.'],
    ['Set up offsite backup', 'Review', 'High', 'Priya', -10, 2, 8, 90, ['Server', 'Security'], 'Nightly encrypted backup to a second site. Test a restore before closing.'],
    ['Patch hypervisor host', 'To do', 'Medium', 'Gus', 7, 9, 3, 0, ['Server'], ''],
    ['Document firewall rules', 'Backlog', 'Low', 'Priya', 12, 24, 5, 0, ['Security', 'Docs'], ''],
    ['Upgrade Wi-Fi access points', 'Backlog', 'Medium', 'Luis', 15, 30, 12, 0, ['Network'], ''],
    ['Rotate admin passwords', 'Done', 'High', 'Gus', -14, -12, 2, 100, ['Security'], 'Store the new credentials in the vault notebook.'],
  ];
  await saveProject(p);
  let t = now() - rows.length * 1000;
  for (const [title, st, pr, ow, s, e, h, pg, ar, body] of rows) {
    const n = newNote({ projectId: p.id, folderId: null, title, body, tags: [], props: { [status.id]: o(status, st), [prio.id]: o(prio, pr), [owner.id]: ow, [start.id]: d(s), [due.id]: d(e), [est.id]: h, [prog.id]: pg, [area.id]: ar.map((a) => o(area, a)) } });
    n.createdAt = t; n.updatedAt = t; t += 1000;
    S.notes.set(n.id, n); await persistNote(n);
  }
  return p;
}

/* ---------- navigation ---------- */
function openProject(id, viewId) {
  const p = S.projects.get(id); if (!p) return;
  S.ui.projectId = id; if (viewId) p.lastView = viewId;
  pjUI.search = '';
  S.ui.view = 'project'; setPane('view'); render();
}

/* ---------- field inputs (editor, new-item dialog) ---------- */
function fieldInput(f, v, pre = 'fi') {
  const id = `${pre}-${f.id}`;
  switch (f.type) {
    case 'number': return `<input class="input" type="number" step="any" id="${id}" data-prop="${f.id}" value="${v == null ? '' : esc(v)}">`;
    case 'select': return `<select class="select" id="${id}" data-prop="${f.id}"><option value="">—</option>${(f.options || []).map((o) => `<option value="${o.id}"${o.id === v ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
    case 'multi': return `<div class="row" style="gap:4px" id="${id}" data-prop="${f.id}" data-multi="1">${(f.options || []).map((o) => `<button type="button" class="optbtn" data-opt="${o.id}" aria-pressed="${(v || []).includes(o.id)}" style="--oc:var(--c${o.color})">${esc(o.name)}</button>`).join('') || '<span class="muted small">No options yet</span>'}</div>`;
    case 'date': return `<input class="input" type="date" id="${id}" data-prop="${f.id}" value="${esc(v || '')}">`;
    case 'checkbox': return `<input type="checkbox" id="${id}" data-prop="${f.id}"${v ? ' checked' : ''}>`;
    case 'url': return `<input class="input" type="url" id="${id}" data-prop="${f.id}" value="${esc(v || '')}" placeholder="https://">`;
    default: return `<input class="input" type="text" id="${id}" data-prop="${f.id}" value="${esc(v || '')}">`;
  }
}
function readField(f, el) {
  if (!el) return undefined;
  if (f.type === 'checkbox') return el.checked;
  if (f.type === 'multi') return $$('[data-opt][aria-pressed="true"]', el).map((b) => b.dataset.opt);
  if (f.type === 'number') return el.value === '' ? null : +el.value;
  return el.value.trim();
}
function propsForm(p, values, pre) {
  return `<div class="props-grid">${p.fields.map((f) => `<label class="pl" for="${pre}-${f.id}">${esc(f.name)}</label><div class="pv">${fieldInput(f, values[f.id], pre)}</div>`).join('')}</div>`;
}

/* ---------- editor integration ---------- */
function itemPropsBlock(n) {
  const p = S.projects.get(n.projectId); if (!p) return '';
  return `<div class="item-props" id="item-props"><div class="row small muted" style="margin-bottom:4px">Item in <button class="btn ghost sm" data-act="to-project">${esc(p.icon || '◆')} ${esc(p.name)}</button></div>${propsForm(p, n.props || {}, 'ip')}</div>`;
}
async function onItemPropChange(el) {
  const n = cur(); const p = n && S.projects.get(n.projectId); if (!p) return;
  const holder = el.closest('[data-prop]'); const f = fieldById(p, holder.dataset.prop); if (!f) return;
  n.props = { ...(n.props || {}), [f.id]: readField(f, holder) };
  await saveNote(n, { snapshot: false });
}

/* ---------- project view ---------- */
function viewProject(V) {
  const p = curProject();
  if (!p) { S.ui.view = 'notes'; return render(); }
  const view = curView(p);
  const keep = {}; if (pjUI.lastRendered === view.id) $$('[data-keep]', V).forEach((el) => { keep[el.dataset.keep] = [el.scrollLeft, el.scrollTop]; });
  pjUI.lastRendered = view.id;
  const nFilters = (view.config.filters || []).length;
  const locked = allItems(p).filter((n) => n.locked).length;
  V.innerHTML = `
    <div class="view-head pj-head">
      <button class="btn ghost sm mobile-only" data-vact="rail" aria-label="Back to navigation">☰</button>
      <h2><span class="pj-icon">${esc(p.icon || '◆')}</span> ${esc(p.name)}</h2>
      <span class="muted small">${projectItems(p).length} item${projectItems(p).length === 1 ? '' : 's'}${locked ? ` · ${locked} locked` : ''}</span>
      <div class="row pj-tools">
        <input class="input sm-input" id="pj-q" type="search" placeholder="Search items" value="${esc(pjUI.search)}" aria-label="Search items">
        <button class="btn sm" data-pact="filters" aria-pressed="${nFilters > 0}">Filter${nFilters ? ` (${nFilters})` : ''}</button>
        <button class="btn sm" data-pact="viewcfg">View settings</button>
        <button class="btn sm" data-pact="fields">Fields</button>
        <button class="btn sm" data-pact="more" aria-label="More project actions">More</button>
        <button class="btn sm primary" data-pact="newitem">+ New item</button>
      </div>
    </div>
    <div class="pj-tabs" role="tablist">${p.views.map((v) => `<button role="tab" class="pj-tab" data-pview="${v.id}" aria-selected="${v.id === view.id}"><span aria-hidden="true">${viewIcon(v.type)}</span> ${esc(v.name)}</button>`).join('')}<button class="pj-tab add" data-pact="addview" title="Add a view">+ View</button></div>
    ${p.description ? `<p class="pj-desc muted small">${esc(p.description)}</p>` : ''}
    <div class="view-body pj-body" data-keep="body">${({ grid: pjGrid, kanban: pjKanban, calendar: pjCalendar, timeline: pjTimeline, charts: pjCharts, gallery: pjGallery })[view.type](p, view)}</div>`;
  $$('[data-keep]', V).forEach((el) => { const k = keep[el.dataset.keep]; if (k) { el.scrollLeft = k[0]; el.scrollTop = k[1]; } });
  if (view.type === 'charts') drawCharts(p, view);
  $('.pj-tab[aria-selected="true"]', V)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const tl = $('.tl', V); if (tl && !keep.tl) { const t = $('.tl-today', tl); if (t) tl.scrollLeft = Math.max(0, parseFloat(t.style.left) - 230 - tl.clientWidth * 0.3); }
}
const pjEmpty = (msg, btn = '') => `<div class="empty"><h3>${msg}</h3>${btn}</div>`;

/* Grid */
function pjGrid(p, view) {
  const rows = rowsFor(p, view);
  const cols = [{ id: 'title', name: 'Title', type: 'text' }, ...p.fields.filter((f) => !(view.config.hidden || []).includes(f.id))];
  const s = view.config.sort;
  const arrow = (id) => s && s.field === id ? (s.dir === 'desc' ? ' ↓' : ' ↑') : '';
  const total = (f) => {
    if (f.id === 'title') return `${rows.length} item${rows.length === 1 ? '' : 's'}`;
    const vals = rows.map((n) => getVal(n, f.id)).filter((v) => !isEmpty(v));
    if (f.type === 'number') { const sum = vals.reduce((a, b) => a + +b, 0); if (!vals.length) return '';
      return f.format === 'percent' ? `<span title="Sum ${esc(fmtNum(f, sum))}">avg ${esc(fmtNum(f, sum / vals.length))}</span>` : `<span title="Average ${esc(fmtNum(f, sum / vals.length))}">Σ ${esc(fmtNum(f, sum))}</span>`; }
    if (f.type === 'checkbox') return `${rows.filter((n) => getVal(n, f.id)).length} / ${rows.length} ✓`;
    return vals.length ? `${vals.length} filled` : '';
  };
  const lockedRows = allItems(p).filter((n) => n.locked);
  return `<div class="grid-wrap" data-keep="grid"><table class="pgrid">
    <thead><tr><th class="rn" aria-label="Open"></th>${cols.map((c) => `<th><button class="th-btn" data-sort="${c.id}" title="Sort by ${esc(c.name)}">${esc(c.name)}<span class="th-arrow">${arrow(c.id)}</span></button></th>`).join('')}<th class="addcol"><button class="btn ghost sm" data-pact="addfield" title="Add a field">+</button></th></tr></thead>
    <tbody>${rows.map((n) => `<tr data-row="${n.id}"><td class="rn"><button class="btn ghost sm" data-open="${n.id}" title="Open item" aria-label="Open ${esc(n.title || 'Untitled')}">↗</button></td>${cols.map((c) => c.type === 'checkbox'
      ? `<td class="c-check"><input type="checkbox" data-check="${c.id}" aria-label="${esc(c.name)}"${getVal(n, c.id) ? ' checked' : ''}></td>`
      : `<td data-cell="${c.id}" tabindex="0" class="${c.type === 'number' ? 'c-num' : ''}${c.id === 'title' ? ' c-title' : ''}">${c.id === 'title' ? (esc(n.title) || '<span class="muted">Untitled</span>') : fmtCell(c, getVal(n, c.id))}</td>`).join('')}<td></td></tr>`).join('')}
      ${lockedRows.map(() => `<tr class="locked-row"><td class="rn">🔒</td><td colspan="${cols.length + 1}" class="muted">Locked item — unlock its vault to see it</td></tr>`).join('')}
      <tr class="newrow"><td></td><td colspan="${cols.length + 1}"><button class="btn ghost sm" data-pact="quickadd">+ New item</button></td></tr></tbody>
    <tfoot><tr><td></td>${cols.map((c) => `<td class="${c.type === 'number' ? 'c-num' : ''}">${total(c)}</td>`).join('')}<td></td></tr></tfoot>
  </table></div>${!rows.length && projectItems(p).length ? '<p class="muted small" style="margin-top:10px">No items match the current filters or search.</p>' : ''}`;
}
function startCellEdit(td) {
  const p = curProject(); const n = S.notes.get(td.closest('tr').dataset.row); const f = fieldById(p, td.dataset.cell);
  if (!n || !f || td.querySelector('input,select')) return;
  if (f.type === 'multi') return multiDialog(p, f, n);
  const v = getVal(n, f.id);
  const done = async (val, commit) => {
    if (commit) { if (f.id === 'title') n.title = val; else n.props = { ...(n.props || {}), [f.id]: val }; await saveNote(n, { snapshot: false }); }
    renderView();
    if (commit) setTimeout(() => $(`tr[data-row="${n.id}"] td[data-cell="${f.id}"]`)?.focus(), 0);
  };
  let el;
  if (f.type === 'select') { el = document.createElement('select'); el.className = 'cell-input'; el.innerHTML = `<option value="">—</option>` + (f.options || []).map((o) => `<option value="${o.id}"${o.id === v ? ' selected' : ''}>${esc(o.name)}</option>`).join(''); }
  else { el = document.createElement('input'); el.className = 'cell-input'; el.type = { number: 'number', date: 'date', url: 'url' }[f.type] || 'text'; if (f.type === 'number') el.step = 'any'; el.value = v == null ? '' : v; }
  td.innerHTML = ''; td.appendChild(el); el.focus(); if (el.select && f.type !== 'select') el.select();
  let finished = false;
  const read = () => f.type === 'number' ? (el.value === '' ? null : +el.value) : el.value.trim();
  const finish = (commit) => { if (finished) return; finished = true; done(read(), commit && read() !== (v ?? (f.type === 'number' ? null : ''))); };
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
  el.addEventListener('blur', () => finish(true));
  if (f.type === 'select') el.addEventListener('change', () => finish(true));
}
function multiDialog(p, f, n) {
  const d = openDialog(`${dlgHead(esc(f.name) + ' — ' + esc(n.title || 'Untitled'))}<div class="dialog-b">${fieldInput(f, getVal(n, f.id), 'md')}</div><div class="dialog-f"><button class="btn primary" id="md-done">Done</button></div>`);
  d.el.addEventListener('click', (e) => { const b = e.target.closest('[data-opt]'); if (b) b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); });
  $('#md-done', d.el).onclick = async () => { n.props = { ...(n.props || {}), [f.id]: readField(f, $(`#md-${f.id}`, d.el)) }; await saveNote(n, { snapshot: false }); d.close(); renderView(); };
}

/* Kanban */
function pjKanban(p, view) {
  const f = fieldById(p, view.config.groupBy);
  if (!f || f.type !== 'select') return pjEmpty('Kanban needs a select field to make columns', `<p>Add one, such as Status, or pick a field in View settings.</p><button class="btn primary" data-pact="addstatus">Add a Status field</button>`);
  const rows = rowsFor(p, view);
  const cols = [...(f.options || []).map((o) => ({ key: o.id, o })), { key: NOVAL, o: null }];
  const cardFields = (view.config.cardFields || []).map((id) => fieldById(p, id)).filter(Boolean);
  return `<div class="kanban" data-keep="kanban">${cols.map((c) => {
    const items = rows.filter((n) => (getVal(n, f.id) || NOVAL) === c.key);
    if (c.key === NOVAL && !items.length) return '';
    return `<section class="kcol" data-kcol="${c.key}" aria-label="${esc(c.o ? c.o.name : 'No value')}"><h3>${c.o ? chip(c.o) : '<span class="muted">No value</span>'}<span class="mono muted">${items.length}</span></h3>
      ${items.map((n) => `<div class="kcard" draggable="true" data-kid="${n.id}" tabindex="0">
        <div class="t">${esc(n.title || 'Untitled')}</div>
        ${cardFields.map((cf) => { const h = fmtCell(cf, getVal(n, cf.id)); return h ? `<div class="kf"><span class="muted small">${esc(cf.name)}</span> ${h}</div>` : ''; }).join('')}
        <div class="row small" style="justify-content:flex-end;gap:2px">${kMoveBtns(f, n, c.key)}</div>
      </div>`).join('')}
      <button class="btn ghost sm" data-pact="additem" data-preset="${f.id}:${c.key === NOVAL ? '' : c.key}">+ Add</button></section>`;
  }).join('')}</div>`;
}
function kMoveBtns(f, n, key) {
  const keys = (f.options || []).map((o) => o.id); const i = keys.indexOf(key);
  const prev = i > 0 ? keys[i - 1] : (i === -1 ? keys[keys.length - 1] : null); const next = i >= 0 && i < keys.length - 1 ? keys[i + 1] : null;
  return `${prev ? `<button class="btn ghost sm" data-kmove="${n.id}" data-to="${prev}" aria-label="Move to ${esc(optOf(f, prev).name)}">←</button>` : ''}${next ? `<button class="btn ghost sm" data-kmove="${n.id}" data-to="${next}" aria-label="Move to ${esc(optOf(f, next).name)}">→</button>` : ''}`;
}
async function setItemVal(id, fid, val) { const n = S.notes.get(id); if (!n) return; n.props = { ...(n.props || {}), [fid]: val }; await saveNote(n, { snapshot: false }); renderView(); }

/* Calendar */
function pjCalendar(p, view) {
  const f = fieldById(p, view.config.dateField);
  if (!f || f.type !== 'date') return pjEmpty('Calendar needs a date field', `<button class="btn primary" data-pact="adddate">Add a Date field</button>`);
  const key = p.id + view.id; const base = pjUI.month[key] || (() => { const d = new Date(); return [d.getFullYear(), d.getMonth()]; })();
  pjUI.month[key] = base;
  const [y, m] = base; const first = new Date(y, m, 1); const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  const byDay = {}; for (const n of rowsFor(p, view)) { const v = getVal(n, f.id); if (v) (byDay[v] ||= []).push(n); }
  const colorF = p.fields.find((x) => x.type === 'select');
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = ymd(d); const ev = byDay[k] || [];
    cells += `<div class="day${d.getMonth() !== m ? ' other' : ''}${k === ymd() ? ' today' : ''}" data-pday="${k}"><span class="dn">${d.getDate()}</span>
      ${ev.slice(0, 4).map((n) => { const o = colorF && optOf(colorF, getVal(n, colorF.id)); return `<button class="ev pev" data-open="${n.id}" style="--oc:var(--c${o ? o.color : 1})" title="${esc(n.title)}">${esc(n.title || 'Untitled')}</button>`; }).join('')}
      ${ev.length > 4 ? `<span class="small muted">+${ev.length - 4} more</span>` : ''}</div>`;
  }
  const undated = rowsFor(p, view).filter((n) => !getVal(n, f.id)).length;
  return `<div class="row" style="margin-bottom:10px"><button class="btn sm" data-pcal="-1" aria-label="Previous month">‹</button><button class="btn sm" data-pcal="0">Today</button><button class="btn sm" data-pcal="1" aria-label="Next month">›</button><b style="margin-left:6px">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b><span class="muted small" style="margin-left:auto">By ${esc(f.name)}${undated ? ` · ${undated} without a date` : ''} · click a day to add</span></div>
    <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells}</div>`;
}

/* Timeline */
function pjTimeline(p, view) {
  const sf = fieldById(p, view.config.startField), ef = fieldById(p, view.config.endField);
  if (!sf || sf.type !== 'date') return pjEmpty('Timeline needs a start date field', `<button class="btn primary" data-pact="adddate">Add a Date field</button>`);
  const rows = rowsFor(p, view);
  const bars = [], undated = [];
  for (const n of rows) {
    const s = parseDay(getVal(n, sf.id)); let e = ef ? parseDay(getVal(n, ef.id)) : null;
    if (s == null && e == null) { undated.push(n); continue; }
    const a = s ?? e; let b = e ?? s; if (b < a) b = a;
    bars.push({ n, a, b });
  }
  if (!bars.length) return pjEmpty('No items have dates yet', `<p>Set ${esc(sf.name)}${ef ? ` or ${esc(ef.name)}` : ''} on an item to place it on the timeline.</p>`);
  const today = parseDay(ymd());
  let lo = Math.min(today, ...bars.map((x) => x.a)) - 3, hi = Math.max(today, ...bars.map((x) => x.b)) + 7;
  if (hi - lo < 42) hi = lo + 42;
  lo -= ((new Date(lo * 864e5).getUTCDay() + 6) % 7); // start on a Monday
  const dw = view.config.scale === 'month' ? 7 : 26; const W = (hi - lo + 1) * dw;
  const colorF = fieldById(p, view.config.colorBy);
  let ticks = '';
  for (let d = lo; d <= hi; d++) {
    const x = (d - lo) * dw; const dt = new Date(d * 864e5);
    if (dt.getUTCDate() === 1 || d === lo) ticks += `<div class="tl-month" style="left:${x}px">${dt.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })}</div>`;
    if (view.config.scale !== 'month') ticks += `<div class="tl-day${dt.getUTCDay() % 6 === 0 ? ' we' : ''}" style="left:${x}px;width:${dw}px">${dt.getUTCDate()}</div>`;
    else if (dt.getUTCDay() === 1) ticks += `<div class="tl-day" style="left:${x}px;width:${dw * 7}px">${dt.getUTCDate()}</div>`;
  }
  bars.sort((x, y) => x.a - y.a || x.b - y.b);
  return `<div class="row" style="margin-bottom:10px"><span class="muted small">${esc(sf.name)}${ef ? ` → ${esc(ef.name)}` : ''}</span><span style="margin-left:auto" class="row"><button class="btn sm" data-tlscale="week" aria-pressed="${view.config.scale !== 'month'}">Weeks</button><button class="btn sm" data-tlscale="month" aria-pressed="${view.config.scale === 'month'}">Months</button></span></div>
  <div class="tl" data-keep="tl"><div class="tl-grid" style="width:${W + 230}px">
    <div class="tl-head"><div class="tl-label-h">Item</div><div class="tl-scale" style="width:${W}px">${ticks}</div></div>
    ${bars.map(({ n, a, b }) => { const o = colorF && optOf(colorF, getVal(n, colorF.id)); const days = b - a + 1;
      return `<div class="tl-row"><button class="tl-label" data-open="${n.id}" title="${esc(n.title)}">${esc(n.title || 'Untitled')}</button><div class="tl-track" style="width:${W}px">
        <button class="tl-bar" data-open="${n.id}" style="left:${(a - lo) * dw}px;width:${Math.max(dw, days * dw) - 2}px;--oc:var(--c${o ? o.color : 1})" title="${esc(n.title)}: ${esc(shortDate(dayToYmd(a)))} – ${esc(shortDate(dayToYmd(b)))} (${days} day${days === 1 ? '' : 's'})${o ? ' · ' + esc(o.name) : ''}"><span>${esc(n.title || '')}</span></button></div></div>`; }).join('')}
    <div class="tl-today" style="left:${230 + (today - lo) * dw + dw / 2}px" title="Today"></div>
  </div></div>
  ${colorF ? `<div class="row small" style="margin-top:10px">${(colorF.options || []).map((o) => `<span class="legend-key"><i style="background:var(--c${o.color})"></i>${esc(o.name)}</span>`).join('')}</div>` : ''}
  ${undated.length ? `<p class="small muted" style="margin-top:12px">Without dates (${undated.length}): ${undated.map((n) => `<button class="chip" data-open="${n.id}">${esc(n.title || 'Untitled')}</button>`).join(' ')}</p>` : ''}`;
}

/* Gallery */
function firstImage(n) {
  const m = /!\[[^\]]*\]\(([^)\s]+)/.exec(n.body || ''); if (!m) return '';
  if (m[1].startsWith('gsres://')) return S.resources.get(m[1].slice(8))?.data || '';
  return /^(https?:|data:image\/)/.test(m[1]) ? m[1] : '';
}
function pjGallery(p, view) {
  const rows = rowsFor(p, view);
  if (!rows.length) return pjEmpty(projectItems(p).length ? 'No items match' : 'No items yet', `<button class="btn primary" data-pact="newitem">+ New item</button>`);
  const cfs = (view.config.cardFields || []).map((id) => fieldById(p, id)).filter(Boolean);
  return `<div class="gallery">${rows.map((n) => { const img = firstImage(n);
    return `<button class="gcard" data-open="${n.id}"><div class="gimg">${img ? `<img src="${esc(img)}" alt="">` : `<span>${esc((n.title || '?').trim().charAt(0).toUpperCase() || '?')}</span>`}</div>
      <div class="gbody"><div class="t">${esc(n.title || 'Untitled')}</div>${cfs.map((f) => { const h = fmtCell(f, getVal(n, f.id)); return h ? `<div class="kf">${h}</div>` : ''; }).join('')}
      <div class="small muted gsnip">${esc(stripMd(n.body).slice(0, 90))}</div></div></button>`; }).join('')}</div>`;
}

/* ---------- Charts ---------- */
function pjCharts(p, view) {
  const charts = view.config.charts || [];
  const locked = allItems(p).filter((n) => n.locked).length;
  return `<div class="row" style="margin-bottom:12px"><span class="muted small">${rowsFor(p, view).length} items counted${locked ? ` · ${locked} locked items not counted` : ''}${(view.config.filters || []).length ? ' · filters apply' : ''}</span><button class="btn sm" data-pact="addchart" style="margin-left:auto">+ Add chart</button></div>
    ${charts.length ? `<div class="charts">${charts.map((c) => `<section class="chart-card${c.type === 'number' ? ' stat' : ''}" data-chart="${c.id}">
      <div class="chart-h"><h3>${esc(c.title || 'Chart')}</h3><span class="row" style="gap:2px">${c.type !== 'number' ? `<button class="btn ghost sm" data-ctable="${c.id}" aria-pressed="${!!c.table}">Table</button>` : ''}<button class="btn ghost sm" data-cedit="${c.id}">Edit</button></span></div>
      <div class="chart-sub muted small">${esc(chartSubtitle(p, c))}</div>
      <div class="chart-body" data-cbody="${c.id}"></div></section>`).join('')}</div>`
      : pjEmpty('No charts yet', `<p>Charts count items or add up a number field, grouped by any field.</p><button class="btn primary" data-pact="addchart">+ Add chart</button>`)}`;
}
function chartSubtitle(p, c) {
  const g = fieldById(p, c.groupBy), m = fieldById(p, c.field);
  const meas = c.measure === 'count' ? 'Count of items' : `${c.measure === 'sum' ? 'Sum' : 'Average'} of ${m ? m.name : '?'}`;
  return c.type === 'number' ? meas : `${meas}${g ? ` by ${g.name}${g.type === 'date' ? ' (month)' : ''}` : ''}`;
}
/* returns { groups: [{label, value, color, n}], fmt, note } */
function aggregate(p, c, rows) {
  const g = fieldById(p, c.groupBy); const mf = c.measure !== 'count' ? fieldById(p, c.field) : null;
  const fmt = (v) => mf ? fmtNum(mf, v) : Math.round(v).toLocaleString();
  const measure = (items) => {
    if (c.measure === 'count') return items.length;
    const vals = items.map((n) => getVal(n, mf?.id)).filter((v) => !isEmpty(v)).map(Number);
    if (!vals.length) return 0;
    const s = vals.reduce((a, b) => a + b, 0); return c.measure === 'avg' ? s / vals.length : s;
  };
  if (c.type === 'number' || !g) return { groups: [{ label: 'All items', value: measure(rows), n: rows.length }], fmt, note: '' };
  const buckets = new Map(); const add = (key, label, color, n, order) => { if (!buckets.has(key)) buckets.set(key, { label, color, items: [], order }); buckets.get(key).items.push(n); };
  let note = '';
  for (const n of rows) {
    const v = getVal(n, g.id);
    if (g.type === 'select') { const o = optOf(g, v); o ? add(o.id, o.name, o.color, n, g.options.indexOf(o)) : add(NOVAL, 'No value', 0, n, 999); }
    else if (g.type === 'multi') { const ids = (v || []).filter((id) => optOf(g, id)); if (!ids.length) add(NOVAL, 'No value', 0, n, 999); for (const id of ids) { const o = optOf(g, id); add(o.id, o.name, o.color, n, g.options.indexOf(o)); } note = 'Items with several values count once in each.'; }
    else if (g.type === 'checkbox') v ? add('y', 'Checked', 1, n, 0) : add('n', 'Not checked', 2, n, 1);
    else if (g.type === 'date') { const k = (v || '').slice(0, 7); k ? add(k, k, 0, n, k) : add(NOVAL, 'No date', 0, n, '9999'); }
    else { const k = String(v ?? '').trim(); k ? add(k.toLowerCase(), k, 0, n, k.toLowerCase()) : add(NOVAL, 'No value', 0, n, '￿'); }
  }
  let groups = [...buckets.entries()].map(([key, b]) => ({ key, label: b.label, color: b.color, order: b.order, n: b.items.length, value: measure(b.items) }));
  if (g.type === 'date') {
    const dated = groups.filter((x) => x.key !== NOVAL).sort((a, b) => a.key.localeCompare(b.key));
    if (dated.length) { // fill empty months so time reads evenly
      const out = []; let [y, m] = dated[0].key.split('-').map(Number); const [ly, lm] = dated[dated.length - 1].key.split('-').map(Number); const map = new Map(dated.map((x) => [x.key, x]));
      while ((y < ly || (y === ly && m <= lm)) && out.length < 120) { const k = `${y}-${pad2(m)}`; out.push(map.get(k) || { key: k, n: 0, value: 0 }); m++; if (m > 12) { m = 1; y++; } }
      out.forEach((x) => { const [yy, mm] = x.key.split('-').map(Number); x.label = new Date(yy, mm - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }); });
      const nd = groups.find((x) => x.key === NOVAL); if (nd) note = `${nd.n} item${nd.n === 1 ? '' : 's'} without a date not shown.`;
      groups = out;
    }
  } else if (g.type === 'text') { groups.sort((a, b) => b.value - a.value); if (groups.length > 12) { const rest = groups.slice(11); groups = groups.slice(0, 11); groups.push({ key: 'other', label: `Other (${rest.length})`, n: rest.reduce((a, b) => a + b.n, 0), value: c.measure === 'avg' ? null : rest.reduce((a, b) => a + b.value, 0) }); if (c.measure === 'avg') groups.pop(); } }
  else groups.sort((a, b) => (a.order > b.order ? 1 : -1));
  return { groups, fmt, note };
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, parent) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
function niceTicks(max, count = 4, integer = false) {
  if (max <= 0) return [0, 1];
  const raw = max / count; const mag = Math.pow(10, Math.floor(Math.log10(raw))); let step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
  if (integer) step = Math.max(1, Math.ceil(step));
  const out = []; for (let v = 0; v <= max + step * 0.001; v += step) out.push(+v.toFixed(10)); if (out[out.length - 1] < max) out.push(+(out[out.length - 1] + step).toFixed(10)); return out;
}
function fitText(s, px) { const max = Math.max(2, Math.floor(px / 6.6)); return s.length > max ? s.slice(0, max - 1) + '…' : s; }
function markTip(el, label, value) { el.setAttribute('data-tip-l', label); el.setAttribute('data-tip-v', value); el.setAttribute('tabindex', '0'); el.setAttribute('role', 'img'); el.setAttribute('aria-label', `${label}: ${value}`); }

function drawCharts(p, view) {
  const rows = rowsFor(p, view);
  for (const c of view.config.charts || []) {
    const host = $(`[data-cbody="${c.id}"]`); if (!host) continue;
    const { groups, fmt, note } = aggregate(p, c, rows);
    host.innerHTML = '';
    if (c.type === 'number') { host.innerHTML = `<div class="stat-big">${esc(fmt(groups[0].value))}</div><div class="muted small">across ${groups[0].n} item${groups[0].n === 1 ? '' : 's'}</div>`; continue; }
    if (!groups.length || groups.every((x) => !x.value)) { host.innerHTML = '<p class="muted small" style="padding:30px 0;text-align:center">Nothing to chart yet for these items.</p>'; continue; }
    if (c.table) host.innerHTML = chartTable(groups, fmt, c);
    else ({ bar: barChart, hbar: hbarChart, line: lineChart, donut: donutChart })[c.type]?.(host, groups, fmt, c);
    if (note) host.insertAdjacentHTML('beforeend', `<p class="muted small chart-note">${esc(note)}</p>`);
  }
}
function chartTable(groups, fmt, c) {
  const total = groups.reduce((a, b) => a + (b.value || 0), 0);
  return `<div class="ctable-wrap"><table class="ctable"><thead><tr><th>Group</th><th class="c-num">Value</th>${c.measure !== 'avg' ? '<th class="c-num">Share</th>' : ''}<th class="c-num">Items</th></tr></thead><tbody>${groups.map((g) => `<tr><td>${esc(g.label)}</td><td class="c-num">${esc(fmt(g.value || 0))}</td>${c.measure !== 'avg' ? `<td class="c-num">${total ? ((g.value || 0) / total * 100).toFixed(1) + '%' : ''}</td>` : ''}<td class="c-num">${g.n}</td></tr>`).join('')}</tbody></table></div>`;
}
function barChart(host, groups, fmt, c) {
  const W = Math.max(260, host.clientWidth), H = 230, ml = 46, mr = 8, mt = 18, mb = 30;
  const max = Math.max(...groups.map((g) => g.value || 0)); const ticks = niceTicks(max, 4, c.measure === 'count'); const top = ticks[ticks.length - 1] || 1;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart-svg' }, host);
  const y = (v) => mt + (H - mt - mb) * (1 - v / top);
  for (const t of ticks) { svgEl('line', { x1: ml, x2: W - mr, y1: y(t), y2: y(t), class: t ? 'grid' : 'axis' }, svg); const tx = svgEl('text', { x: ml - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'tick' }, svg); tx.textContent = fmt(t).replace(/\.00$/, ''); }
  const band = (W - ml - mr) / groups.length; const bw = Math.max(4, Math.min(56, band - 2 - band * 0.25));
  groups.forEach((g, i) => {
    const x = ml + band * i + (band - bw) / 2; const v = g.value || 0; const y0 = y(0), y1 = y(v); const h = y0 - y1; const r = Math.min(4, h, bw / 2);
    const path = h > 0 ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 + r} V${y0} Z` : '';
    if (path) svgEl('path', { d: path, class: 'bar' }, svg);
    const hit = svgEl('rect', { x: ml + band * i, y: mt, width: band, height: H - mt - mb, class: 'hit' }, svg); markTip(hit, g.label, fmt(v));
    const lb = svgEl('text', { x: x + bw / 2, y: H - mb + 16, 'text-anchor': 'middle', class: 'tick' }, svg); lb.textContent = fitText(g.label, band - 4);
    if (groups.length <= 8 && band >= 30 && h > 0) { const vl = svgEl('text', { x: x + bw / 2, y: y1 - 5, 'text-anchor': 'middle', class: 'vlabel' }, svg); vl.textContent = fmt(v); }
  });
}
function hbarChart(host, groups, fmt) {
  const W = Math.max(260, host.clientWidth); const row = 28; const H = groups.length * row + 26; const lw = Math.min(140, W * 0.34); const vw = 74;
  const max = Math.max(...groups.map((g) => g.value || 0)) || 1;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart-svg' }, host);
  const x0 = lw + 8, span = W - x0 - vw;
  svgEl('line', { x1: x0, x2: x0, y1: 4, y2: H - 22, class: 'axis' }, svg);
  groups.forEach((g, i) => {
    const yy = 6 + i * row; const bh = row - 10; const w = Math.max(0, span * (g.value || 0) / max); const r = Math.min(4, w, bh / 2);
    const lb = svgEl('text', { x: lw, y: yy + bh / 2 + 4, 'text-anchor': 'end', class: 'tick' }, svg); lb.textContent = fitText(g.label, lw);
    if (w > 0) svgEl('path', { d: `M${x0},${yy} H${x0 + w - r} Q${x0 + w},${yy} ${x0 + w},${yy + r} V${yy + bh - r} Q${x0 + w},${yy + bh} ${x0 + w - r},${yy + bh} H${x0} Z`, class: 'bar' }, svg);
    const vl = svgEl('text', { x: x0 + w + 6, y: yy + bh / 2 + 4, class: 'vlabel' }, svg); vl.textContent = fmt(g.value || 0);
    const hit = svgEl('rect', { x: 0, y: yy - 4, width: W, height: row, class: 'hit' }, svg); markTip(hit, g.label, fmt(g.value || 0));
  });
}
function lineChart(host, groups, fmt, c) {
  const W = Math.max(260, host.clientWidth), H = 230, ml = 46, mr = 14, mt = 18, mb = 30;
  const max = Math.max(...groups.map((g) => g.value || 0)); const ticks = niceTicks(max, 4, c.measure === 'count'); const top = ticks[ticks.length - 1] || 1;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart-svg' }, host);
  const y = (v) => mt + (H - mt - mb) * (1 - v / top);
  const step = groups.length > 1 ? (W - ml - mr) / (groups.length - 1) : 0; const x = (i) => groups.length > 1 ? ml + step * i : (ml + W - mr) / 2;
  for (const t of ticks) { svgEl('line', { x1: ml, x2: W - mr, y1: y(t), y2: y(t), class: t ? 'grid' : 'axis' }, svg); const tx = svgEl('text', { x: ml - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'tick' }, svg); tx.textContent = fmt(t).replace(/\.00$/, ''); }
  const every = Math.ceil(groups.length / Math.max(1, Math.floor((W - ml - mr) / 56)));
  groups.forEach((g, i) => { if (i % every === 0 || i === groups.length - 1) { const t = svgEl('text', { x: x(i), y: H - mb + 16, 'text-anchor': 'middle', class: 'tick' }, svg); t.textContent = g.label; } });
  svgEl('path', { d: groups.map((g, i) => `${i ? 'L' : 'M'}${x(i)},${y(g.value || 0)}`).join(' '), class: 'line' }, svg);
  const cross = svgEl('line', { y1: mt, y2: H - mb, class: 'cross', visibility: 'hidden' }, svg);
  groups.forEach((g, i) => {
    if (groups.length <= 24) svgEl('circle', { cx: x(i), cy: y(g.value || 0), r: 4, class: 'dot' }, svg);
    const hw = groups.length > 1 ? step : W - ml - mr;
    const hit = svgEl('rect', { x: x(i) - hw / 2, y: mt, width: hw, height: H - mt - mb, class: 'hit' }, svg); markTip(hit, g.label, fmt(g.value || 0));
    const show = () => { cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible'); };
    hit.addEventListener('pointerenter', show); hit.addEventListener('focus', show); hit.addEventListener('pointerleave', () => cross.setAttribute('visibility', 'hidden')); hit.addEventListener('blur', () => cross.setAttribute('visibility', 'hidden'));
  });
  const last = groups[groups.length - 1]; const lv = svgEl('text', { x: Math.min(x(groups.length - 1), W - mr - 2), y: y(last.value || 0) - 9, 'text-anchor': 'end', class: 'vlabel' }, svg); lv.textContent = fmt(last.value || 0);
}
function donutChart(host, groups, fmt) {
  let gs = groups.filter((g) => (g.value || 0) > 0).sort((a, b) => (a.order > b.order ? 1 : a.order < b.order ? -1 : 0));
  if (gs.length > 6) { const keep = [...gs].sort((a, b) => b.value - a.value).slice(0, 5); const rest = gs.filter((g) => !keep.includes(g)); gs = gs.filter((g) => keep.includes(g)); gs.push({ label: `Other (${rest.length})`, value: rest.reduce((a, b) => a + b.value, 0), n: rest.reduce((a, b) => a + b.n, 0), color: 0 }); }
  const total = gs.reduce((a, b) => a + b.value, 0);
  const W = Math.max(260, host.clientWidth); const D = Math.min(190, W * 0.45); const R = D / 2, r = R * 0.62, cx = R + 4, cy = R + 4;
  const wrap = document.createElement('div'); wrap.className = 'donut-wrap'; host.appendChild(wrap);
  const svg = svgEl('svg', { viewBox: `0 0 ${D + 8} ${D + 8}`, width: D + 8, height: D + 8, class: 'chart-svg' }, wrap);
  let a0 = -Math.PI / 2; let slot = 0; const usedColors = new Set(gs.map((g) => g.color).filter(Boolean));
  const colorFor = (g) => { if (g.key === NOVAL) return null; if (g.color) return g.color; do { slot++; } while (usedColors.has(slot) && slot < 8); return slot; };
  gs.forEach((g) => {
    const frac = g.value / total; const a1 = a0 + frac * Math.PI * 2; const big = a1 - a0 > Math.PI ? 1 : 0; const col = g.label.startsWith('Other (') ? null : colorFor(g); g._c = col;
    const P = (ang, rad) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
    const d = frac >= 0.9999 ? `M${cx - R},${cy} A${R},${R} 0 1 1 ${cx + R},${cy} A${R},${R} 0 1 1 ${cx - R},${cy} M${cx - r},${cy} A${r},${r} 0 1 0 ${cx + r},${cy} A${r},${r} 0 1 0 ${cx - r},${cy} Z`
      : `M${P(a0, R)} A${R},${R} 0 ${big} 1 ${P(a1, R)} L${P(a1, r)} A${r},${r} 0 ${big} 0 ${P(a0, r)} Z`;
    const seg = svgEl('path', { d, class: 'seg', style: col ? `fill:var(--c${col})` : 'fill:var(--fg-3)', 'fill-rule': 'evenodd' }, svg);
    markTip(seg, g.label, `${fmt(g.value)} · ${(frac * 100).toFixed(1)}%`); a0 = a1;
  });
  const t1 = svgEl('text', { x: cx, y: cy + 2, 'text-anchor': 'middle', class: 'donut-total' }, svg); t1.textContent = fmt(total);
  const t2 = svgEl('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', class: 'tick' }, svg); t2.textContent = 'total';
  const leg = document.createElement('ul'); leg.className = 'donut-legend'; wrap.appendChild(leg);
  for (const g of gs) {
    const li = document.createElement('li'); const k = document.createElement('i'); k.style.background = g._c ? `var(--c${g._c})` : 'var(--fg-3)';
    const name = document.createElement('span'); name.textContent = g.label; const val = document.createElement('b'); val.textContent = `${fmt(g.value)} · ${(g.value / total * 100).toFixed(0)}%`;
    li.append(k, name, val); leg.appendChild(li);
  }
}
/* single tooltip for every chart mark */
function chartTip(e) {
  const el = e.target.closest?.('[data-tip-l]');
  let tip = pjUI.tip;
  if (!el) { if (tip) tip.hidden = true; return; }
  if (!tip) { tip = pjUI.tip = document.createElement('div'); tip.className = 'chart-tip'; tip.setAttribute('role', 'status'); document.body.appendChild(tip); }
  tip.replaceChildren(); const v = document.createElement('b'); v.textContent = el.getAttribute('data-tip-v'); const l = document.createElement('span'); l.textContent = el.getAttribute('data-tip-l'); tip.append(v, l);
  tip.hidden = false;
  let x, y; if (e.type === 'focusin') { const r = el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; } else { x = e.clientX; y = e.clientY; }
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - tw - 8, Math.max(8, x - tw / 2)) + 'px'; tip.style.top = Math.max(8, y - th - 12) + 'px';
}

/* ---------- dialogs ---------- */
function newProjectDialog() {
  const tpls = [['tracker', 'Project tracker', 'Status, priority, owner, dates and hours. Grid, Board, Timeline, Calendar and a dashboard.'], ['expense', 'Expense tracker', 'Category, amount, date and vendor, with spending charts.'], ['content', 'Content calendar', 'Ideas through publishing, by channel, on a board and calendar.'], ['blank', 'Blank', 'A status field, a date and a note. Add fields as you go.']];
  const d = openDialog(`${dlgHead('New project')}
    <form class="dialog-b" id="np-form">
      <label class="field">Name<input class="input" id="np-name" required autofocus placeholder="e.g. Office move"></label>
      <fieldset class="tpl-list"><legend class="small muted">Start from</legend>${tpls.map(([k, t, desc], i) => `<label class="tpl"><input type="radio" name="np-tpl" value="${k}"${i === 0 ? ' checked' : ''}><span><b>${t}</b><br><span class="small muted">${desc}</span></span></label>`).join('')}</fieldset>
      <p class="small muted" style="margin:0">Have a spreadsheet already? <button type="button" class="btn ghost sm" id="np-csv">Import a CSV file instead</button></p>
    </form>
    <div class="dialog-f"><button class="btn" data-close>Cancel</button><button class="btn primary" form="np-form">Create project</button></div>`);
  $('#np-csv', d.el).onclick = () => { d.close(); importCsvProject(); };
  $('#np-form', d.el).onsubmit = async (e) => {
    e.preventDefault(); const name = $('#np-name', d.el).value.trim(); if (!name) return;
    const p = makeTemplate($('input[name="np-tpl"]:checked', d.el).value, name); await saveProject(p);
    d.close(); toast(`Created “${name}”`); openProject(p.id);
  };
}
function newItemDialog(p, preset = {}) {
  const d = openDialog(`${dlgHead('New item — ' + esc(p.name))}
    <form class="dialog-b" id="ni-form"><label class="field">Title<input class="input" id="ni-title" required autofocus></label>${propsForm(p, preset, 'ni')}</form>
    <div class="dialog-f"><button class="btn" data-close>Cancel</button><button class="btn" type="submit" form="ni-form" data-open-after="1">Create and open</button><button class="btn primary" form="ni-form">Create</button></div>`);
  d.el.addEventListener('click', (e) => { const b = e.target.closest('[data-opt]'); if (b) b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'); });
  $('#ni-form', d.el).onsubmit = async (e) => {
    e.preventDefault(); const props = {};
    for (const f of p.fields) { const v = readField(f, $(`#ni-${f.id}`, d.el)); if (!isEmpty(v) && v !== false) props[f.id] = v; }
    const n = await createItem(p, props, $('#ni-title', d.el).value.trim());
    d.close(); toast('Item added');
    if (e.submitter?.dataset.openAfter) openNote(n.id); else renderView();
  };
}
function addViewDialog(p) {
  const d = openDialog(`${dlgHead('Add a view')}
    <form class="dialog-b" id="av-form"><div class="view-pick">${VIEW_TYPES.map(([k, l, ic], i) => `<label class="tpl"><input type="radio" name="av-type" value="${k}"${i === 0 ? ' checked' : ''}><span><b>${ic} ${l}</b></span></label>`).join('')}</div>
      <label class="field">Name<input class="input" id="av-name" placeholder="Leave blank to use the type name"></label></form>
    <div class="dialog-f"><button class="btn" data-close>Cancel</button><button class="btn primary" form="av-form">Add view</button></div>`);
  $('#av-form', d.el).onsubmit = async (e) => {
    e.preventDefault(); const type = $('input[name="av-type"]:checked', d.el).value;
    const v = pv($('#av-name', d.el).value.trim() || VIEW_TYPES.find((x) => x[0] === type)[1], type, defaultViewConfig(p, type));
    p.views.push(v); p.lastView = v.id; await saveProject(p); d.close(); renderView(); renderRail();
  };
}
function defaultViewConfig(p, type) {
  const sel = fieldsOfType(p, 'select'), dates = fieldsOfType(p, 'date'), nums = fieldsOfType(p, 'number');
  if (type === 'kanban') return { groupBy: sel[0]?.id || '', cardFields: p.fields.filter((f) => f.id !== sel[0]?.id).slice(0, 2).map((f) => f.id) };
  if (type === 'calendar') return { dateField: dates[0]?.id || '' };
  if (type === 'timeline') return { startField: dates[0]?.id || '', endField: dates[1]?.id || '', scale: 'week', colorBy: sel[0]?.id || '' };
  if (type === 'gallery') return { cardFields: p.fields.slice(0, 2).map((f) => f.id) };
  if (type === 'charts') { const g = sel[0] || fieldsOfType(p, 'multi', 'checkbox', 'text')[0]; return { charts: [chartCfg(g ? `Items by ${g.name}` : 'Items', g ? 'bar' : 'number', g?.id || '', 'count'), ...(nums[0] ? [chartCfg(`Total ${nums[0].name}`, 'number', '', 'sum', nums[0].id)] : [])] }; }
  return {};
}
function fieldSelect(id, list, sel, none = '— None —') { return `<select class="select" id="${id}">${none !== null ? `<option value="">${none}</option>` : ''}${list.map((f) => `<option value="${f.id}"${f.id === sel ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`; }
function fieldChecks(name, list, chosen) { return `<div class="check-list">${list.map((f) => `<label class="row small"><input type="checkbox" name="${name}" value="${f.id}"${chosen.includes(f.id) ? ' checked' : ''}> ${esc(f.name)}</label>`).join('') || '<span class="muted small">No fields yet.</span>'}</div>`; }
function viewSettingsDialog(p, view) {
  const c = view.config; let body = '';
  if (view.type === 'grid') body = `<p class="small muted" style="margin:0">Columns to show</p>${fieldChecks('vs-show', p.fields, p.fields.filter((f) => !(c.hidden || []).includes(f.id)).map((f) => f.id))}`;
  if (view.type === 'kanban') body = `<label class="field">Columns come from${fieldSelect('vs-group', fieldsOfType(p, 'select'), c.groupBy, null)}</label><p class="small muted" style="margin:0">Show on cards</p>${fieldChecks('vs-card', p.fields, c.cardFields || [])}`;
  if (view.type === 'gallery') body = `<p class="small muted" style="margin:0">Show on cards</p>${fieldChecks('vs-card', p.fields, c.cardFields || [])}`;
  if (view.type === 'calendar') body = `<label class="field">Place items by${fieldSelect('vs-date', fieldsOfType(p, 'date'), c.dateField, null)}</label>`;
  if (view.type === 'timeline') body = `<div class="grid2"><label class="field">Start${fieldSelect('vs-start', fieldsOfType(p, 'date'), c.startField, null)}</label><label class="field">End${fieldSelect('vs-end', fieldsOfType(p, 'date'), c.endField)}</label><label class="field">Color bars by${fieldSelect('vs-color', fieldsOfType(p, 'select'), c.colorBy)}</label></div>`;
  if (view.type === 'charts') body = `<p class="small" style="margin:0">Use <b>+ Add chart</b> and each chart’s <b>Edit</b> button to change charts. Filters on this view apply to every chart.</p>`;
  const d = openDialog(`${dlgHead('View settings')}
    <form class="dialog-b" id="vs-form"><label class="field">View name<input class="input" id="vs-name" value="${esc(view.name)}" required></label>${body}
      <details><summary class="small">Duplicate or delete this view</summary><div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="vs-dup">Duplicate view</button>${p.views.length > 1 ? '<button type="button" class="btn sm danger" id="vs-del">Delete view</button>' : '<span class="muted small">A project keeps at least one view.</span>'}</div></details></form>
    <div class="dialog-f"><button class="btn" data-close>Cancel</button><button class="btn primary" form="vs-form">Save</button></div>`);
  const val = (id) => $(id, d.el)?.value || '';
  const checks = (n) => $$(`input[name="${n}"]:checked`, d.el).map((x) => x.value);
  $('#vs-form', d.el).onsubmit = async (e) => {
    e.preventDefault(); view.name = val('#vs-name').trim() || view.name;
    if (view.type === 'grid') c.hidden = p.fields.filter((f) => !checks('vs-show').includes(f.id)).map((f) => f.id);
    if (view.type === 'kanban') { c.groupBy = val('#vs-group'); c.cardFields = checks('vs-card'); }
    if (view.type === 'gallery') c.cardFields = checks('vs-card');
    if (view.type === 'calendar') c.dateField = val('#vs-date');
    if (view.type === 'timeline') { c.startField = val('#vs-start'); c.endField = val('#vs-end'); c.colorBy = val('#vs-color'); }
    await saveProject(p); d.close(); renderView();
  };
  $('#vs-dup', d.el).onclick = async () => { const v = structuredClone(view); v.id = 'v' + uid().slice(0, 8); v.name += ' (copy)'; p.views.splice(p.views.indexOf(view) + 1, 0, v); p.lastView = v.id; await saveProject(p); d.close(); renderView(); };
  const del = $('#vs-del', d.el); if (del) del.onclick = async () => { p.views = p.views.filter((v) => v.id !== view.id); p.lastView = p.views[0].id; await saveProject(p); d.close(); toast(`Deleted view “${view.name}”`); renderView(); };
}
function filtersDialog(p, view) {
  let list = structuredClone(view.config.filters || []);
  const allF = [{ id: 'title', name: 'Title', type: 'text' }, ...p.fields];
  const d = openDialog(`${dlgHead('Filters — ' + esc(view.name))}<div class="dialog-b" id="fl-body"></div><div class="dialog-f"><button class="btn" id="fl-clear">Clear all</button><button class="btn" data-close>Cancel</button><button class="btn primary" id="fl-save">Apply</button></div>`, { wide: true });
  const draw = () => {
    $('#fl-body', d.el).innerHTML = `${list.length ? '<p class="small muted" style="margin:0">Items must match every filter.</p>' : '<p class="small muted" style="margin:0">No filters. Every item shows.</p>'}
      ${list.map((fl, i) => { const f = allF.find((x) => x.id === fl.field) || allF[0]; const ops = OPS[f.type] || OPS.text;
        const vIn = !opNeedsValue(fl.op) ? '' : f.type === 'select' || f.type === 'multi' ? `<select class="select" data-flv="${i}">${(f.options || []).map((o) => `<option value="${o.id}"${o.id === fl.value ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`
          : `<input class="input" data-flv="${i}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" value="${esc(fl.value ?? '')}">`;
        return `<div class="fl-row"><select class="select" data-flf="${i}" aria-label="Field">${allF.map((x) => `<option value="${x.id}"${x.id === f.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          <select class="select" data-flo="${i}" aria-label="Condition">${ops.map(([k, l]) => `<option value="${k}"${k === fl.op ? ' selected' : ''}>${l}</option>`).join('')}</select>${vIn}<button class="btn ghost sm" data-flx="${i}" aria-label="Remove filter">✕</button></div>`; }).join('')}
      <button class="btn sm" id="fl-add" style="justify-self:start">+ Add filter</button>`;
  };
  const sync = () => $$('[data-flv]', d.el).forEach((el) => { list[+el.dataset.flv].value = el.value; });
  d.el.addEventListener('change', (e) => {
    sync(); const t = e.target;
    if (t.dataset.flf) { const f = allF.find((x) => x.id === t.value); list[+t.dataset.flf] = { field: f.id, op: (OPS[f.type] || OPS.text)[0][0], value: f.type === 'select' || f.type === 'multi' ? f.options?.[0]?.id || '' : '' }; draw(); }
    if (t.dataset.flo) { list[+t.dataset.flo].op = t.value; draw(); }
  });
  d.el.addEventListener('click', (e) => {
    if (e.target.id === 'fl-add') { sync(); const f = allF[1] || allF[0]; list.push({ field: f.id, op: (OPS[f.type] || OPS.text)[0][0], value: f.type === 'select' || f.type === 'multi' ? f.options?.[0]?.id || '' : '' }); draw(); }
    const x = e.target.closest('[data-flx]'); if (x) { sync(); list.splice(+x.dataset.flx, 1); draw(); }
  });
  $('#fl-clear', d.el).onclick = () => { list = []; draw(); };
  $('#fl-save', d.el).onclick = async () => { sync(); view.config.filters = list; await saveProject(p); d.close(); renderView(); };
  draw();
}
function chartDialog(p, view, chart) {
  const isNew = !chart; const c = chart ? structuredClone(chart) : chartCfg('', 'bar', fieldsOfType(p, 'select')[0]?.id || '', 'count');
  const groupable = p.fields.filter((f) => ['select', 'multi', 'checkbox', 'text', 'date'].includes(f.type)); const nums = fieldsOfType(p, 'number');
  const d = openDialog(`${dlgHead(isNew ? 'Add chart' : 'Edit chart')}
    <form class="dialog-b" id="cd-form">
      <label class="field">Title<input class="input" id="cd-title" value="${esc(c.title)}" placeholder="e.g. Hours by owner"></label>
      <div class="grid2">
        <label class="field">Chart type<select class="select" id="cd-type">${[['bar', 'Bar'], ['hbar', 'Horizontal bar'], ['line', 'Line over time'], ['donut', 'Donut (share of total)'], ['number', 'Single number']].map(([k, l]) => `<option value="${k}"${k === c.type ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field">Group by${fieldSelect('cd-group', groupable, c.groupBy)}</label>
        <label class="field">Measure<select class="select" id="cd-measure"><option value="count"${c.measure === 'count' ? ' selected' : ''}>Count of items</option>${nums.length ? `<option value="sum"${c.measure === 'sum' ? ' selected' : ''}>Sum of a number</option><option value="avg"${c.measure === 'avg' ? ' selected' : ''}>Average of a number</option>` : ''}</select></label>
        <label class="field">Number field${fieldSelect('cd-field', nums, c.field, null)}</label>
      </div>
      <p class="small muted" id="cd-hint" style="margin:0"></p>
      ${isNew ? '' : '<details><summary class="small">Remove this chart</summary><button type="button" class="btn sm danger" id="cd-del" style="margin-top:8px">Remove chart</button></details>'}
    </form>
    <div class="dialog-f"><button class="btn" data-close>Cancel</button><button class="btn primary" form="cd-form">${isNew ? 'Add chart' : 'Save'}</button></div>`);
  const hint = () => {
    const t = $('#cd-type', d.el).value, g = fieldById(p, $('#cd-group', d.el).value), m = $('#cd-measure', d.el).value;
    $('#cd-field', d.el).disabled = m === 'count' || !nums.length; $('#cd-group', d.el).disabled = t === 'number';
    $('#cd-hint', d.el).textContent = t === 'line' && g && g.type !== 'date' ? 'Line charts read best over time. Pick a date field to group by, or use a bar chart.' : t === 'donut' ? 'Donuts show share of a total. Groups beyond the largest five combine into “Other”.' : t !== 'number' && !g ? 'Pick a field to group by, or choose Single number.' : '';
  };
  d.el.addEventListener('change', hint); hint();
  $('#cd-form', d.el).onsubmit = async (e) => {
    e.preventDefault();
    Object.assign(c, { type: $('#cd-type', d.el).value, groupBy: $('#cd-group', d.el).value, measure: $('#cd-measure', d.el).value, field: $('#cd-field', d.el).value });
    if (c.measure !== 'count' && !c.field) c.measure = 'count';
    if (c.type !== 'number' && !c.groupBy) c.type = 'number';
    c.title = $('#cd-title', d.el).value.trim() || chartSubtitle(p, c);
    const list = view.config.charts ||= [];
    if (isNew) list.push(c); else list.splice(list.findIndex((x) => x.id === c.id), 1, c);
    await saveProject(p); d.close(); renderView();
  };
  const del = $('#cd-del', d.el); if (del) del.onclick = async () => { view.config.charts = view.config.charts.filter((x) => x.id !== c.id); await saveProject(p); d.close(); renderView(); };
}

/* fields manager */
function fieldsDialog(p, focusNew) {
  let fields = structuredClone(p.fields); let confirmLoss = false;
  if (focusNew) fields.push(pf('New field', 'text'));
  const d = openDialog(`${dlgHead('Fields — ' + esc(p.name))}<div class="dialog-b" id="fd-body"></div><div class="dialog-f"><span class="small" id="fd-warn" style="margin-right:auto;color:var(--bad)"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="fd-save">Save fields</button></div>`, { wide: true });
  const draw = () => {
    $('#fd-body', d.el).innerHTML = `<p class="small muted" style="margin:0">Every item also has a Title. Changing a field’s type converts its values where possible.</p>
    ${fields.map((f, i) => `<div class="fd-row" data-i="${i}">
      <div class="row"><input class="input grow" data-k="name" value="${esc(f.name)}" aria-label="Field name">
        <select class="select" data-k="type" style="width:auto" aria-label="Field type">${FIELD_TYPES.map(([k, l]) => `<option value="${k}"${k === f.type ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${f.type === 'number' ? `<select class="select" data-k="format" style="width:auto" aria-label="Number format">${[['plain', 'Plain'], ['currency', 'Currency'], ['percent', 'Percent']].map(([k, l]) => `<option value="${k}"${(f.format || 'plain') === k ? ' selected' : ''}>${l}</option>`).join('')}</select>${f.format === 'currency' ? `<input class="input" data-k="currency" value="${esc(f.currency || 'USD')}" style="width:70px" maxlength="3" aria-label="Currency code">` : ''}` : ''}
        <button class="btn ghost sm" data-mv="-1" aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button><button class="btn ghost sm" data-mv="1" aria-label="Move down"${i === fields.length - 1 ? ' disabled' : ''}>↓</button><button class="btn ghost sm danger" data-rm aria-label="Delete field">✕</button></div>
      ${f.type === 'select' || f.type === 'multi' ? `<div class="opt-edit">${(f.options || []).map((o, j) => `<span class="opt-in" style="--oc:var(--c${o.color})"><button class="cdot" data-color="${j}" title="Change color" aria-label="Change color of ${esc(o.name)}"></button><input data-opt-name="${j}" value="${esc(o.name)}" aria-label="Option name"><button class="btn ghost sm" data-opt-rm="${j}" aria-label="Remove option">✕</button></span>`).join('')}<button class="btn sm" data-opt-add>+ Option</button></div>` : ''}
    </div>`).join('')}
    <button class="btn sm" id="fd-add" style="justify-self:start">+ Add field</button>`;
    confirmLoss = false; $('#fd-warn', d.el).textContent = ''; $('#fd-save', d.el).textContent = 'Save fields';
  };
  const row = (el) => fields[+el.closest('[data-i]').dataset.i];
  d.el.addEventListener('input', (e) => { const t = e.target; if (!t.closest('[data-i]')) return; const f = row(t);
    if (t.dataset.k === 'name') f.name = t.value; if (t.dataset.k === 'currency') f.currency = t.value.toUpperCase();
    if (t.dataset.optName != null) f.options[+t.dataset.optName].name = t.value; confirmLoss = false; });
  d.el.addEventListener('change', (e) => { const t = e.target; if (!t.closest('[data-i]')) return; const f = row(t);
    if (t.dataset.k === 'type') { const old = f.type; f.type = t.value;
      if ((f.type === 'select' || f.type === 'multi') && !f.options?.length) f.options = optionsFromValues(p, f.id, old);
      if (f.type === 'number' && !f.format) f.format = 'plain'; draw(); }
    if (t.dataset.k === 'format') { f.format = t.value; draw(); } });
  d.el.addEventListener('click', (e) => { const t = e.target.closest('button'); if (!t || !t.closest('[data-i]')) { if (e.target.id === 'fd-add') { fields.push(pf('New field', 'text')); draw(); $$('[data-k="name"]', d.el).pop()?.select(); } return; }
    const i = +t.closest('[data-i]').dataset.i; const f = fields[i];
    if (t.dataset.mv) { const j = i + +t.dataset.mv; [fields[i], fields[j]] = [fields[j], fields[i]]; draw(); }
    if (t.hasAttribute('data-rm')) { fields.splice(i, 1); draw(); }
    if (t.hasAttribute('data-opt-add')) { (f.options ||= []).push({ id: 'o' + uid().slice(0, 7), name: 'Option ' + (f.options.length + 1), color: (f.options.length % 8) + 1 }); draw(); $$(`[data-i="${i}"] [data-opt-name]`, d.el).pop()?.select(); }
    if (t.dataset.optRm != null) { f.options.splice(+t.dataset.optRm, 1); draw(); }
    if (t.dataset.color != null) { const o = f.options[+t.dataset.color]; o.color = (o.color % 8) + 1; draw(); } });
  $('#fd-save', d.el).onclick = async () => {
    const items = projectItems(p); let lost = 0; const removed = p.fields.filter((f) => !fields.some((x) => x.id === f.id));
    const plan = [];
    for (const f of fields) {
      f.name = f.name.trim() || 'Untitled field';
      const old = p.fields.find((x) => x.id === f.id); if (!old) continue;
      for (const n of items) { const v = getVal(n, f.id); if (isEmpty(v)) continue; const nv = convertVal(old, f, v);
        const isLost = isEmpty(nv) && !(old.type === 'checkbox' && v === false); if (isLost) lost++;
        if (JSON.stringify(nv) !== JSON.stringify(v)) plan.push([n, f.id, nv]); }
      if (f.type === 'select' || f.type === 'multi') { const ids = new Set(f.options.map((o) => o.id)); for (const n of items) { const v = getVal(n, f.id);
        if (old.type === f.type && f.type === 'select' && v && !ids.has(v)) { plan.push([n, f.id, '']); lost++; }
        if (old.type === f.type && f.type === 'multi' && (v || []).some((x) => !ids.has(x))) { plan.push([n, f.id, v.filter((x) => ids.has(x))]); lost++; } } }
    }
    for (const f of removed) lost += items.filter((n) => !isEmpty(getVal(n, f.id))).length;
    if (lost && !confirmLoss) { confirmLoss = true; $('#fd-warn', d.el).textContent = `${lost} value${lost === 1 ? '' : 's'} will be cleared by these changes.`; $('#fd-save', d.el).textContent = 'Save anyway'; return; }
    for (const [n, fid, nv] of plan) n.props = { ...(n.props || {}), [fid]: nv };
    for (const n of items) { if (removed.length) { n.props = { ...(n.props || {}) }; for (const f of removed) delete n.props[f.id]; } }
    const touched = new Set([...plan.map((x) => x[0]), ...(removed.length ? items : [])]);
    for (const n of touched) await saveNote(n, { snapshot: false });
    p.fields = fields;
    for (const v of p.views) { // drop references to removed fields
      const ok = (id) => !id || id === 'title' || fields.some((f) => f.id === id);
      v.config.filters = (v.config.filters || []).filter((fl) => ok(fl.field)); if (v.config.sort && !ok(v.config.sort.field)) v.config.sort = null;
      for (const k of ['groupBy', 'dateField', 'startField', 'endField', 'colorBy']) if (v.config[k] && !ok(v.config[k])) v.config[k] = '';
      if (v.config.cardFields) v.config.cardFields = v.config.cardFields.filter(ok);
      if (v.config.charts) v.config.charts.forEach((c) => { if (!ok(c.groupBy)) c.groupBy = ''; if (!ok(c.field)) { c.field = ''; c.measure = 'count'; } });
    }
    await saveProject(p); d.close(); toast('Fields saved'); renderView();
  };
  draw();
}
function optionsFromValues(p, fid, oldType) {
  const old = p.fields.find((f) => f.id === fid); const names = new Set();
  for (const n of projectItems(p)) { const v = getVal(n, fid); if (isEmpty(v)) continue; if (old && (old.type === 'select' || old.type === 'multi')) plainVal(old, v).split('; ').forEach((x) => x && names.add(x)); else String(v).split(oldType === 'text' ? /\s*[;,]\s*/ : /$^/).forEach((x) => x.trim() && names.add(x.trim())); if (names.size >= 30) break; }
  return opts(...[...names].slice(0, 30));
}
function convertVal(from, to, v) {
  if (from.type === to.type) return v;
  const text = plainVal(from, v);
  switch (to.type) {
    case 'text': return text;
    case 'url': return /^https?:\/\/|^www\./i.test(text) ? text : '';
    case 'number': { const x = parseFloat(String(text).replace(/[$,%\s]/g, '')); return isNaN(x) ? null : x; }
    case 'checkbox': return /^(true|yes|y|x|1|✓)$/i.test(text.trim()) || (from.type === 'number' && +v !== 0);
    case 'date': { const d = toIsoDate(text); return d || ''; }
    case 'select': { const names = text.split('; ').filter(Boolean); const o = (to.options || []).find((x) => x.name.toLowerCase() === (names[0] || '').toLowerCase()); return o ? o.id : ''; }
    case 'multi': { const names = text.split(/\s*[;,]\s*/).filter(Boolean).map((s) => s.toLowerCase()); return (to.options || []).filter((o) => names.includes(o.name.toLowerCase())).map((o) => o.id); }
  }
  return v;
}
function toIsoDate(s) {
  s = String(s || '').trim(); let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad2(m[1])}-${pad2(m[2])}`; }
  return '';
}

function projectMoreDialog(p) {
  const view = curView(p);
  const d = openDialog(`${dlgHead(esc(p.name))}
    <form class="dialog-b" id="pm-form">
      <div class="grid2"><label class="field">Name<input class="input" id="pm-name" value="${esc(p.name)}" required></label><label class="field">Icon (one character)<input class="input" id="pm-icon" value="${esc(p.icon || '◆')}" maxlength="2"></label></div>
      <label class="field">Description<input class="input" id="pm-desc" value="${esc(p.description || '')}" placeholder="Optional"></label>
      <div class="row"><button type="button" class="btn sm" id="pm-csv">Export “${esc(view.name)}” as CSV</button><button type="button" class="btn sm" id="pm-imp">Import CSV as a new project</button></div>
      <details><summary class="small">Delete this project</summary><p class="small">Its ${projectItems(p).length} items move to the trash, where you can restore them as ordinary notes.</p><button type="button" class="btn sm danger" id="pm-del">Delete project</button></details>
    </form><div class="dialog-f"><button class="btn" data-close>Cancel</button><button class="btn primary" form="pm-form">Save</button></div>`);
  $('#pm-form', d.el).onsubmit = async (e) => { e.preventDefault(); p.name = $('#pm-name', d.el).value.trim() || p.name; p.icon = $('#pm-icon', d.el).value.trim() || '◆'; p.description = $('#pm-desc', d.el).value.trim(); await saveProject(p); d.close(); render(); };
  $('#pm-csv', d.el).onclick = () => { exportCsv(p, view); d.close(); };
  $('#pm-imp', d.el).onclick = () => { d.close(); importCsvProject(); };
  $('#pm-del', d.el).onclick = async () => {
    const items = allItems(p);
    for (const n of items) { n.deleted = now(); await saveNote(n, { snapshot: false, touch: false }); }
    S.projects.delete(p.id); await DB.del('projects', p.id);
    S.tombstones.push({ id: p.id, at: now() }); await DB.put('meta', { id: 'tombstones', value: S.tombstones.slice(-5000) });
    d.close(); toast(`Deleted “${p.name}”. ${items.length} item${items.length === 1 ? '' : 's'} moved to the trash.`); go('notes');
  };
}

/* ---------- CSV ---------- */
function csvCell(s) { s = String(s ?? ''); return /[",\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function buildCsv(p, view) {
  const cols = [{ id: 'title', name: 'Title', type: 'text' }, ...p.fields];
  const rows = rowsFor(p, view, { search: '' });
  const lines = [cols.map((c) => csvCell(c.name)).join(',')];
  for (const n of rows) lines.push(cols.map((c) => csvCell(c.type === 'number' ? (getVal(n, c.id) ?? '') : plainVal(c, getVal(n, c.id)))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
function exportCsv(p, view) { download(`${safeName(p.name)} - ${safeName(view.name)}.csv`, buildCsv(p, view), 'text/csv'); toast(`Exported ${rowsFor(p, view, { search: '' }).length} rows`); }
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}
function inferType(vals) {
  const v = vals.map((x) => x.trim()).filter(Boolean);
  if (!v.length) return { type: 'text' };
  if (v.every((x) => /^(true|false|yes|no)$/i.test(x))) return { type: 'checkbox' };
  if (v.every((x) => /^[-+]?\$?\s?[-+]?[\d,]*\.?\d+\s?%?$/.test(x) && /\d/.test(x))) return { type: 'number', format: v.some((x) => x.includes('$')) ? 'currency' : v.some((x) => x.includes('%')) ? 'percent' : 'plain' };
  if (v.every((x) => toIsoDate(x))) return { type: 'date' };
  if (v.every((x) => /^https?:\/\//i.test(x))) return { type: 'url' };
  const parts = v.some((x) => x.includes(';')) ? v.flatMap((x) => x.split(';').map((s) => s.trim()).filter(Boolean)) : v;
  const distinct = new Set(parts.map((x) => x.toLowerCase()));
  if (distinct.size <= Math.min(12, Math.max(4, Math.ceil(v.length * 0.6))) && parts.every((x) => x.length <= 40) && parts.length > distinct.size) return { type: v.some((x) => x.includes(';')) ? 'multi' : 'select' };
  return { type: 'text' };
}
async function importCsvProject(fileArg) {
  const f = fileArg || (await pickFiles('.csv,text/csv,text/plain', false))[0]; if (!f) return;
  const rows = parseCsv(await f.text());
  if (rows.length < 2) return toast('That CSV has no data rows.', true);
  if (rows.length > 5001) return toast('That CSV has more than 5,000 rows. Split it into smaller files first.', true, 5000);
  const head = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`); const data = rows.slice(1);
  let titleIdx = head.findIndex((h) => /^(title|name|task|item|subject)$/i.test(h)); if (titleIdx < 0) titleIdx = 0;
  const cols = head.map((h, i) => ({ i, name: h, ...inferType(data.map((r) => r[i] || '')) }));
  const d = openDialog(`${dlgHead('Import CSV as a project')}
    <form class="dialog-b" id="ic-form">
      <label class="field">Project name<input class="input" id="ic-name" value="${esc(f.name.replace(/\.(csv|txt)$/i, ''))}" required></label>
      <p class="small muted" style="margin:0">${data.length} rows · ${head.length} columns. Check the field types GSNotes guessed.</p>
      <div class="ic-cols">${cols.map((c) => `<div class="row"><span class="grow">${esc(c.name)}${c.i === titleIdx ? ' <span class="chip accent">Title</span>' : ''}</span>${c.i === titleIdx ? '' : `<select class="select" data-ic="${c.i}" style="width:auto" aria-label="Type for ${esc(c.name)}">${FIELD_TYPES.map(([k, l]) => `<option value="${k}"${k === c.type ? ' selected' : ''}>${l}</option>`).join('')}</select>`}<span class="small muted mono" style="width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((data.find((r) => (r[c.i] || '').trim()) || [])[c.i] || '')}</span></div>`).join('')}</div>
    </form><div class="dialog-f"><button class="btn" data-close>Cancel</button><button class="btn primary" form="ic-form">Import ${data.length} rows</button></div>`, { wide: true });
  $('#ic-form', d.el).onsubmit = async (e) => {
    e.preventDefault();
    const p = { id: uid(), name: $('#ic-name', d.el).value.trim() || 'Imported', icon: '▤', description: `Imported from ${f.name}`, fields: [], views: [], createdAt: now(), updatedAt: now() };
    const map = [];
    for (const c of cols) { if (c.i === titleIdx) continue; const type = $(`[data-ic="${c.i}"]`, d.el).value;
      const field = pf(c.name, type, type === 'number' ? { format: c.type === 'number' ? c.format : 'plain' } : {});
      if (type === 'select' || type === 'multi') { const names = new Set(); data.forEach((r) => String(r[c.i] || '').split(type === 'multi' ? ';' : /$^/).map((s) => s.trim()).filter(Boolean).forEach((s) => names.add(s))); field.options = opts(...[...names].slice(0, 60)); }
      p.fields.push(field); map.push([c.i, field]); }
    const textF = { type: 'text' };
    let t = now() - data.length;
    for (const r of data) {
      const props = {}; for (const [i, field] of map) { const raw = (r[i] || '').trim(); if (!raw) continue; const v = convertVal(textF, field, raw); if (!isEmpty(v)) props[field.id] = v; }
      const n = newNote({ projectId: p.id, folderId: null, title: (r[titleIdx] || '').trim(), props, tags: [] }); n.createdAt = n.updatedAt = t++;
      S.notes.set(n.id, n); await persistNote(n);
    }
    p.views.push(pv('Grid', 'grid'));
    for (const type of ['kanban', 'timeline', 'calendar', 'charts']) { const cfg = defaultViewConfig(p, type);
      if ((type === 'kanban' && cfg.groupBy) || (type === 'calendar' && cfg.dateField) || (type === 'timeline' && cfg.startField && cfg.endField) || type === 'charts') p.views.push(pv(VIEW_TYPES.find((x) => x[0] === type)[1], type, cfg)); }
    p.lastView = p.views[0].id; await saveProject(p);
    d.close(); toast(`Imported ${data.length} rows into “${p.name}”`); openProject(p.id);
  };
}

/* ---------- events ---------- */
function projectEvents() {
  const V = $('#view');
  V.addEventListener('input', (e) => { if (e.target.id === 'pj-q' && S.ui.view === 'project') { pjUI.search = e.target.value; const pos = e.target.selectionStart; renderView(); const q = $('#pj-q'); q.focus(); q.setSelectionRange(pos, pos); } });
  V.addEventListener('click', async (e) => {
    if (S.ui.view !== 'project') return;
    const p = curProject(); const view = curView(p);
    if (e.target.closest('a[href]')) return;
    const t = e.target.closest('button, td[data-cell], .day, input[data-check]'); if (!t) return;
    if (t.matches('input[data-check]')) { return setItemVal(t.closest('tr').dataset.row, t.dataset.check, t.checked); }
    if (t.dataset.open) return openNote(t.dataset.open);
    if (t.dataset.pview) { p.lastView = t.dataset.pview; await saveProject(p, false); return renderView(); }
    if (t.dataset.sort) { const s = view.config.sort; view.config.sort = !s || s.field !== t.dataset.sort ? { field: t.dataset.sort, dir: 'asc' } : s.dir === 'asc' ? { field: s.field, dir: 'desc' } : null; await saveProject(p); return renderView(); }
    if (t.matches('td[data-cell]')) return startCellEdit(t);
    if (t.dataset.kmove) { const f = fieldById(p, view.config.groupBy); return setItemVal(t.dataset.kmove, f.id, t.dataset.to); }
    if (t.dataset.pcal) { const k = p.id + view.id; const [y, m] = pjUI.month[k]; const d = +t.dataset.pcal ? new Date(y, m + +t.dataset.pcal, 1) : new Date(); pjUI.month[k] = [d.getFullYear(), d.getMonth()]; return renderView(); }
    if (t.classList.contains('day') && t.dataset.pday) return newItemDialog(p, { [view.config.dateField]: t.dataset.pday });
    if (t.dataset.tlscale) { view.config.scale = t.dataset.tlscale; await saveProject(p); return renderView(); }
    if (t.dataset.ctable) { const c = view.config.charts.find((x) => x.id === t.dataset.ctable); c.table = !c.table; await saveProject(p); return renderView(); }
    if (t.dataset.cedit) return chartDialog(p, view, view.config.charts.find((x) => x.id === t.dataset.cedit));
    switch (t.dataset.pact) {
      case 'newitem': return newItemDialog(p);
      case 'quickadd': return quickAdd(p);
      case 'additem': { const [fid, val] = t.dataset.preset.split(':'); return newItemDialog(p, val ? { [fid]: val } : {}); }
      case 'filters': return filtersDialog(p, view);
      case 'viewcfg': return viewSettingsDialog(p, view);
      case 'fields': return fieldsDialog(p);
      case 'addfield': return fieldsDialog(p, true);
      case 'more': return projectMoreDialog(p);
      case 'addview': return addViewDialog(p);
      case 'addchart': return chartDialog(p, view, null);
      case 'addstatus': { const f = pf('Status', 'select', { options: opts('To do', 'In progress', 'Done') }); p.fields.push(f); view.config.groupBy = f.id; await saveProject(p); return renderView(); }
      case 'adddate': { const f = pf('Date', 'date'); p.fields.push(f); if (view.type === 'calendar') view.config.dateField = f.id; else view.config.startField = f.id; await saveProject(p); return renderView(); }
    }
  });
  V.addEventListener('keydown', (e) => { const td = e.target.closest?.('td[data-cell]'); if (td && e.key === 'Enter' && !td.querySelector('input,select')) { e.preventDefault(); startCellEdit(td); } const kc = e.target.closest?.('.kcard'); if (kc && e.key === 'Enter') openNote(kc.dataset.kid); });
  V.addEventListener('dragstart', (e) => { const c = e.target.closest?.('.kcard[data-kid]'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.kid); e.dataTransfer.effectAllowed = 'move'; } });
  V.addEventListener('dragover', (e) => { const col = e.target.closest?.('.kcol'); if (col) { e.preventDefault(); $$('.kcol').forEach((x) => x.classList.toggle('drop', x === col)); } });
  V.addEventListener('drop', (e) => { const col = e.target.closest?.('.kcol'); if (!col || S.ui.view !== 'project') return; e.preventDefault(); $$('.kcol').forEach((x) => x.classList.remove('drop')); const view = curView(); setItemVal(e.dataTransfer.getData('text/plain'), view.config.groupBy, col.dataset.kcol === NOVAL ? '' : col.dataset.kcol); });
  V.addEventListener('click', (e) => { const c = e.target.closest?.('.kcard[data-kid]'); if (c && !e.target.closest('button') && S.ui.view === 'project') openNote(c.dataset.kid); });
  for (const ev of ['pointerover', 'pointermove', 'focusin']) document.addEventListener(ev, (e) => { if (e.target.closest?.('[data-tip-l]') || pjUI.tip?.hidden === false) chartTip(e); }, { passive: true });
  document.addEventListener('pointerout', (e) => { if (e.target.closest?.('[data-tip-l]') && !e.relatedTarget?.closest?.('[data-tip-l]') && pjUI.tip) pjUI.tip.hidden = true; }, { passive: true });
  let rz; new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { if (S.ui.view === 'project' && curView()?.type === 'charts') drawCharts(curProject(), curView()); }, 150); }).observe(V);
}
async function quickAdd(p) {
  const n = await createItem(p, {}, '');
  renderView();
  const td = $(`tr[data-row="${n.id}"] td[data-cell="title"]`); if (td) { td.scrollIntoView({ block: 'nearest' }); startCellEdit(td); }
}
