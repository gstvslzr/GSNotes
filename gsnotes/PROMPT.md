# Build GSNotes — a private, offline-first Markdown notes app

## Role
You are a senior full-stack engineer and product designer. Build a complete, working app, not a mockup. Run it and check that it works before you call it done.

## What GSNotes is
GSNotes is a personal note-taking app in the spirit of Joplin and OneNote. It is for one user who writes in English and Spanish and works on Windows, Linux and a phone. Notes are plain Markdown, stored on the user's own device. There is no account, no server and no telemetry.

## Deliverables
1. An installable PWA: static files (index.html, manifest.webmanifest, sw.js, and icons at 192, 512 and maskable 512). It must work offline after the first load.
2. A Linux desktop app: an Electron wrapper around the same code, packaged as an amd64 .deb with a launcher, icons and quick actions.
3. One source tree, plus a build script that produces both deliverables from it.
4. A README covering how to run and install the app, the features, keyboard shortcuts, known limits and rebuild steps.
5. A test report saying what you verified by actually running it and what you could not verify.

## Technical constraints
- **Code:** vanilla JavaScript (ES2022) and CSS. No framework, and no build step needed just to run it. Split the source into numbered modules that the build concatenates in order.
- **Libraries:** pin exact versions:
  - marked 12.0.2
  - DOMPurify 3.1.6
  - pdf.js 3.11.174
  - Tesseract.js 5.1.1

  Load pdf.js and Tesseract only when first used. Sanitize all rendered Markdown with DOMPurify.
