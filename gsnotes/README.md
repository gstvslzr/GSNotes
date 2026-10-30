# GSNotes

A private, offline-first Markdown notes app, inspired by Joplin, built as an installable Progressive Web App (PWA). Everything is stored on your own device in the browser's IndexedDB. There is no server and no telemetry.

## Run it

The `dist/` folder is the complete app. It is plain static files, so any web server works. A PWA must be served over **https** or from **localhost** to install and work offline.

**On your computer (quickest)**

```bash
cd dist
python -m http.server 8080
# then open http://localhost:8080 in Chrome or Edge
```

**Hosted (to use it on your phone too)**

Upload the contents of `dist/` to any static host: GitHub Pages, Netlify, Cloudflare Pages, Azure Static Web Apps, or an IIS site with https.

**Install it:** open the app in Chrome or Edge and click the install icon in the address bar, or use **Settings → Install GSNotes**. On iPhone, use Safari → Share → Add to Home Screen.

Notes are stored per browser and per site address. If you move the app to a new address, take a backup first (**Settings → Download full backup**) and restore it at the new address.

## Features

### Core (parity with Joplin)

- Markdown editor with **Edit / Split / View** modes, a formatting toolbar, and list continuation.
- Nested notebooks, tags, tasks, and full-text search. Search accepts `tag:x`, `in:notebook`, `is:todo` and `is:done`.
- Trash with restore, plus permanent delete.
- Import Markdown files (front matter is read) and Evernote `.enex` exports.
- Export a note as `.md`, or download a full backup as `.json`.
- Light, dark, and system themes.
- A command palette (**Ctrl/⌘+K**) that runs every action.

### New features

| # | Feature | How it works |
|---|---|---|
| 1 | `[[Wiki links]]` + backlinks | Type `[[` for autocomplete. Clicking a link to a missing note creates it. The backlinks panel sits under each note. |
| 2 | Graph view | Shows notes and their links, optionally with tags. You can drag, zoom, and click a node to open the note. |
| 3 | Daily notes + templates | **Today** opens the daily note from the *Daily note* template. Any note in **Templates** becomes a template, with `{{date}} {{time}} {{weekday}} {{title}}` as placeholders. |
| 4 | Meaning (semantic) search | Uses embeddings from your AI provider. **Keyword** search (BM25 ranking, prefix matching) always works offline. |
| 5 | Ask my notes | Retrieves the best passages and, if an AI provider is set, writes an answer with `[n]` citations. Without a provider it shows the passages themselves. |
| 6 | Summarize / Suggest tags / Make cards | Uses AI when a provider is configured. Offline fallbacks are key-sentence extraction, distinctive-word tags, and cards built from definition lines. |
| 7 | Quick capture | **Alt+Q** inside the app. The installed app also gets a *Quick capture* shortcut on its icon. |
| 8 | Dictation | Web Speech API, with English and Spanish options. |
| 9 | OCR + PDF text | Tesseract.js reads text in images. pdf.js extracts PDF text, and scanned PDF pages are run through OCR. Both libraries load on first use. |
| 10 | Due dates + reminders | Reminders appear as browser notifications, or as in-app alerts if notifications are blocked. |
| 11 | Board + Calendar | A To do / In progress / Done board with drag-and-drop, and a month calendar of due tasks and daily notes. |
| 12 | Vault notebooks | AES-256-GCM encryption with a key derived from your password (PBKDF2-SHA256, 310,000 iterations). Titles, bodies, tags, versions, and attachments are all encrypted. |
| 13 | Version history | Saves a snapshot after ~90 s of editing, on Ctrl+S, and before any restore. Shows a line diff and can restore an old version. |
| 14 | Auto-lock | Vaults lock after N idle minutes (default 5). |
| 15 | Flashcards | Any `question :: answer` line becomes a card. Reviews use SM-2 spaced repetition. Shortcuts: Space shows the answer, 1–4 grades it. |
| 16 | Sync | **Folder sync** (Chrome/Edge): pick a folder inside OneDrive, a synced SharePoint library, Dropbox, or iCloud. **WebDAV** works with Nextcloud and similar servers. An optional passphrase encrypts the sync file end to end. |
| 17 | Publish | Exports a self-contained, read-only HTML page of a note, with images included. |

