#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2026 Gustavo Salazar
# MyGSNotes+ 26.10.03 setup for Linux — © 2026 Gustavo Salazar. All rights reserved.
#
#   bash mygsnotes-setup.sh              install (or reinstall / update) MyGSNotes+
#   bash mygsnotes-setup.sh check        check the installation and test that the window opens
#   bash mygsnotes-setup.sh uninstall    remove MyGSNotes+ (your notes are kept unless you choose otherwise)
#
# Keep this file in the same folder as the 5 files mygsnotes-plus_26.10.03_amd64.deb.part0 … part4.
# Run it as your normal user, from a terminal on your desktop. Do not use sudo; it asks when needed.
SELF="$(readlink -f "${BASH_SOURCE[0]}")"
run_part() {  # extract one embedded part of this file and run it
  local tmp; tmp="$(mktemp /tmp/mygsnotes-setup.XXXXXX.sh)"
  sed -n "/^#__$1_BEGIN__\$/,/^#__$1_END__\$/p" "$SELF" | sed '1d;$d' > "$tmp"
  MYGS_SELF="$SELF" MYGS_HERE="$(dirname "$SELF")" bash "$tmp"; local rc=$?
  rm -f "$tmp"; return $rc
}
case "${1:-install}" in
  install|"")          run_part INSTALL ;;
  check|verify)        run_part CHECK ;;
  uninstall|remove)    run_part UNINSTALL ;;
  -h|--help|help)      sed -n '2,9p' "$SELF" | sed 's/^# \{0,1\}//' ;;
  *) echo "Unknown option '$1'. Use: bash mygsnotes-setup.sh [install|check|uninstall]"; exit 2 ;;
esac
exit $?
#__INSTALL_BEGIN__
# MyGSNotes+ 26.10.03 installer — © 2026 Gustavo Salazar
# Usage: put this file and the 5 .part files in one folder (e.g. Downloads), then run:  bash mygsnotes-setup.sh
set -uo pipefail
VERSION="26.10.03"
DEB="mygsnotes-plus_${VERSION}_amd64.deb"
SHA="dd1681eca6d257002eb71e69fe295b670a1a7f444de97e1c7f1d8cea0a0aba83"
APP="/opt/MyGSNotesPlus/mygsnotes-plus"
LINK="/usr/bin/mygsnotes-plus"

ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
info() { printf '\n\033[1m%s\033[0m\n' "$*"; }
REPORT="$HOME/mygsnotes-install-report.txt"
report() {
  {
    echo "MyGSNotes+ install report  $(date)"
    echo "--- system";        grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release; uname -r; dpkg --print-architecture
    echo "--- package";       dpkg-query -W -f='${Status} ${Version}\n' mygsnotes-plus 2>&1
    echo "--- files dpkg says it installed under /opt (count, first 3)"; dpkg -L mygsnotes-plus 2>&1 | grep -c '^/opt'; dpkg -L mygsnotes-plus 2>&1 | grep '^/opt' | head -3
    echo "--- what is really on disk"; ls -ld /opt /opt/MyGSNotesPlus 2>&1; ls -la /opt/MyGSNotesPlus/mygsnotes-plus /usr/bin/mygsnotes-plus 2>&1; ls /opt 2>&1
    echo "--- /opt filesystem"; findmnt -T /opt 2>&1; df -h /opt 2>&1
    echo "--- dpkg path filters"; grep -rs 'path-' /etc/dpkg/dpkg.cfg /etc/dpkg/dpkg.cfg.d/ 2>&1 || echo none
    echo "--- diversions";    dpkg-divert --list 2>/dev/null | grep -i gsnotes || echo none
    echo "--- other GSNotes packages"; dpkg -l 2>/dev/null | grep -i gsnotes
    echo "--- apt log (last install)"; grep -A3 'mygsnotes' /var/log/apt/history.log 2>/dev/null | tail -8
  } > "$REPORT" 2>&1
}
fail() { printf '\n  \033[31m✘ %s\033[0m\n' "$*"; if [ "${STEP:-0}" -ge 4 ]; then report; printf '\n  A report was saved to %s\n  Please open it and paste its contents to Claude (or send the file).\n' "$REPORT"; fi; echo; exit 1; }
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

echo
echo "  MyGSNotes+ ${VERSION} installer"
echo "  © 2026 Gustavo Salazar"

