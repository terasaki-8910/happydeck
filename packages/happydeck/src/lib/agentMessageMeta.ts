import type { SendMessageMeta } from 'happy-client';

/**
 * The permission modes happy-cli's MessageMetaSchema will actually accept
 * on a message (dist/types-CV0guBiJ.mjs:484). Deliberately NOT derived
 * from CLAUDE_PERMISSION_MODES in agentOptions.ts: that list is what the
 * Claude Code CLI accepts as a --permission-mode ARGUMENT, which is a
 * strictly larger set. "dontAsk" is the live example — a genuine Claude
 * Code mode, so it is legitimate at spawn time, but happy-cli's message
 * schema predates it and does not list it.
 *
 * Sending an unlisted value is not a silent no-op, it is data loss: the
 * meta parse gates the entire UserMessageSchema, so routeIncomingMessage
 * (dist/types-CV0guBiJ.mjs:2406) never routes the message — it falls
 * through to the file-event branch, matches nothing, and the user's TEXT
 * disappears with it, with no error surfacing anywhere in happydeck (the
 * POST itself succeeds). Hence an allowlist rather than a passthrough.
 */
const CLI_MESSAGE_PERMISSION_MODES = new Set(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'read-only', 'safe-yolo', 'yolo']);

interface AgentModeMetadata {
  permissionMode?: unknown;
  modelMode?: unknown;
}

/**
 * Builds the per-message `meta` that tells a RUNNING happy-cli Claude
 * process which permission mode / model this turn should use.
 *
 * Necessary because changing the composer badge only writes the server's
 * encrypted session metadata, and no happy-cli code path ever reads
 * metadata.permissionMode back (see the sendSessionMessage doc comment for
 * the grep). Without this the CLI logs "User message received with no
 * permission mode override, using current: default" on every turn
 * (dist/index-BmZ4or3w.mjs:6901) and keeps the mode it was spawned with.
 *
 * Three deliberate omissions, each of which the obvious implementation
 * gets wrong:
 *
 * 1. An ABSENT permissionMode sends nothing rather than "default".
 *    Absence means "we have no record", not "the agent is in default", so
 *    eagerly sending "default" would DOWNGRADE a session whose real mode
 *    came from a spawn argument — a fresh bug traded for the one being
 *    fixed.
 *
 * 2. `effort` is never sent. The runner has code to read it (:6955) but
 *    MessageMetaSchema does not declare the field and zod strips unknown
 *    keys before the runner is called, so it provably cannot arrive.
 *    Sending it would only create the false impression that changing
 *    effort mid-session does something. It does not; only a respawn does.
 *
 * 3. `model` is sent only when the session actually has a recorded one. It
 *    is the one field where an explicit null is load-bearing (the CLI
 *    branches on hasOwnProperty and treats null as "reset to default"), so
 *    blanket-sending a normalized value would reset the model of every
 *    session with no record. metadata.modelMode is written only by this
 *    app (the popover, or the post-spawn write in happyStore), so its
 *    presence is a reliable signal of a deliberate choice — and when that
 *    choice IS "default model", the reset is exactly what was asked for.
 */
export function buildAgentMessageMeta(metadata: AgentModeMetadata | null | undefined): SendMessageMeta {
  const meta: SendMessageMeta = {};

  const permissionMode = metadata?.permissionMode;
  if (typeof permissionMode === 'string' && CLI_MESSAGE_PERMISSION_MODES.has(permissionMode)) {
    meta.permissionMode = permissionMode;
  }

  const modelMode = metadata?.modelMode;
  if (typeof modelMode === 'string' && modelMode.length > 0) {
    meta.model = modelMode === 'default' ? null : modelMode;
  }

  return meta;
}
