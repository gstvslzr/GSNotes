// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 Gustavo Salazar
// Narrow bridge between the GSNotes page and the desktop shell.
const { contextBridge, ipcRenderer } = require('electron');

let version = '';
ipcRenderer.invoke('gs:version').then((v) => { version = v; });

contextBridge.exposeInMainWorld('gsDesktop', {
  get version() { return version; },
  http: (req) => ipcRenderer.invoke('gs:http', {
    url: String(req.url), method: String(req.method || 'GET'),
    headers: Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [String(k), String(v)])),
    body: req.body == null ? null : String(req.body),
  }),
  pickFolder: (current) => ipcRenderer.invoke('gs:pick-folder', current ? String(current) : ''),
  backupWrite: (req) => ipcRenderer.invoke('gs:backup-write', { dir: String(req.dir || ''), name: String(req.name), data: String(req.data), keep: Number(req.keep) || 10 }),
  oneNote: (paths) => ipcRenderer.invoke('gs:onenote', Array.isArray(paths) ? paths.map(String) : null),
  onCommand: (fn) => ipcRenderer.on('gs:command', (_e, cmd) => fn(String(cmd))),
});
