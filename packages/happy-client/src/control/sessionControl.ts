import type { Socket } from 'socket.io-client';
import type { HttpClient } from '../api/http';
import type { Decryptor, Encryptor } from '../crypto/encryptor';
import { sessionRPC } from './rpc';

type SessionEncryptor = Encryptor & Decryptor;

/**
 * Approve a pending permission request (`session.agentState.requests[id]`).
 * `mode`/`allowTools`/`decision` are optional broader grants (e.g. "allow
 * this tool for the rest of the session") — omit them for a plain one-off
 * approval.
 */
export function sessionAllow(
  socket: Socket,
  sessionId: string,
  encryptor: SessionEncryptor,
  id: string,
  options?: {
    mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    allowedTools?: string[];
    decision?: 'approved' | 'approved_for_session';
    updatedInput?: Record<string, unknown>;
  },
): Promise<void> {
  return sessionRPC(
    socket,
    sessionId,
    'permission',
    { id, approved: true, mode: options?.mode, allowTools: options?.allowedTools, decision: options?.decision, updatedInput: options?.updatedInput },
    encryptor,
  );
}

export function sessionDeny(
  socket: Socket,
  sessionId: string,
  encryptor: SessionEncryptor,
  id: string,
  options?: {
    mode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
    allowedTools?: string[];
    decision?: 'denied' | 'abort';
  },
): Promise<void> {
  return sessionRPC(
    socket,
    sessionId,
    'permission',
    { id, approved: false, mode: options?.mode, allowTools: options?.allowedTools, decision: options?.decision },
    encryptor,
  );
}

/**
 * Rejects the agent's current in-flight tool use and asks it to stop and
 * wait for the user. This is a "stop what you're doing," not a full
 * process kill — see sessionKill for that.
 */
export function sessionAbort(socket: Socket, sessionId: string, encryptor: SessionEncryptor): Promise<void> {
  return sessionRPC(
    socket,
    sessionId,
    'abort',
    {
      reason:
        "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
    },
    encryptor,
  );
}

export interface SessionKillResponse {
  success: boolean;
  message: string;
}

/** Kills the session's CLI process immediately. Irreversible — the process is gone, not just interrupted. */
export function sessionKill(socket: Socket, sessionId: string, encryptor: SessionEncryptor): Promise<SessionKillResponse> {
  return sessionRPC(socket, sessionId, 'killSession', {}, encryptor);
}

/**
 * Permanently deletes a session row from the server (plain bearer-authed
 * REST, not an encrypted RPC to the agent — distinct from sessionKill,
 * which only stops the CLI process). Irreversible; the session disappears
 * from every device. Kill it first if it's still active — deleting a live
 * session doesn't stop its process, it just removes the record pointing
 * at it.
 */
export function sessionDelete(http: HttpClient, sessionId: string): Promise<void> {
  return http.delete(`/v1/sessions/${sessionId}`);
}