info "1/5  Checking this computer"
[ "$(uname -s)" = "Linux" ] || fail "This installer is for Linux."
[ "$(dpkg --print-architecture 2>/dev/null)" = "amd64" ] || fail "This package is for 64-bit Intel/AMD (amd64) computers. This one reports: $(dpkg --print-architecture 2>/dev/null || uname -m)."
command -v apt-get >/dev/null || fail "apt was not found. This installer needs Ubuntu, Debian, Linux Mint, Pop!_OS or another apt-based system."
ok "Linux, amd64, apt available"

info "2/5  Finding the package files"
HERE="${MYGS_HERE:-$PWD}"
SRC=""
for d in "$HERE" "$PWD" "$HOME/Downloads"; do
  if [ -f "$d/$DEB" ] || [ -f "$d/$DEB.part0" ]; then SRC="$d"; break; fi
done
[ -n "$SRC" ] || fail "Could not find $DEB or $DEB.part0 … part4. Put them in the same folder as mygsnotes-setup.sh."
WORK="$(mktemp -d /tmp/mygsnotes-install.XXXXXX)"; chmod 755 "$WORK"
trap 'rm -rf "$WORK"' EXIT
if [ -f "$SRC/$DEB.part0" ]; then
  missing=""; for i in 0 1 2 3 4; do [ -f "$SRC/$DEB.part$i" ] || missing="$missing part$i"; done
  [ -z "$missing" ] || fail "Missing:$missing. Download all 5 parts (part0 to part4) into $SRC."
  cat "$SRC/$DEB.part"{0,1,2,3,4} > "$WORK/$DEB"
  ok "Joined 5 parts from $SRC"
else
  cp "$SRC/$DEB" "$WORK/$DEB"; ok "Found $SRC/$DEB"
fi
chmod 644 "$WORK/$DEB"

info "3/5  Checking the download is complete and unchanged"
got="$(sha256sum "$WORK/$DEB" | cut -d' ' -f1)"
[ "$got" = "$SHA" ] || fail "Checksum does not match. A part is incomplete or corrupted; download the parts again.
     expected $SHA
     got      $got"
ok "SHA-256 matches"

STEP=4; info "4/5  Installing (your password may be asked for)"
if [ "$(id -u)" -ne 0 ] && pgrep -u "$USER" -f '(^|/)mygsnotes-plus( |$)' >/dev/null; then
  pkill -u "$USER" -f '(^|/)mygsnotes-plus( |$)'; sleep 2; pkill -9 -u "$USER" -f '(^|/)mygsnotes-plus( |$)' 2>/dev/null
  ok "Closed the running MyGSNotes+ (notes are saved as you type)"
fi
$SUDO apt-get update -qq || echo "  (could not refresh the package list; trying with the current one)"
$SUDO apt-get install -y --reinstall "$WORK/$DEB" || fail "apt could not install the package. The messages above say why. Run 'sudo apt-get -f install' and then this installer again."
ok "Package installed"

info "5/5  Checking the installation"
[ "$(dpkg-query -W -f='${Status} ${Version}' mygsnotes-plus 2>/dev/null)" = "install ok installed $VERSION" ] || fail "dpkg does not report mygsnotes-plus $VERSION as installed."
ok "dpkg reports mygsnotes-plus $VERSION installed"
if [ ! -x "$APP" ]; then
  if $SUDO test -x "$APP"; then
    echo "  ! The program is installed but its folder is not readable by your user. Fixing permissions…"
    $SUDO chmod -R go+rX /opt/MyGSNotesPlus
  fi
fi
if [ ! -x "$APP" ]; then
  echo "  ! $APP is missing after apt finished. Unpacking it directly from the verified package…"
  mkdir -p "$WORK/x" && dpkg-deb -x "$WORK/$DEB" "$WORK/x" \
    && $SUDO mkdir -p /opt && $SUDO cp -a "$WORK/x/opt/MyGSNotesPlus" /opt/ \
    && $SUDO chown -R root:root /opt/MyGSNotesPlus && $SUDO chmod 4755 /opt/MyGSNotesPlus/chrome-sandbox \
    && sync
  [ -x "$APP" ] || fail "$APP is still missing, even after copying it directly into /opt."
  ok "Program files placed directly in /opt/MyGSNotesPlus"
