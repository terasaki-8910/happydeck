import type { Socket } from 'socket.io-client';
import type { Decryptor, Encryptor } from '../crypto/encryptor';
import { machineRPC } from './rpc';

/**
 * The daemon refuses to forward the literal permission mode `'default'` to
 * the agent process: its arg builders both gate on
 * `permissionMode !== 'default'` (happy-cli 1.2.0
 * dist/index-BmZ4or3w.mjs:5547 for spawn, :6042 for resume), so the flag is
 * simply omitted. The child then falls back to
 * `DEFAULT_CLAUDE_PERMISSION_MODE = 'yolo'` (:6451, applied :6472), which
 * sets `dangerouslySkipPermissions` (:6475) and makes `handleToolCall`
 * auto-approve everything. Asking for the SAFEST mode therefore produces a
 * fully bypassed agent — and it's a one-way door, because
 * `resolveRemoteClaudePermissionMode` (:1454-1464) refuses the
 * bypass -> default downgrade for the life of that process.
 *
 * `'safe-yolo'` is the way out, verified end to end against that bundle:
 * it's in `VALID_PERMISSION_MODES` (:1403-1411) so it passes the filter and
 * is emitted as a real flag; `mapToClaudeMode` (:1395-1402) turns it into
 * `'default'` when the SDK options are built (:1714); and it is neither
 * `'bypassPermissions'` nor `'yolo'`, so it trips neither
 * `dangerouslySkipPermissions` nor `isClaudeBypassEquivalent` (:1451).
 *
 * Applied at the wire boundary only — callers keep saying `'default'`, and
 * the value stored in session metadata stays `'default'` too, so nothing
 * upstream has to know about this workaround. Remove it if happy-cli ever
 * stops dropping the flag.
 */
export function wirePermissionMode(mode: string | undefined): string | undefined {
  return mode === 'default' ? 'safe-yolo' : mode;
}

/**
 * `'default'` means "don't pin a model", so it must NOT go on the wire —
 * unlike permission mode, where 'default' names a real mode. The spawn
 * arg builder filters it out itself (`modelMode !== 'default'`,
 * dist/index-BmZ4or3w.mjs:5550), but the RESUME one does not
 * (`if (options?.model)`, :6039-6041) — it would push a literal
 * `--model default`. Dropped here so both paths behave the same.
 */
export function wireModel(model: string | undefined): string | undefined {
  return model === 'default' ? undefined : model;
}

/** Scoped to the classic (non-Rig) agent flavors our 4 machines actually run. */
export interface SpawnSessionOptions {
  machineId: string;
  directory: string;
  /** Re-send with true after a `requestToApproveDirectoryCreation` result to confirm creating a new directory. */
  approvedNewDirectoryCreation?: boolean;
  agent?: 'claude' | 'codex' | 'gemini' | 'openclaw' | 'agy';
  permissionMode?: string;
  modelMode?: string;
  effortLevel?: string;
}

export type SpawnSessionResult =
  | { type: 'success'; sessionId: string }
  | { type: 'pending'; clientRequestId: string; retryAfterMs: number }
  | { type: 'requestToApproveDirectoryCreation'; directory: string }
  | { type: 'error'; errorMessage: string };

/** Starts a brand-new Claude Code session in `directory` on `machineId`. The machine's daemon must be online. */
export async function machineSpawnNewSession(
  socket: Socket,
  encryptor: Encryptor & Decryptor,
  options: SpawnSessionOptions,
): Promise<SpawnSessionResult> {
  try {
    const request = {
      type: 'spawn-in-directory' as const,
      directory: options.directory,
      approvedNewDirectoryCreation: options.approvedNewDirectoryCreation ?? false,
      agent: options.agent ?? 'claude',
      permissionMode: wirePermissionMode(options.permissionMode),
      modelMode: options.modelMode,
      effortLevel: options.effortLevel,
    };
    return await machineRPC(socket, options.machineId, 'spawn-happy-session', request, encryptor);
  } catch (error) {
    return { type: 'error', errorMessage: error instanceof Error ? error.message : 'Failed to spawn session' };
  }
}

/**
 * Relaunches an offline session's CLI process in its original directory,
 * continuing its existing Claude conversation (same sessionId, same
 * history) rather than starting a fresh one. Requires the session to have
 * an established Claude session id already (i.e. it had at least one real
 * turn before going offline — confirmed via a disposable test session:
 * a session killed before its first turn completes has nothing to resume).
 *
 * Confirmed empirically that a business-logic failure here comes back as
 * a bare `{error: string}` (no `type` field) — NOT the same shape as
 * spawn's `{type:'error', errorMessage}` — so it's normalized here rather
 * than trusting the RPC's raw shape.
 *
 * `modes` matters more than it looks: a resume relaunches a real process,
 * and `buildResumeLaunch` (happy-cli dist/index-BmZ4or3w.mjs:5415-5449)
 * passes NO mode flags of its own, so anything not sent here restarts at
 * the CLI's own defaults — yolo / opus / medium (:6451-6453). Sending the
 * session's recorded model and permission mode is what stops a resume from
 * silently dropping an agent into bypass. (Effort has no resume parameter
 * at all — the handler only destructures `{sessionId, model, permissionMode}`
 * at dist/types-CV0guBiJ.mjs:4637 — so it cannot be preserved here.)
 */
export async function machineResumeSession(
  socket: Socket,
  encryptor: Encryptor & Decryptor,
  machineId: string,
  sessionId: string,
  modes?: { model?: string; permissionMode?: string },
): Promise<SpawnSessionResult> {
  try {
    const result = await machineRPC<SpawnSessionResult | { error: string }, { sessionId: string; model?: string; permissionMode?: string }>(
      socket,
      machineId,
      'resume-happy-session',
      { sessionId, model: wireModel(modes?.model), permissionMode: wirePermissionMode(modes?.permissionMode) },
      encryptor,
    );
    if ('error' in result) {
      return { type: 'error', errorMessage: result.error };
    }
    return result;
  } catch (error) {
    return { type: 'error', errorMessage: error instanceof Error ? error.message : 'Failed to resume session' };
  }
}
