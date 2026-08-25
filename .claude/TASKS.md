# Deferred / open investigation tasks

Items that came up during work but couldn't be resolved (or fully fixed)
in the conversation where they were raised — logged here instead of only
living in chat history, so they don't get lost.

## Open

- **Terminal-input thinking indicator doesn't blink** (2026-08-19): sending
  input directly in a machine's own terminal (not via happydeck) while
  Claude is generating a response doesn't flip the sidebar/tile status dot
  to "thinking". Traced happy-cli's `session-alive` keepalive pipeline
  (`Session.keepAliveInterval` → `onThinkingChange` → `session-alive` socket
  event → server's `buildSessionActivityEphemeral` → happydeck's `ephemeral:
  activity` handler) — it's wired mode-independently (local and remote) at
  every step in the current happy-cli source, so this should work per a
  static read of the code. Needs either: a live repro with `DEBUG=1` on the
  affected machine, or confirming `happy --version` there isn't stale
  relative to what was reviewed. May share a root cause with the
  local-mode-only "done" notification gap (see happydeck's own commit
  history / conversation around 2026-08-19) — worth checking both together.

- **happy-cli SESSION_SCANNER permanently drops a session if its Claude
  Code transcript file doesn't appear within 60s of watch start** (2026-08-23):
  root-caused via live log correlation (`~/.happy/logs`, pid 49628,
  session `cd0a5f43-...`) — `startFileWatcher()`/`createSessionScanner()`
  in the installed `happy` 1.2.0 bundle (`/opt/homebrew/lib/node_modules/happy/dist/index-BmZ4or3w.mjs:729-928`)
  give up permanently ("transcript never appeared — dropping it") if the
  file isn't found within a hardcoded 60s, with no code path to re-arm
  later even once the file does appear. On a machine that's slow to start
  Claude Code (this user routinely runs 5-10+ concurrent sessions), this
  silently means the ENTIRE conversation history for that session never
  reaches happydeck (or any other Happy client) — the session shows "no
  messages" forever even though the local transcript has hundreds of real
  lines. happydeck cannot fix this itself (the bug is in a separate
  process's local file-watching logic, on whichever machine hit it) —
  only a mitigation (detect the "has a title but zero messages" mismatch
  and suggest `happy --continue`) is possible from happydeck's side.
  **Already a known upstream bug**: filed as slopus/happy#1538, with an
  unreviewed fix already open as slopus/happy#1638 (fork
  `leikaiwei/happy@pr/transcript-watcher` commit `40c79149`, ~3 weeks
  stale, 0 CI runs recorded). A full fork/patch plan was drafted
  (directory-watch + 2s-poll race instead of a hard file-watch timeout,
  recommended distribution as a parallel-aliased global install e.g.
  `happy-patched` rather than hand-editing the installed dist file, which
  `npm update -g happy` would silently revert) but explicitly deferred by
  the user for now ("今は保留") — pending because it would need
  independent rollout+maintenance on every machine that should benefit
  (this Mac, omen6, ...), not just one. Also found a second, narrower gap
  PR #1638 does NOT cover: `claudeLocalLauncher.ts`'s `finally` block
  unconditionally calls `scanner.cleanup()` even when the local→remote
  mode switch itself is what ended the local launcher, discarding the
  scanner (and any not-yet-uploaded history) with no log line at all —
  worth folding into the same fork effort if/when it's picked back up.

