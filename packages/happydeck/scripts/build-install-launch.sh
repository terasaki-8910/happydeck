#!/usr/bin/env bash
# Builds a release .app locally and installs it straight into
# /Applications for quick local testing — the loop this app's own README
# documents manually (unsigned build -> Gatekeeper quarantine -> xattr -cr)
# collapsed into one command for this Mac specifically.
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm tauri build

APP_PATH=$(find src-tauri/target/release/bundle -maxdepth 2 -iname "*.app" -type d | head -1)
if [ -z "$APP_PATH" ]; then
  echo "error: no .app bundle found under src-tauri/target/release/bundle" >&2
  exit 1
fi
APP_NAME=$(basename "$APP_PATH")
INSTALLED="/Applications/$APP_NAME"
BIN_PATH="$INSTALLED/Contents/MacOS/${APP_NAME%.app}"

# Quit the previously-installed instance specifically (by path, not name --
# a `tauri dev` process is also literally named "happydeck" and must not be
# touched by this) so the copy below doesn't hit a file-in-use error, and
# the final `open` doesn't just refocus a stale process.
#
# The quit must be VERIFIED, not assumed. It used to be a fire-and-forget
# `osascript ... || true` plus `sleep 1`, which failed silently whenever the
# app ignored the Apple event or took longer than a second: the bundle got
# replaced underneath the still-running process, and `open` then just
# reactivated that stale instance — leaving a freshly built binary on disk
# and the OLD code on screen, with the script still reporting success.
# Confirmed live: process start 19:01 against a binary written at 19:48.
if pgrep -f "^$BIN_PATH$" >/dev/null 2>&1; then
  osascript -e "tell application \"$INSTALLED\" to quit" >/dev/null 2>&1 || true
  for _ in $(seq 1 25); do
    pgrep -f "^$BIN_PATH$" >/dev/null 2>&1 || break
    sleep 0.2
  done
  # Still alive after ~5s: it's wedged or refusing the quit event. Force it,
  # otherwise the rest of this script silently produces the stale-app state
  # described above.
  if pgrep -f "^$BIN_PATH$" >/dev/null 2>&1; then
    echo "warning: $APP_NAME ignored the quit request; killing it" >&2
    pkill -f "^$BIN_PATH$" || true
    sleep 1
  fi
fi

rm -rf "$INSTALLED"
cp -R "$APP_PATH" /Applications/
xattr -cr "$INSTALLED"
open "$INSTALLED"

# Confirm the thing now running is actually the binary just installed —
# the whole point of the dance above. A process older than the binary means
# `open` reattached to a survivor instead of launching the new build.
sleep 2
NEW_PID=$(pgrep -f "^$BIN_PATH$" | head -1 || true)
if [ -z "$NEW_PID" ]; then
  echo "warning: $APP_NAME does not appear to be running after open" >&2
  exit 0
fi
PROC_START_EPOCH=$(ps -o lstart= -p "$NEW_PID" | xargs -0 date -j -f "%a %b %e %T %Y" +%s 2>/dev/null || echo 0)
BIN_MTIME_EPOCH=$(stat -f %m "$BIN_PATH")
if [ "$PROC_START_EPOCH" != "0" ] && [ "$PROC_START_EPOCH" -lt "$BIN_MTIME_EPOCH" ]; then
  echo "error: pid $NEW_PID started before the installed binary was written — you are looking at a STALE build" >&2
  exit 1
fi
echo "$APP_NAME running as pid $NEW_PID (binary $(stat -f '%Sm' "$BIN_PATH"))"