fi
ok "Program: $APP"
if [ -x "$LINK" ] && { [ "$(readlink -f "$LINK")" = "$APP" ] || grep -qs "exec $APP" "$LINK"; }; then ok "Terminal command: mygsnotes-plus"
else
  printf '#!/bin/sh\nfor a in "$@"; do if [ "$a" = "--safe-mode" ] && [ -n "${DISPLAY:-}" ]; then set -- "$@" --ozone-platform=x11; break; fi; done\nexec %s "$@"\n' "$APP" | $SUDO tee "$LINK" >/dev/null && $SUDO chmod 755 "$LINK" && ok "Created the terminal command $LINK" || fail "Could not create $LINK."
fi
[ -f /usr/share/applications/mygsnotes-plus.desktop ] && ok "App-menu entry: MyGSNotes+"
DATA="$HOME/.config/MyGSNotesPlus"
if [ "$(id -u)" -ne 0 ] && [ -d "$DATA" ] && [ -n "$(find "$DATA" ! -user "$(id -un)" -print -quit 2>/dev/null)" ]; then
  $SUDO chown -R "$(id -un)":"$(id -gn)" "$DATA" && ok "Gave your settings folder back to you ($DATA had files owned by another user, which stops the app from opening)"
else ok "Settings folder: yours"; fi
command -v update-desktop-database >/dev/null && $SUDO update-desktop-database -q /usr/share/applications 2>/dev/null
hash -r 2>/dev/null