- **Terminal mode (PTY pane inside happydeck)** — design settled, implementation
  deferred (2026-08-23, user: "一旦ターミナル設計は、タスクに置いておいて…今は保留").
  Research + spikes are DONE; picking this back up should not need re-research.

  **Verdict: GO.** The one blocking risk (Japanese IME breaking Ctrl+C) was
  spike-tested on a real Tauri/WKWebView window and passed — with the IME on
  but no active composition, Ctrl+C reports keyCode 67 and reaches the shell
  (`^C` confirmed interrupting a `sleep`). Mid-composition keys go to the IME,
  which is correct behavior; Escape/backspace cancels composition first.

  **Decisions already made (points 1-3 of 5):**
  1. *Pane identity* — namespaced id `term:<uuid>` flowing through the existing
     paneTree/viewStore machinery unchanged. `PaneLeaf` stays `sessionId: string`;
     only `App.tsx`'s `renderLeaf()` branches on the prefix. (Rejected: a proper
     discriminated-union `PaneLeaf`, which ripples through all of paneTree.ts,
     viewStore, Sidebar's drag payload, `activePaneSessionId`, and needs a
     persisted-layout migration.)
  2. *Relationship to sessions* — a terminal is opened FROM a session and
     inherits that session's `cwd` + `machineId`. Not an independent terminal.
     (Known gap: with zero sessions you can't open one; extend to a standalone
     entry point later if that bites.)
  3. *Remote machines* — no new protocol. Run the exact `ssh -t <target> 'cd
     ... && exec $SHELL -l'` string `buildShellCommand()` (src/lib/openTerminal.ts)
     already builds for the existing Terminal.app "Open in Terminal" action,
     just inside a local PTY. Reuses `sshTargets`, ~/.ssh/config, ssh-agent,
     ProxyJump for free. (Rejected: russh — `russh-config` can't parse
     Include/Match so Host aliases break; and tunnelling a PTY over the Happy
     relay — its RPC set is 18 fixed request/response methods, no byte stream,
     would need forking happy-cli AND happy-server.)

  **Point 4 (persistence) — recommended but NOT yet confirmed by the user:**
  no persistence (PTY is a plain child of happydeck; dies with the app), PLUS a
  confirm-before-close warning when a pane's foreground process isn't just the
  shell. Reuses the existing `ConfirmDialog.tsx` (already used by BulkKillMenu;
  exists because native `confirm()` doesn't render reliably in this webview).
  Note there is NO app-quit/window-close confirmation anywhere in the app today
  — this would be the first, and it matters because nothing in happydeck can
  currently kill a user's real process on quit (sessions live on their own
  daemon). Rejected: tmux-backing (not preinstalled on macOS/Ubuntu/Fedora, no
  Windows story, `new-session -A` can't distinguish detach from session-end via
  exit code so it needs a real state machine — and no mainstream app does this
  by default; only iTerm2, opt-in). Rejected: pane-lifetime-scoped (needs a
  brand-new "leaf left the tree" diffing mechanism — paneTree's mutators are
  pure and hookless, `replaceLeaf`/`showGrid` also silently drop leaves — and
  it would break the existing precedent that closing a session's pane never
  kills the session).

  **Point 5 (launch trigger) — scouted, not yet decided:** add "Open terminal
  here" immediately after the existing "Open in Terminal" item, before the
  divider, in BOTH menus — `SessionMenu.tsx:243-248` (sidebar row) and
  `TileActionsMenu.tsx:96-108` (tile header). Both menus share the same
  structure: lifecycle actions → divider → destructive actions. Plumbing gap to
  close first: neither menu component imports `useViewStore`, so the pane-add
  action must be threaded down as a prop — exactly the shape `onClosePane`
  already uses (`App.tsx:296`, built from `removePane` at `App.tsx:86`).

  **Implementation constraints confirmed by spike (do not re-derive):**
  - Rust: `portable-pty` 0.9.0. MUST drop `pair.slave` after spawn or the
    master never sees EOF and blocks forever. Reads aren't cancellable → one
    dedicated OS thread per session + a channel. Rejected `tauri-plugin-shell`
    (no PTY at all, `isatty()` false) and `tauri-plugin-pty` (IPC-polling read
    loop holding a Mutex across blocking I/O — one session permanently occupies
    a tokio worker, so multi-pane starves the runtime).
  - `#[tauri::command]`s written directly in lib.rs need NO capabilities entry
    (the app's existing commands aren't listed in capabilities/default.json).
  - Frontend: `@xterm/xterm` 6.0.0 stable + `@xterm/addon-fit`, **DOM renderer**
    — not WebGL (WKWebView row-ghosting, xterm#5847) and the canvas addon was
    removed in 6.0. Mount manually with useRef/useEffect; dispose+recreate per
    mount (StrictMode double-`.open()` breaks, xterm#4978).
  - **Do NOT apply the app's CSS `zoom` to the terminal pane.** Measured: xterm
    sizes cells from `offsetWidth` (zoom-immune) but maps pointers via
    `getBoundingClientRect()` (zoom-scaled), so at the app's default 1.1 the
    click-to-cell mapping drifts — 7 columns off by column 61. Change fontSize
    instead.
  - Do NOT enable the kitty keyboard protocol (opt-in in the beta, absent in
    6.0.0) — it breaks single-char IME confirmation (xterm#6112).
  - `Cmd+F` is already globally captured at `App.tsx:134` and will collide with
    xterm's own search addon.
  - Finder-launched `.app` inherits launchd's minimal PATH — spawn via
    `$SHELL -l -c` or inject PATH explicitly, or `claude`/node/Homebrew won't
    be found.
  - Known unknown, worth an early check: whether Tauri's `Channel` payload for
    raw bytes arrives as ArrayBuffer or Array in the pinned version (a breaking
    change exists in that area) — measure rather than assume.

  Throwaway IME spike lives at (scratch, may be GC'd):
  `/private/tmp/claude-501/-Users-masa669-Documents-project-multiMonitor/dcfb0aef-12de-442f-864f-cdc086c9d10d/scratchpad/xterm-ime-spike/`

- **Code signing / notarization for distributable releases** (2026-08-24,
  user: "将来的に対応したい" — deferred, not blocking self-use).
  Releases currently ship UNSIGNED on all three platforms, which is fine
  while the only consumer is this user's own machines but is a poor
  experience for anyone else:
  - **macOS**: Gatekeeper blocks an unsigned/un-notarized `.app` outright.
    Recipients must right-click → Open, or `xattr -cr` it by hand — the
    same manual step `scripts/build-install-launch.sh` already automates
    for local installs. Fixing properly needs an Apple Developer Program
    membership (~$99/yr) for a Developer ID Application certificate, plus
    notarization (submit to Apple, staple the ticket). tauri-action reads
    `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
    `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID` from repo
    secrets — no workflow restructuring needed, just the secrets and the
    cert.
  - **Windows**: unsigned `.exe` triggers a SmartScreen warning. Needs an
    Authenticode cert; an OV cert is cheaper but still accrues SmartScreen
    reputation slowly, an EV cert avoids the warning immediately but is
    more expensive and usually hardware-token-bound (awkward in CI —
    cloud-signing services like Azure Trusted Signing exist for this).
  - **Linux**: AppImage needs nothing equivalent.
  Also unconfigured and worth deciding at the same time: the **Tauri
  updater** (`tauri.conf.json` has no `plugins.updater` block), so today
  updating means manually re-downloading. The updater REQUIRES signing keys
  of its own (`tauri signer generate`, then `TAURI_SIGNING_PRIVATE_KEY` in
  CI) — independent of the OS-level code signing above, so it can be added
  first if auto-update matters more than the Gatekeeper/SmartScreen
  warnings.
  Release infrastructure itself is already working: `.github/workflows/release.yml`
  builds macOS (arm64) / Windows / Linux on a `happydeck-v*` tag push and
  uploads to a DRAFT GitHub release.

## Windows-only verification backlog (happydeck)

Everything below is written and type-checks against `x86_64-pc-windows-msvc`,
but has only ever run on macOS. None of it can be verified from this Mac.

- **Clickable notifications** (`src-tauri/src/notification.rs`). Needs an
  *installed* build, not `cargo run`: a toast is rejected outright unless
  its AppUserModelID matches a Start-menu shortcut the NSIS installer
  created, so `notify_session` deliberately omits `app_id` when running out
  of `target/debug|release`. Check (a) the toast appears at all, (b)
  clicking its body raises the window and opens that session. Known
  limitation, not a bug: activation only fires while the app is running and
  the toast is still on screen — a click from Action Center needs a COM
  activator, deliberately out of scope.
- Clipboard-history workaround (`win_clipboard.rs`), Ctrl+J/Ctrl+P/F12
  accelerator disable (`win_webview.rs`), composer placeholder alignment,
  `<task-notification>` row rendering, base64 attachment fix. All shipped
  unverified on Windows.

macOS side of clickable notifications is also unverified end-to-end: an
unbundled probe returned `Closed(Expired)` ~175ms after delivery (the
notification never reaches `deliveredNotifications` for a process without
its own bundle), so the click path can only be confirmed from the installed
app by actually clicking one.

## macOS traffic lights disappear when the window isn't frontmost (happydeck)

Two fix attempts have shipped and failed:
1. `NSAnimationContext` zero-duration wrapping + reapply on `WindowEvent::Focused`.
2. `NSViewFrameDidChangeNotification` observer on the container + all
   three buttons (`src-tauri/src/macos_titlebar.rs`), reapplying whenever
   any of their frames change for any reason, not just on tao's coarser
   window events. This one DID fix a real, separate bug — a "green button
   only" resize jitter caused by recomputing `space_between` from live
   (self-influenced) button positions on every correction and multiplying
   it by each button's index (0x/1x/2x) — but did NOT fix the
   disappearing-when-inactive symptom.

Direct instrumentation (`HAPPYDECK_TITLEBAR_DEBUG=1`, logs to
`~/Library/Logs/happydeck/titlebar-debug.log` — see `dbg_log` in
`macos_titlebar.rs`) at real `windowDidBecomeKey:`/`windowDidResignKey:`
transitions shows `hidden=false`, `alpha=1.00`, identical frame geometry,
and the titlebar container staying topmost in z-order, in BOTH states.
**This refutes the theory (from both fix attempts, and from the two
research agents that investigated this) that AppKit resets the container's
frame on key-status change.** Whatever's happening is not visible at the
NSView geometry/visibility-property level — it's either a compositing/
redraw issue this kind of introspection can't see, or something other than
what's been tried is occluding/failing to redraw the buttons.

Next step (per explicit user choice, 2026-08-25): have the user run the
debug-instrumented build themselves and reproduce the bug for real (switch
to a genuinely different frontmost app, not a synthetic
`osascript ... activate`), then share `~/Library/Logs/happydeck/titlebar-debug.log`
from that session. `launchctl setenv HAPPYDECK_TITLEBAR_DEBUG 1` before
`open`-launching the app is the way to enable it without hitting the
ad-hoc-dev-signing keychain error that a direct `Contents/MacOS/happydeck`
exec triggers (see the release-signing TODO above) — `launchctl setenv`
propagates to subsequently `open`-launched GUI processes; a raw exec from
Terminal does not go through the same keychain-authorization path and
reliably fails on this machine's ad-hoc dev signature.
