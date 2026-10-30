#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2026 Gustavo Salazar
# Build gsnotes_<version>_amd64.deb from the web source.
# Needs: python3 + Pillow, node/npm (npm install once), dpkg-deb.
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p "require('./package.json').version")
ARCH=amd64
PKG=gsnotes
STAGE=deb/stage
OUT=deb/${PKG}_${VERSION}_${ARCH}.deb

python3 build_desktop.py
npx @electron/packager . GSNotes --platform=linux --arch=x64 --electron-version=44.5.1 \
  --out=out --overwrite --asar --icon=icon.png --executable-name=gsnotes \
  --ignore='^/out' --ignore='^/deb' --ignore='^/node_modules' --ignore='^/build_' --ignore='\.sh$' --ignore='^/bin' --ignore='^/onenote-cli' \
  --extra-resource=bin/gsnotes-onenote

rm -rf deb && mkdir -p "$STAGE"/{DEBIAN,opt,usr/bin,usr/share/applications,usr/share/doc/$PKG}
cp -a out/GSNotes-linux-x64 "$STAGE/opt/GSNotes"
chmod 4755 "$STAGE/opt/GSNotes/chrome-sandbox"   # setuid sandbox helper (owned by root in the package)
ln -s /opt/GSNotes/gsnotes "$STAGE/usr/bin/gsnotes"

# icons for menus and docks
for s in 48 64 128 256 512; do
  mkdir -p "$STAGE/usr/share/icons/hicolor/${s}x${s}/apps"
  python3 -c "from PIL import Image; Image.open('icon.png').resize(($s,$s), Image.LANCZOS).save('$STAGE/usr/share/icons/hicolor/${s}x${s}/apps/gsnotes.png')"
done

cat > "$STAGE/usr/share/applications/gsnotes.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=GSNotes
GenericName=Notes
Comment=Private, offline-first Markdown notes
Exec=/opt/GSNotes/gsnotes %U
Icon=gsnotes
Terminal=false
Categories=Office;Utility;TextEditor;
Keywords=notes;markdown;journal;todo;flashcards;
StartupWMClass=GSNotes
Actions=capture;today;

[Desktop Action capture]
Name=Quick capture
Exec=/opt/GSNotes/gsnotes --capture

[Desktop Action today]
Name=Today's note
Exec=/opt/GSNotes/gsnotes --today
EOF

# Ubuntu 23.10+ restricts unprivileged user namespaces; Chromium-based apps need this AppArmor profile.
cat > "$STAGE/opt/GSNotes/apparmor-profile" <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile gsnotes /opt/GSNotes/gsnotes flags=(unconfined) {
  userns,
  include if exists <local/gsnotes>
}
EOF

cat > "$STAGE/usr/share/doc/$PKG/copyright" <<EOF
GSNotes ${VERSION} — Copyright $(date +%Y) Gus Salazar. All rights reserved.
Bundled third-party software keeps its own license:
 Electron and Chromium (MIT/BSD; see /opt/GSNotes/LICENSE and LICENSES.chromium.html),
 marked (MIT), DOMPurify (Apache-2.0 or MPL-2.0), pdf.js (Apache-2.0),
 Tesseract.js and tesseract.js-core (Apache-2.0), Tesseract language data (Apache-2.0),
 mammoth (BSD-2-Clause), gsnotes-onenote built from Joplin's onenote-converter
 (MPL-2.0; source: https://github.com/laurent22/joplin/tree/dev/packages/onenote-converter),
 Atkinson Hyperlegible, Bricolage Grotesque and JetBrains Mono fonts (SIL OFL 1.1).
EOF

cat > "$STAGE/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
chmod 4755 /opt/GSNotes/chrome-sandbox || true
if [ -f /etc/apparmor.d/abi/4.0 ]; then
  cp /opt/GSNotes/apparmor-profile /etc/apparmor.d/gsnotes
  if command -v apparmor_parser >/dev/null 2>&1 && [ -d /sys/kernel/security/apparmor ]; then
    apparmor_parser --replace --write-cache --skip-read-cache /etc/apparmor.d/gsnotes || true
  fi
fi
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
exit 0
EOF

cat > "$STAGE/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  if [ -f /etc/apparmor.d/gsnotes ]; then
    command -v apparmor_parser >/dev/null 2>&1 && [ -d /sys/kernel/security/apparmor ] && apparmor_parser --remove /etc/apparmor.d/gsnotes 2>/dev/null || true
    rm -f /etc/apparmor.d/gsnotes
  fi
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
fi
exit 0
EOF
chmod 755 "$STAGE/DEBIAN/postinst" "$STAGE/DEBIAN/postrm"

SIZE=$(du -sk --exclude=DEBIAN "$STAGE" | cut -f1)
cat > "$STAGE/DEBIAN/control" <<EOF
Package: $PKG
Version: $VERSION
Architecture: $ARCH
Maintainer: Gus Salazar <gus.salazar66@gmail.com>
Installed-Size: $SIZE
Section: editors
Priority: optional
Homepage: https://github.com/laurent22/joplin
Depends: libgtk-3-0t64 | libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0t64 | libatspi2.0-0, libuuid1, libsecret-1-0, libgbm1, libasound2t64 | libasound2, libdrm2, libxkbcommon0
Description: Private, offline-first Markdown notes
 GSNotes is a desktop note-taking app inspired by Joplin. Notes are Markdown,
 stored on this computer, with notebooks, tags, tasks, wiki links and
 backlinks, a graph view, encrypted vault notebooks, version history,
 flashcards, a task board and calendar, offline text recognition (OCR),
 folder and WebDAV sync, and optional AI features through a local Ollama
 model or an OpenAI-compatible API.
EOF

dpkg-deb --root-owner-group -Zxz --build "$STAGE" "$OUT"
sha256sum "$OUT" | tee "$OUT.sha256"
ls -lh "$OUT"