### Projects (new in 1.1)

A project is a table of items with typed fields, shown through as many saved views as you like.

- **Fields:** text, number (plain, currency or percent), select and multi-select (colored options), date, checkbox, and link. The title is always present.
- **Items are notes,** so links, search, backlinks, history and Publish all work on them. Opening an item shows its fields above the editor, with a button back to the project.
- **Views** (each keeps its own filters, sort and settings):
  - **Grid:** inline editing, click a header to sort, and a totals row.
  - **Kanban:** columns from a select field. Drag cards or use the arrow buttons.
  - **Calendar:** items placed by a date field.
  - **Timeline:** a bar from a start date to an end date, by week or month, with a line for today.
  - **Charts:** a dashboard of bar, horizontal bar, line, donut, and single-number charts. Each can count items, or sum or average a number field. Every chart has a Table toggle and hover/keyboard tooltips.
  - **Gallery:** cards with each item's first image.
- **Templates:** Project tracker, Expense tracker, Content calendar, Blank.
- **CSV:** export a view. Import a CSV as a new project, and review the guessed field types before importing.
- **Safety:** retyping or deleting fields warns before any value is cleared. Items moved into a vault are encrypted, including their field values, and show as locked rows while the vault is locked.
- First launch adds a sample project, *Home lab upgrade (sample)*. Delete it from **More → Delete project**.

### Backup, restore and import (new in 1.2)

Open **Backup & import** in the sidebar. An amber dot means you have no backup, or none in the last 7 days.

- **Back up now:** saves one `.json` file with everything. Vault notes stay encrypted inside it; set a sync passphrase to encrypt the whole file.
- **Export everything as Markdown (.zip):** one `.md` file per note in notebook folders, with attachments in `_resources/`.
- **Automatic backups:** writes a backup to a folder you choose every 6 hours, daily or weekly, keeping the newest 5–90.
  - The desktop app writes the folder itself.
  - In Chrome and Edge, the browser asks for folder permission again after a restart.
  - Choose a folder that OneDrive or Dropbox already syncs.
- **Restore:** shows what is in the backup next to what is on this device, then lets you choose:
  - **Merge:** keeps the newer copy of each note and deletes nothing.
  - **Replace everything:** asks you to confirm twice.
- **Import from Joplin:**
  - **`.jex` file** (File → Export all → JEX): notebooks, sub-notebooks, tags, to-dos with due dates, images and attachments, and links between notes (which become `[[wiki links]]`). HTML notes are converted to Markdown.
  - **Items encrypted with Joplin's end-to-end encryption are skipped and counted.** Export from a device where they are decrypted.
