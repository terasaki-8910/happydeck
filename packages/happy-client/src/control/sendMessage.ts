import type { HttpClient } from '../api/http';
import { encodeBase64 } from '../crypto/base64';
import type { Decryptor, Encryptor } from '../crypto/encryptor';

export interface SendMessageMeta {
  sentFrom?: string;
  /**
   * MUST be one of happy-cli's MessageMetaSchema enum values — "default",
   * "acceptEdits", "bypassPermissions", "plan", "read-only", "safe-yolo",
   * "yolo" (dist/types-CV0guBiJ.mjs:484). Anything else (notably Claude
   * Code's "dontAsk" mode, which the CLI's schema predates) fails
   * UserMessageSchema.safeParse in routeIncomingMessage
   * (dist/types-CV0guBiJ.mjs:2407) — and because that parse gates the
   * whole message, not just the meta, the message falls through to the
   * file-event branch, matches nothing, and the user's TEXT is silently
   * dropped with it. Callers must allowlist.
   */
  permissionMode?: string;
  /**
   * `null` is meaningful and NOT the same as omitting the key: the CLI
   * branches on `message.meta?.hasOwnProperty("model")`
   * (dist/index-BmZ4or3w.mjs:6905) and then does
   * `messageModel = message.meta.model || undefined`, so null resets the
   * session to the CLI's default model while an absent key leaves the
   * current model alone. Note that `undefined` CANNOT express the reset:
   * this payload is serialized with JSON.stringify (crypto/nacl.ts), which
   * drops undefined-valued keys, so `{model: undefined}` arrives
   * byte-identical to omitting it. Widened from `string` for exactly this.
   */
  model?: string | null;
  modelProviderId?: string;
  /**
   * Accepted by Codex and by Claude's runner logic
   * (dist/index-BmZ4or3w.mjs:6955), but for Claude it never arrives:
   * MessageMetaSchema (dist/types-CV0guBiJ.mjs:481) does not declare
   * `effort`, and zod object schemas strip unknown keys before the
   * runner's callback sees the message. Kept in the type because it is a
   * real field of the protocol, but do not expect it to do anything on a
   * Claude session; effort is fixed at spawn (`--effort`,
   * dist/index-BmZ4or3w.mjs:5553).
   */
  effort?: string;
  displayText?: string;
}

interface SendMessageResponseRow {
  id: string;
  seq: number;
  localId: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Sends a plain user text message to a session (POST .../messages — an
 * HTTP call, not a socket RPC to the agent; the agent picks it up via the
 * relay same as any other client would).
 *
 * `meta` is the ONLY channel that reaches a RUNNING agent's permission
 * mode / model. The previous version of this comment claimed the reverse
 * — that updateSessionAgentModes (agentModes.ts) applies "to future turns
 * regardless of what any single message's meta carries" — and that was
 * simply wrong, and was the direct cause of a mode-change-does-nothing
 * bug: happy-cli's Claude runner holds permission mode as process-local
 * state, mutated only in session.onUserMessage from message.meta
 * (dist/index-BmZ4or3w.mjs:6882-6901) and pushed to the live
 * PermissionHandler via handleModeChange (:2887, :2899). Grepped the whole
 * installed CLI bundle: no code path anywhere reads metadata.permissionMode
 * — not on a poll, not at a turn boundary, and not on resume
 * (buildResumeLaunch, :5415, builds only ["claude", "--resume", <id>]).
 * updateSessionAgentModes remains necessary for a different job — it is
 * the persisted, cross-device record the UI renders — but it is not
 * sufficient, and neither call replaces the other.
 */
export async function sendSessionMessage(
  http: HttpClient,
  sessionId: string,
  encryptor: Encryptor & Decryptor,
  text: string,
  meta: SendMessageMeta = {},
): Promise<SendMessageResponseRow> {
  const localId = crypto.randomUUID();
  const content = {
    role: 'user',
    content: { type: 'text', text },
    meta: { sentFrom: 'happydeck', ...meta },
  };
  const [encryptedBytes] = await encryptor.encrypt([content]);

  const response = await http.post<{ messages: SendMessageResponseRow[] }>(`/v3/sessions/${sessionId}/messages`, {
    messages: [{ localId, content: encodeBase64(encryptedBytes, 'base64') }],
  });

  const row = response.messages[0];
  if (!row) {
    throw new Error('Send message response did not include the created row');
  }
  return row;
}
