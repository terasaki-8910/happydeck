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
