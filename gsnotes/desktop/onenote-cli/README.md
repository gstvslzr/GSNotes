# gsnotes-onenote

A command-line wrapper around the renderer in Joplin's `@joplin/onenote-converter` 3.7.1 (MPL-2.0; based on `onenote.rs` and `one2html` by msiemens). It is bundled in the GSNotes desktop app as `resources/gsnotes-onenote`.

## Build

1. Get the upstream source:
   ```bash
   npm pack @joplin/onenote-converter@3.7.1
   ```
   Then extract it.
2. Copy this `Cargo.toml` and `src/` into `package/cli/`.
3. Add `"cli"` to the workspace `members` in `package/Cargo.toml`.
4. Build:
   ```bash
   cargo build --release -p gsnotes-onenote
   ```
5. Strip the binary and copy it to `desktop/bin/`.

The upstream source files are unmodified apart from that one workspace line, and remain under the MPL-2.0 licence in `LICENSE-MPL-2.0`.
