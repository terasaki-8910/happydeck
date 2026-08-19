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

# Quit the previously-installed instance specifically (by path, not name --
# a `tauri dev` process is also literally named "happydeck" and must not be
# touched by this) so the copy below doesn't hit a file-in-use error, and
# the final `open` doesn't just refocus a stale process.
if [ -d "/Applications/$APP_NAME" ]; then
  osascript -e "tell application \"/Applications/$APP_NAME\" to quit" 2>/dev/null || true
  sleep 1
fi

rm -rf "/Applications/$APP_NAME"
cp -R "$APP_PATH" /Applications/
xattr -cr "/Applications/$APP_NAME"
open "/Applications/$APP_NAME"