echo
printf '  \033[32m\033[1mMyGSNotes+ %s is installed.\033[0m\n\n' "$VERSION"
echo "  Open it:   app menu → MyGSNotes+    or type:  mygsnotes-plus"
echo "  Help:      press F1 inside the app"
echo "  Your notes: ~/.config/MyGSNotesPlus (kept if you uninstall)"
echo "  Uninstall: bash mygsnotes-setup.sh uninstall"
echo
echo "  Check it any time: bash mygsnotes-setup.sh check"
echo
if [ -n "${MYGS_SELF:-}" ] && [ "$(id -u)" -ne 0 ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  info "Opening MyGSNotes+ to confirm it starts…"
  bash "$MYGS_SELF" check </dev/null
fi

#__INSTALL_END__
#__CHECK_BEGIN__
# MyGSNotes+ installation check — © 2026 Gustavo Salazar
# Usage:  bash mygsnotes-setup.sh check        (run as your normal user, not with sudo)
# Checks the installed files, then starts MyGSNotes+ and watches whether its window appears.
# Everything is also written to ~/mygsnotes-verify-report.txt.
set -uo pipefail
APP=/opt/MyGSNotesPlus/mygsnotes-plus
PAT='(^|/)mygsnotes-plus( |$)'   # matches the app however it was started
DIR=/opt/MyGSNotesPlus
DATA="$HOME/.config/MyGSNotesPlus"
REPORT="$HOME/mygsnotes-verify-report.txt"
LOG="$(mktemp /tmp/mygsnotes-run.XXXXXX.log)"
PROBLEMS=0
: > "$REPORT"
say()  { printf '%s\n' "$*"; printf '%s\n' "$*" | sed 's/\x1b\[[0-9;]*m//g' >> "$REPORT"; }
ok()   { say "  $(printf '\033[32m✔\033[0m') $*"; }
bad()  { say "  $(printf '\033[31m✘\033[0m') $*"; PROBLEMS=$((PROBLEMS+1)); }
note() { say "  • $*"; }
head_() { say ""; say "$(printf '\033[1m')$*$(printf '\033[0m')"; }

if [ "$(id -u)" -eq 0 ]; then echo "Run this as your normal user (without sudo): bash mygsnotes-setup.sh check"; exit 1; fi

say "MyGSNotes+ installation check — $(date)"
say "User: $USER   System: $(grep -E '^PRETTY_NAME=' /etc/os-release | cut -d= -f2 | tr -d '"')   Kernel: $(uname -r)"
say "Session: ${XDG_SESSION_TYPE:-unknown} ${XDG_CURRENT_DESKTOP:-}   DISPLAY=${DISPLAY:-none}   WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-none}"

head_ "1. Package"
st="$(dpkg-query -W -f='${Status} ${Version}' mygsnotes-plus 2>/dev/null)"
if [[ "$st" == "install ok installed"* ]]; then ok "Installed: mygsnotes-plus ${st##* }"; else bad "Package not installed (dpkg says: ${st:-nothing}). Run: bash mygsnotes-setup.sh"; fi

head_ "2. Program files"
if [ -d "$DIR" ]; then
  perm="$(stat -c '%A %U' "$DIR")"
  if [ -r "$DIR" ] && [ -x "$DIR" ]; then ok "Folder $DIR is readable ($perm)"; else bad "Folder $DIR is locked ($perm). Fix: sudo chmod -R go+rX $DIR"; fi
else bad "$DIR does not exist"; fi
if [ -x "$APP" ]; then ok "Program can be run by $USER"; else bad "$APP cannot be run by $USER"; fi
sb="$DIR/chrome-sandbox"
if [ -e "$sb" ]; then
  sbp="$(stat -c '%a %U' "$sb" 2>/dev/null)"
  if [ "$sbp" = "4755 root" ]; then ok "Sandbox helper: 4755 root"; else bad "Sandbox helper is '$sbp' (needs 4755 root). Fix: sudo chown root:root $sb && sudo chmod 4755 $sb"; fi
fi
L=/usr/bin/mygsnotes-plus
if [ -x "$L" ] && { [ "$(readlink -f "$L")" = "$APP" ] || grep -qs "exec $APP" "$L"; }; then ok "Terminal command: mygsnotes-plus"; else bad "Terminal command missing. Fix: bash mygsnotes-setup.sh (reinstall)"; fi

head_ "3. App menu"
DF=/usr/share/applications/mygsnotes-plus.desktop
if [ -f "$DF" ]; then
  ok "Menu entry: $DF"
  if command -v desktop-file-validate >/dev/null; then
    v="$(desktop-file-validate "$DF" 2>&1 | grep -v hint)"; [ -z "$v" ] && ok "Menu entry is valid" || bad "Menu entry problems: $v"
  fi
  [ -f /usr/share/icons/hicolor/256x256/apps/mygsnotes-plus.png ] && ok "Icon installed" || note "Icon file not found in hicolor/256x256 (the menu may show a generic icon)"
  note "If MyGSNotes+ is not in the app menu yet, log out and back in once."
else bad "Menu entry missing: $DF"; fi

head_ "4. Security settings that can stop Chromium-based apps"
r="$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo n/a)"
note "kernel.apparmor_restrict_unprivileged_userns = $r"
if [ -f /etc/apparmor.d/mygsnotes-plus ]; then ok "AppArmor profile installed"; else note "No AppArmor profile in /etc/apparmor.d (the sandbox helper above is used instead)"; fi
note "AppArmor ABI files: $(ls /etc/apparmor.d/abi 2>/dev/null | tr '\n' ' ')"

head_ "5. Your settings folder"
if [ -d "$DATA" ]; then
  own="$(stat -c '%U' "$DATA")"
  if [ "$own" = "$USER" ]; then ok "$DATA belongs to you"; else bad "$DATA belongs to '$own', so MyGSNotes+ cannot save. This happens after running it with sudo. Fix: sudo chown -R $USER:$USER $DATA"; fi
  rootfiles="$(find "$DATA" ! -user "$USER" 2>/dev/null | head -3)"; [ "$own" != "$USER" ] || [ -z "$rootfiles" ] || bad "Some files in $DATA belong to another user, e.g. $rootfiles. Fix: sudo chown -R $USER:$USER $DATA"
else note "$DATA does not exist yet (normal before the first start)"; fi

head_ "6. Copies already running"
pids="$(pgrep -u "$USER" -f "$PAT" | tr '\n' ' ')"
if [ -n "$pids" ]; then
  note "MyGSNotes+ is already running (process $pids). A copy without a window would swallow every new start."
  if [ -t 0 ]; then
    read -r -p "  Close the running copy so it can be tested fresh? [Y/n] " a
    case "${a:-y}" in [Yy]*) pkill -u "$USER" -f "$PAT"; sleep 2; pkill -9 -u "$USER" -f "$PAT" 2>/dev/null; ok "Closed";; *) note "Left running; the start test below will hand over to it";; esac
  fi
else ok "No copy running"; fi