- **Import from OneNote:**
  - **Desktop app:** notebook packages (`.onepkg`, from OneNote's File → Export), section files (`.one`), and notebooks downloaded from OneDrive as `.zip`. Sections become notebooks, page dates are kept, and ink drawings come in as images.
    - This uses a converter built from Joplin's open-source OneNote converter (MPL-2.0), bundled with the app. Some formatting may be simplified.
  - **Web and desktop:** pages saved as Single File Web Page (`.mht`) or HTML, and Word (`.docx`) files.
- **Markdown folder:** a folder exported from Joplin (Markdown or Markdown + Front Matter), from Obsidian, or from any app. Sub-folders become notebooks; images, `![[embeds]]` and links between notes come along.
- **Also:** Evernote `.enex`, single Markdown files, and CSV (as a project).

## Limits

- **Reminders** fire only while GSNotes is open, as a tab or the installed app. Firing them while the app is closed would require a push server.
- **Quick capture** works inside the app and from the app icon's shortcut menu. Browsers do not allow a system-wide hotkey.
- **Dictation** in Chrome and Edge sends audio to the browser vendor's speech service. Firefox has no Web Speech recognition. On those systems, use the operating system's dictation instead: Win+H on Windows, or pressing Fn twice on Mac.
- **OneDrive/SharePoint** sync works through folder sync, using the OneDrive client's synced folder. Direct Microsoft Graph sync would need your own Azure app registration and is not built yet.
- **WebDAV** requires the server to allow cross-origin (CORS) requests from the app's address.
- **Evernote import** converts text and formatting. Embedded attachments are counted but not imported.
- **OneNote notebook files** (`.onepkg`, `.one`, `.zip`) import only in the desktop app. The web version imports `.mht`, `.html` and `.docx` pages.
- **The OneNote converter is built for 64-bit Linux** in this package. A Windows build would need its own converter binary.
- **Sync conflicts** are resolved note by note: the most recently edited version wins. The older edit is not merged in.
- **Vault passwords cannot be recovered.** If you forget one, the notes in that vault are permanently unreadable.
- **AI providers:** with an OpenAI-compatible API, note text is sent to that provider. Vault notes are only ever sent to a local Ollama model, never to a remote API.

## Desktop app (.deb for Debian / Ubuntu / Linux Mint, 64-bit Intel/AMD)

Install:

```bash
sudo apt install ./gsnotes_1.2.0_amd64.deb
```

Use `apt` rather than `dpkg -i` so missing libraries are installed automatically. Then open **GSNotes** from the app menu, or run `gsnotes` in a terminal.

To remove it:

```bash
sudo apt remove gsnotes
```

Your notes are kept in `~/.config/GSNotes` until you delete that folder.

**How the desktop app differs from the web version:**

- **Fully offline.** Libraries, fonts, and OCR data for English and Spanish are bundled. Nothing loads from the internet.
- **System-wide quick capture.** Press **Ctrl+Alt+N** from any app. Right-clicking the launcher also offers *Quick capture* and *Today's note*.
  - The global hotkey works on X11 sessions. Some Wayland desktops refuse global hotkeys; use the launcher action there instead.
- **Ollama and WebDAV need no CORS setup.** Requests go through the app itself, not through browser rules.
- **No dictation.** It depends on a speech service that only Chrome, Edge, and Safari provide.
- **Reminders** fire while the app is running.

**Package details:**

- Electron 44.5.1. Installs to `/opt/GSNotes` with a launcher in `/usr/bin/gsnotes`.
- On Ubuntu 23.10 and later, the installer adds an AppArmor profile. Chromium-based apps need it to start their sandbox on those releases.

**Rebuild the package:**

```bash
cd desktop
npm install
./build_deb.sh
```

The build needs `dpkg-deb` and Python with Pillow. Output goes to `desktop/deb/`.

## AI setup (optional)

**Ollama (local, private)**

1. Install Ollama.
2. Download the models:
   ```bash
   ollama pull llama3.2
   ollama pull nomic-embed-text
   ```
3. Start Ollama with the app's address allowed:
   ```bash
   OLLAMA_ORIGINS=* ollama serve
   ```
   On Windows, set `OLLAMA_ORIGINS` as a user environment variable instead.
4. In GSNotes, go to **Settings → AI**, choose *Ollama*, and click **Test connection**.

**OpenAI-compatible API**

Choose the provider and enter your API key. The defaults are `gpt-4o-mini` for chat and `text-embedding-3-small` for embeddings. Any server that speaks the `/chat/completions` and `/embeddings` API also works.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl/⌘+K | Command palette |
| Alt+N | New note |
| Alt+Q | Quick capture |
| / | Search |
| Ctrl/⌘+S | Save and snapshot a version |
| Ctrl/⌘+B / I | Bold / italic |
| Esc | Close dialog |
| Space, 1–4 | Show answer, grade card |

## Project layout

```
desktop/    Electron shell (main.js, preload.js), build_desktop.py, build_deb.sh
src/        source: style.css, shell.html, 01–09 *.js (concatenated in order)
build.py    builds dist/ (PWA) and preview/gsnotes.html (single-file preview)
dist/       index.html, manifest.webmanifest, sw.js, icons/
```

Rebuild after editing `src/`:

```bash
python3 build.py
```

The build needs Pillow for the icons. Third-party libraries load from the jsDelivr CDN at pinned versions and are cached by the service worker:

- marked 12.0.2
- DOMPurify 3.1.6
- pdf.js 3.11.174
- Tesseract.js 5.1.1
