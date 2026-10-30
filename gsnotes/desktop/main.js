// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
// GSNotes desktop shell (Electron main process)
const { app, BrowserWindow, protocol, net, shell, globalShortcut, ipcMain, Menu, session, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');

const APP_DIR = path.join(__dirname, 'app');
const SCHEME = 'app';
const ORIGIN = `${SCHEME}://gsnotes`;
const CAPTURE_HOTKEY = 'CommandOrControl+Alt+N';

// app://gsnotes behaves like a normal https origin: secure context (Web Crypto),
// persistent IndexedDB, fetch support.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
const pendingCommands = [];

function sendCommand(cmd) {
  if (!win) { pendingCommands.push(cmd); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
  if (win.webContents.isLoading()) pendingCommands.push(cmd);
  else win.webContents.send('gs:command', cmd);
}
function commandFromArgs(argv) {
  if (argv.includes('--capture')) return 'capture';
  if (argv.includes('--today')) return 'today';
  return null;
}

// ---- window state
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return { width: 1280, height: 820 }; } }
function saveState() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch {}
}

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width || 1280, height: st.height || 820, minWidth: 380, minHeight: 480,
    title: 'GSNotes', backgroundColor: '#eef1f5', autoHideMenuBar: true, show: false,
    icon: nativeImage.createFromPath(path.join(__dirname, 'icon.png')),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${ORIGIN}/index.html`);
  win.webContents.on('did-finish-load', () => { while (pendingCommands.length) win.webContents.send('gs:command', pendingCommands.shift()); });

  // links open in the system browser; the app never navigates away from itself
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?|mailto):/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });

  // spelling suggestions on right-click in the editor
  win.webContents.on('context-menu', (_e, p) => {
    const items = [];
    for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    if (p.misspelledWord) items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' });
    if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    else if (p.selectionText) items.push({ role: 'copy' });
    if (items.length) Menu.buildFromTemplate(items).popup();
  });

  for (const ev of ['resize', 'move', 'close']) win.on(ev, saveState);
  win.on('closed', () => { win = null; });
}

// ---- single instance: a second launch focuses the first (and passes --capture / --today)
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', (_e, argv) => { const c = commandFromArgs(argv); if (c) sendCommand(c); else if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

  app.whenReady().then(() => {
    // serve the bundled app from app://gsnotes/...
    protocol.handle(SCHEME, (req) => {
      const { pathname } = new URL(req.url);
      const file = path.normalize(path.join(APP_DIR, decodeURIComponent(pathname)));
      if (!file.startsWith(APP_DIR)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });

    // allow what a notes app needs; refuse camera, location, etc.
    const allowed = new Set(['notifications', 'clipboard-sanitized-write', 'fileSystem', 'fullscreen']);
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));

    // HTTP for AI providers and WebDAV, done here so browser CORS rules don't block local servers
    ipcMain.handle('gs:http', async (_e, req) => {
      try {
        const u = new URL(req.url);
        if (!/^https?:$/.test(u.protocol)) return { error: 'Only http and https are allowed' };
        const res = await net.fetch(u.toString(), { method: req.method || 'GET', headers: req.headers || {}, body: req.body ?? undefined, cache: 'no-store' });
        return { status: res.status, body: await res.text() };
      } catch (err) { return { error: String(err && err.message || err) }; }
    });
    ipcMain.handle('gs:version', () => app.getVersion());
    ipcMain.handle('gs:pick-folder', async (_e, current) => {
      const r = await dialog.showOpenDialog(win, { title: 'Choose a folder for GSNotes backups', defaultPath: current || path.join(app.getPath('documents'), 'GSNotes Backups'), properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    });
    ipcMain.handle('gs:backup-write', async (_e, { dir, name, data, keep }) => {
      try {
        if (!dir || !/^gsnotes-backup-[\w-]+\.json$/.test(name)) return { error: 'Invalid backup request' };
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), String(data));
        const old = fs.readdirSync(dir).filter((f) => /^gsnotes-backup-.*\.json$/.test(f)).sort().reverse();
        for (const f of old.slice(Math.max(1, +keep || 10))) fs.unlinkSync(path.join(dir, f));
        return { ok: true };
      } catch (err) { return { error: String(err.message || err) }; }
    });
    ipcMain.handle('gs:onenote', async (_e, paths) => importOneNote(paths));

    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [
        { label: 'Quick capture', accelerator: CAPTURE_HOTKEY, click: () => sendCommand('capture') },
        { label: 'Today’s note', click: () => sendCommand('today') },
        { label: 'Command palette', accelerator: 'CommandOrControl+K', registerAccelerator: false, click: () => sendCommand('palette') },
        { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      { label: 'Help', submenu: [{ label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) }, { label: `GSNotes ${app.getVersion()}`, enabled: false }] },
    ]));

    createWindow();
    const first = commandFromArgs(process.argv); if (first) pendingCommands.push(first);

    // system-wide quick capture (works on X11; on some Wayland desktops global hotkeys are refused)
    if (!globalShortcut.register(CAPTURE_HOTKEY, () => sendCommand('capture'))) console.warn('GSNotes: could not register', CAPTURE_HOTKEY);
  });

  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => { if (!win) createWindow(); });
}

// ---------------- OneNote import ----------------
// Converts OneNote files to HTML with the bundled converter (built from Joplin's MPL-2.0 onenote-converter),
// then hands the pages (HTML + their attachments as data URLs) to the page for conversion to Markdown.
function converterPath() {
  const name = process.platform === 'win32' ? 'gsnotes-onenote.exe' : 'gsnotes-onenote';
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, 'bin', name);
}
function unzipTo(zipFile, dest) {
  const buf = fs.readFileSync(zipFile);
  let eocd = buf.length - 22; while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('That .zip file is damaged or not a zip.');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Unsupported zip layout.');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const flags = buf.readUInt16LE(p + 8);
    const name = buf.slice(p + 46, p + 46 + nlen).toString(flags & 0x800 ? 'utf8' : 'latin1').replace(/\\/g, '/');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const out = path.normalize(path.join(dest, name));
    if (!out.startsWith(dest)) continue; // never write outside the temp folder
    const ds = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.slice(ds, ds + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, data);
  }
}
function walk(dir) { const out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }
function runConverter(input, outDir, baseDir) {
  return new Promise((resolve) => {
    execFile(converterPath(), [input, outDir, baseDir], { maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000 }, (err, _stdout, stderr) => {
      const warnings = String(stderr || '').split('\n').filter((l) => /^Warning:/.test(l)).length;
      resolve({ ok: !err, error: err ? (String(stderr || '').split('\n').find((l) => /^Error/.test(l)) || err.message) : null, warnings });
    });
  });
}
async function importOneNote(paths) {
  try {
    if (!fs.existsSync(converterPath())) return { error: 'The OneNote converter is missing from this installation.' };
    if (!paths || !paths.length) {
      const r = await dialog.showOpenDialog(win, { title: 'Import from OneNote', properties: ['openFile', 'multiSelections'], filters: [{ name: 'OneNote', extensions: ['onepkg', 'one', 'zip'] }] });
      if (r.canceled) return { cancelled: true };
      paths = r.filePaths;
    }
    paths = paths.filter((p) => /\.(onepkg|one|zip)$/i.test(p) && fs.existsSync(p));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsnotes-onenote-'));
    const work = path.join(tmp, 'in'), out = path.join(tmp, 'out'); fs.mkdirSync(work); fs.mkdirSync(out);
    const warnings = []; let warnCount = 0;
    try {
      for (const src of paths) {
        const stem = path.basename(src).replace(/\.[^.]+$/, '');
        const dir = path.join(work, stem); fs.mkdirSync(dir, { recursive: true });
        if (/\.zip$/i.test(src)) unzipTo(src, dir); else fs.copyFileSync(src, path.join(dir, path.basename(src)));
        const inputs = walk(dir).filter((f) => /\.(one|onepkg)$/i.test(f) && !/OneNote_RecycleBin/i.test(f));
        if (!inputs.length) warnings.push(`${path.basename(src)}: no OneNote sections found`);
        for (const f of inputs) {
          const target = path.join(out, path.relative(work, path.dirname(f)));
          fs.mkdirSync(target, { recursive: true });
          const r = await runConverter(f, target, path.dirname(f) + path.sep);
          warnCount += r.warnings;
          if (!r.ok) warnings.push(`${path.basename(f)}: ${r.error}`);
        }
      }
      const pages = [];
      const htmls = walk(out).filter((f) => /\.html$/i.test(f));
      for (const h of htmls) {
        if (fs.existsSync(h.replace(/\.html$/i, '')) && fs.statSync(h.replace(/\.html$/i, '')).isDirectory()) continue; // section / notebook index pages
        const dir = path.dirname(h); const files = {};
        const html = fs.readFileSync(h, 'utf8');
        for (const f of fs.readdirSync(dir)) {
          const p = path.join(dir, f); if (!fs.statSync(p).isFile() || /\.html$/i.test(f)) continue;
          if (!html.includes(f) && !html.includes(encodeURIComponent(f)) && !html.includes(encodeURI(f))) continue;
          const ext = (f.split('.').pop() || '').toLowerCase();
          const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', pdf: 'application/pdf' }[ext] || 'application/octet-stream';
          files[f] = `data:${mime};base64,` + fs.readFileSync(p).toString('base64');
        }
        const rel = path.relative(out, dir).split(path.sep).filter(Boolean);
        pages.push({ path: rel, name: path.basename(h, '.html'), html, files });
      }
      if (warnCount) warnings.push(`${warnCount} formatting detail${warnCount === 1 ? '' : 's'} could not be converted`);
      return { pages, warnings };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  } catch (err) { return { error: String(err.message || err) }; }
}