launch_test() {  # $1 = extra args, $2 = label
  : > "$LOG"
  local run="$APP"; [ -x /usr/bin/mygsnotes-plus ] && run=/usr/bin/mygsnotes-plus   # the launcher adds X11 in safe mode
  nohup "$run" $1 >"$LOG" 2>&1 &
  local pid=$! t=0 verdict=""
  while [ $t -lt 25 ]; do
    sleep 1; t=$((t+1))
    if grep -q "page drawn, showing window" "$LOG"; then verdict="shown"; break; fi
    if grep -q "showing the window anyway" "$LOG"; then   # slow first draw: give it 15 more seconds
      local w=0; while [ $w -lt 15 ] && ! grep -q "page drawn, showing window" "$LOG"; do sleep 1; w=$((w+1)); done
      if grep -q "page drawn, showing window" "$LOG"; then verdict="shown"; else verdict="forced"; fi; break; fi
    if grep -q "already running" "$LOG"; then verdict="other"; break; fi
    kill -0 $pid 2>/dev/null || { verdict="exited"; break; }
  done
  [ -z "$verdict" ] && verdict="silent"
  { echo "  --- $2: program output"; grep -v "dbus/" "$LOG" | head -40 | sed "s/^/    /"; } >> "$REPORT"
  echo "$verdict"
}

head_ "7. Start test"
if [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then bad "No graphical session in this terminal. Run the check from a terminal on your desktop."
elif [ ! -x "$APP" ]; then note "Skipped: MyGSNotes+ is not installed, so it cannot be started. Run: bash mygsnotes-setup.sh"
else
  note "Starting MyGSNotes+ and waiting up to 25 seconds for its window…"
  v="$(launch_test "" "Normal start")"
  case "$v" in
    shown)  ok "The window opened. Look for it on your screen now.";;
    forced) bad "The window was forced open after 5 s because the page had not drawn. If it is blank, use safe mode (below).";;
    other)  bad "Another MyGSNotes+ copy answered instead. Close it (pkill -f mygsnotes-plus) and run: bash mygsnotes-setup.sh check.";;
    exited) bad "MyGSNotes+ closed during start-up. Its output is in the report.";;
    silent) if grep -q '\[MyGSNotes+\] starting' "$LOG"; then bad "Started but never reported a window."; else bad "No start-up messages. This is an older build without them: install the newest files with: bash mygsnotes-setup.sh"; fi;;
  esac
  if [ "$v" = "exited" ] || [ "$v" = "forced" ] || [ "$v" = "silent" ]; then
    pkill -u "$USER" -f "$PAT" 2>/dev/null; sleep 2
    note "Trying safe mode (graphics acceleration off)…"
    v2="$(launch_test "--safe-mode" "Safe mode")"
    if [ "$v2" = "shown" ]; then ok "Safe mode works. Start MyGSNotes+ with right-click on its icon → Safe mode, or: mygsnotes-plus --safe-mode"
    else bad "Safe mode did not open a window either ($v2)."; fi
  fi
fi

say ""
if [ $PROBLEMS -eq 0 ]; then say "$(printf '\033[32m\033[1m')All checks passed.$(printf '\033[0m')"
else say "$(printf '\033[31m\033[1m')$PROBLEMS problem(s) found.$(printf '\033[0m') Each ✘ line above says how to fix it."; fi
say "Report saved to $REPORT — paste it to Claude if you need help."
rm -f "$LOG"

#__CHECK_END__
#__UNINSTALL_BEGIN__
# MyGSNotes+ uninstaller — © 2026 Gustavo Salazar
set -uo pipefail
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
echo; echo "  Removing MyGSNotes+ (your notes are kept unless you choose otherwise)"; echo
pkill -f '(^|/)mygsnotes-plus( |$)' 2>/dev/null
if dpkg-query -W mygsnotes-plus >/dev/null 2>&1; then $SUDO apt-get remove -y mygsnotes-plus; else echo "  MyGSNotes+ is not installed."; fi
[ -L /usr/bin/mygsnotes-plus ] && [ ! -e /usr/bin/mygsnotes-plus ] && $SUDO rm -f /usr/bin/mygsnotes-plus
DATA="$HOME/.config/MyGSNotesPlus"
if [ -d "$DATA" ] && [ -t 0 ]; then
  echo; echo "  Your notes are in $DATA"
  read -r -p "  Delete them too? This cannot be undone. Type DELETE to confirm, or press Enter to keep: " a
  if [ "$a" = "DELETE" ]; then rm -rf "$DATA"; echo "  Notes deleted."; else echo "  Notes kept."; fi
fi
echo; echo "  Done."; echo

#__UNINSTALL_END__
