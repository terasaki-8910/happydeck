import type { Socket } from 'socket.io-client';
import type { Decryptor, Encryptor } from '../crypto/encryptor';
import { machineRPC } from './rpc';

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
      permissionMode: options.permissionMode,
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
 */
export async function machineResumeSession(
  socket: Socket,
  encryptor: Encryptor & Decryptor,
  machineId: string,
  sessionId: string,
): Promise<SpawnSessionResult> {
  try {
    const result = await machineRPC<SpawnSessionResult | { error: string }, { sessionId: string }>(
      socket,
      machineId,
      'resume-happy-session',
      { sessionId },
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