- **Storage:** IndexedDB, with these stores: notes, folders, versions, cards, resources and meta. If IndexedDB fails, fall back to in-memory storage and show a visible warning that notes will not be saved.
- **Web version:** load libraries from jsDelivr, and cache them in the service worker.
- **Desktop version:** bundle everything (libraries, fonts, and OCR data for English and Spanish) and load nothing from the internet.
- **Desktop security and behavior:**
  - Serve the app from a custom secure scheme (app://gsnotes) so that Web Crypto and IndexedDB behave as they do over https.
  - Turn contextIsolation on, nodeIntegration off and the sandbox on, and set a strict Content Security Policy.
  - Allow only one running instance.
  - Open external links in the system browser.
  - Send HTTP requests for AI providers and WebDAV through the main process, so that browser CORS rules do not block local servers.

## Data model
- **note:** id, folderId, title, body (Markdown), tags[], isTodo, status (todo | doing | done), done, due (YYYY-MM-DD), remindAt (local datetime), reminded, createdAt, updatedAt, deleted (0 or a timestamp)
- **folder:** id, name, parentId, vault (boolean), salt, check (an encrypted known value)
- **version:** id, noteId, at, title, body (or enc for vault notes)
- **card:** id (noteId + hash of the question), noteId, front, back, ef, interval, reps, lapses, due
- **resource:** id, noteId, name, mime, data (a data URL, or enc for vault notes)
- **project:** id, name, icon, description, fields[] (id, name, type, options[] with colors, number format), views[] (id, name, type, config), createdAt, updatedAt
- **note (project item):** a normal note plus projectId and props (field id → value). Props are encrypted with the rest of the note when it sits in a vault.
- **meta:** settings, and tombstones (ids of deleted notes and projects, used by sync)
- **Export format:** Markdown with YAML front matter: title, id, notebook, tags, created, updated, and the task fields.

## Core features (parity with Joplin)
- **Layout:** three panes (navigation rail, note list, editor).
- **Editor:** Edit, Split and View modes. The toolbar has bold, italic, heading, checklist, code, [[link]] and flashcard line. Pressing Enter continues a list. Clicking a checkbox in the preview updates the Markdown source.
- **Organization:** nested notebooks, tags, tasks, and a trash with restore and permanent delete.
- **Search:**
  - Rank results with BM25, with prefix matching and highlighted snippets.
  - Support the operators tag:, in:, is:todo and is:done.
- **Import:**
  - Markdown files, reading their front matter.
  - Evernote .enex files, keeping text and formatting and reporting how many attachments were skipped.
- **Export and backup:** export a note as .md, and back up or restore everything as JSON.
- **Themes:** match system, light and dark.
- **Command palette:** Ctrl/⌘+K, listing every action plus note titles.

## New features, each with how to test it
1. **Wiki links and backlinks.**
   - Typing `[[` opens autocomplete.
   - Clicking a link to a note that doesn't exist creates that note.
   - A backlinks panel sits under each note. Links inside code are ignored.
   - Test: link note A to note B, and B lists A as a backlink.
2. **Graph view.**
   - A force-directed canvas: notes are nodes, links are edges, and tags can be shown.
   - The user can pan, zoom and drag, and clicking a node opens the note.
   - Colors follow the theme.
3. **Daily notes and templates.**
   - "Today" opens or creates a note titled YYYY-MM-DD in the Daily notebook, using the "Daily note" template.
   - Any note in the Templates notebook is a template.
   - Placeholders: {{date}}, {{time}}, {{weekday}}, {{title}}.
4. **Meaning (semantic) search.**
   - Rank notes by cosine similarity of embeddings from the configured AI provider.
   - Keyword search always works offline.
5. **Ask my notes.**
   - Split notes into chunks and retrieve the top passages, using embeddings if available and BM25 otherwise.
   - With an AI provider, answer only from those passages, with [n] citations that open the source note.
   - Without one, show the passages themselves.
6. **Summarize, Suggest tags, Make cards.**
   - Use AI when it is configured.
   - Offline fallbacks: key-sentence extraction for summaries, TF-IDF keywords for tags, and cards built from "**Term** — definition" lines and headings.
   - Results appear in a panel with Insert or Add buttons. Never change the note without a click.
7. **Quick capture.**
   - Alt+Q inside the app opens a capture box. The first line becomes the title.
   - It saves to the Inbox, optionally as a task with a due date.
   - Desktop app: a system-wide Ctrl+Alt+N hotkey, plus launcher actions `--capture` and `--today`.
8. **Dictation.**
   - Use the Web Speech API, with the languages en-US, es-US, es-ES, es-MX and en-GB.
   - Tell the user plainly that Chrome and Edge send the audio to the browser maker's speech service.
   - In the desktop app, show a clear "not available" message instead of failing silently.
9. **OCR and PDF text.**
   - Images: embed the image and put its recognized text in a collapsible "Text in image" block, so search finds it.
   - PDFs: extract the text page by page, and run OCR on pages that have no text layer (at most 15 pages).
   - Languages: eng, spa, and eng+spa.
   - Pasting an image into the editor attaches it.
10. **Due dates and reminders.**
    - Show a notification when the user allows it, and an in-app message otherwise.
    - Each reminder fires once.
11. **Board and Calendar.**
    - Board: To do, In progress and Done columns, with drag-and-drop and arrow buttons.
    - Calendar: a month view of due tasks and daily notes. Clicking an empty spot on a day creates a task due that day.
12. **Vault notebooks.**
    - Encryption: AES-256-GCM, with the key derived from the password by PBKDF2-SHA256 at 310,000 iterations. Use a random 16-byte salt per vault and a fresh 12-byte IV per record.
    - Encrypt the title, body, tags, task fields, versions and attachments.
    - Keep the key only in memory. Detect a wrong password by trying to decrypt a stored check value.
    - Vault notes may go to a local AI model, never to a remote API.
    - Test: inspect IndexedDB and confirm that no plaintext is stored.
13. **Version history.**
    - Save a snapshot after about 90 seconds of editing, on Ctrl+S, and before any restore.
    - Show a line diff (LCS) and allow restoring an old version.
14. **Auto-lock.** Lock all vaults after N idle minutes (default 5). Also offer a manual "Lock all vaults" button.
15. **Flashcards.**
    - Every `question :: answer` line is a card. Skip code, vault notes and templates.
    - Schedule reviews with SM-2. Space shows the answer and 1–4 grades it.
    - Group decks by tag, and show the due-card count in the navigation.
16. **Sync.**
    - Merge note by note: the newer updatedAt wins, and tombstones carry deletions across devices.
    - Folder sync uses the File System Access API. It writes gsnotes-sync.json plus one .md file per note, for use inside OneDrive, SharePoint, Dropbox or iCloud folders.
    - WebDAV sync uses GET and PUT with Basic authentication.
    - An optional sync passphrase encrypts the whole sync file end to end.
17. **Publish.**
    - Export one note as a self-contained, read-only HTML page: images inlined, wiki links as plain text, light and dark themes.
    - Warn the user if the note comes from a vault.

## Projects: databases with multiple views
18. **Projects.** A project is a table of items with typed fields, shown through any number of saved views. Think of a Notion database, built into GSNotes.
    - **Fields:** text, number (plain, currency or percent), select and multi-select (options with colors), date, checkbox and URL. The title field is always present. Fields can be added, renamed, reordered, retyped and deleted. Retyping converts values where possible and never silently discards data without a warning.
    - **Items are notes.** Every item has a Markdown body, so links, search, backlinks, history and Publish all work on items. Opening an item shows its fields above the editor, with a button back to the project.
    - **Views.** Views appear as tabs. Each view stores its own filters, sort and settings. A project can have several views of the same type.
      - **Grid:** a spreadsheet-style table. Edit cells inline, click a column header to sort, and see a totals row: sum and average for numbers, count for checkboxes and filled cells.
      - **Kanban:** one column per option of a chosen select field, plus "No value". Drag a card, or use its arrow buttons, to change the value. Each card shows the fields the user picks; each column shows its count. Adding an item inside a column presets that value.
      - **Calendar:** items placed by a chosen date field on a month grid. Clicking an empty spot on a day adds an item on that date.
      - **Timeline:** a bar from a start-date field to an end-date field, at a week or month scale, with a line marking today. Items missing a date are listed separately.
      - **Charts:** a dashboard of chart cards. Each card picks a type (bar, horizontal bar, line over time, donut, or single number); a group-by field (select, multi-select, checkbox, text, or date by month); and a measure (count of items, or sum or average of a number field).
        - Follow good chart practice: one value axis, a fixed categorical color order, a legend for two or more series, donuts only for six segments or fewer, a hover and keyboard tooltip, and a table toggle so no value depends on color or hover.
      - **Gallery:** cards showing the item's first image, its title and chosen fields.
    - **Filters and search:** each view has filters (field, operator, value, with all filters required to match) and a quick text search over item titles.
    - **Templates:** Blank, Project tracker, Expense tracker and Content calendar. Each template creates suitable fields and views. First launch seeds one clearly labeled sample project.
    - **CSV:** export the current view's rows to CSV. Import a CSV as a new project, inferring field types (number, date, checkbox, select when there are few distinct values, otherwise text).
    - **Integration:** backup, sync and wipe include projects. Items in a locked vault appear as locked rows. Deleting a project moves its items to the trash.
    - **Test:**
      - Create a project from a template and add items.
      - Change a value in Grid, then confirm Kanban, Calendar, Timeline and Charts all reflect it.
      - Drag a card on Kanban and confirm the Grid value and the chart totals change.
      - Export a CSV, re-import it, and confirm the field types and row count match.

## Backup, restore and import
19. **Backup & import page.** Put it in the main sidebar, with an amber marker when there has been no backup in 7 days.
    - **Back up now:** a single JSON file. Vault notes stay encrypted, and a sync passphrase encrypts the whole file.
    - **Export everything as Markdown:** a .zip with notebook folders and an `_resources` folder.
    - **Automatic backups:** to a chosen folder every 6 hours, daily or weekly, keeping the newest N files.
    - **Restore:** preview the backup's contents next to this device's, then Merge (newer wins, nothing deleted) or Replace everything (confirm twice).
20. **Importers.**
    - **Joplin .jex:** a tar archive of Joplin raw items. Recreate notebooks, tags, to-dos, resources and note links. Skip end-to-end-encrypted items and report how many.
    - **OneNote:** .onepkg, .one and OneDrive .zip in the desktop app, using a native build of Joplin's MPL-2.0 onenote-converter. .mht, .html and .docx everywhere.
    - **Markdown folder:** Joplin, Obsidian or any app. Folders become notebooks; links and images are resolved.
    - **Also:** Evernote .enex and CSV.
    - **Test:** run each importer on a real sample file, and check the notebooks, tags, images, links and dates it creates.

## Design
- **Overall feel:** modern, calm and keyboard-first. Avoid generic AI-template looks.
- **Fonts:** Atkinson Hyperlegible for body text, Bricolage Grotesque for headings, JetBrains Mono for code and data.
- **Color:** define colors as CSS tokens, with complete light and dark sets.
- **Responsive:** down to 390 px wide.
  - Panes become one stacked view with back buttons.
  - The page never scrolls sideways; the toolbar scrolls sideways on phones.
- **Copy:**
  - Every empty state says what to do next.
  - Every error says what went wrong and how to fix it.
- **First launch:** seed clearly labeled sample notes that demonstrate links, flashcards, tasks, templates and a daily note.

## Platform limits to state in the app and README
- A PWA cannot:
  - fire reminders while it is fully closed;
  - register a system-wide hotkey;
  - call servers that block cross-origin requests. For Ollama, set OLLAMA_ORIGINS; for WebDAV, the server must allow CORS.
- Folder sync works only in Chrome and Edge.
- A lost vault password means that vault's notes cannot be recovered.
- Sync conflicts are resolved per note: the most recent edit wins and the other edit is not merged in.

## Quality bar
- Before delivering, run the app in a real headless browser, and run the desktop build under a virtual display. Exercise all of the following:
  - creating, editing and linking notes
  - search
  - checklist toggling
  - board, calendar and graph
  - flashcard review
  - vaults: create, lock, unlock, and a wrong password being rejected
  - confirming vault notes are encrypted at rest
  - quick capture, the command palette and the daily note
  - a backup round trip
  - an encrypted sync merge
  - Projects: every view, Kanban drag, chart totals matching the Grid, and a CSV round trip
  - OCR on a test image
  - notes persisting after a restart
  - the 390 px layout
- There must be no console errors, and the desktop build must make no remote requests.
- Report results as two lists: verified, and not verified (with the reason). Do not claim anything works that you did not run.

## Working rules
- Ask me only when something blocks you. Otherwise make a sensible choice and note it.
- Don't invent library APIs or versions; check them.
- Deliver the PWA first, then the desktop package.
