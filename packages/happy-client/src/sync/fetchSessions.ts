import type { HttpClient } from '../api/http';
import { decodeBase64 } from '../crypto/base64';
import type { Encryption } from '../crypto/encryption';

interface RawSession {
  id: string;
  tag?: string;
  seq: number;
  metadata: string;
  metadataVersion: number;
  agentState: string | null;
  agentStateVersion: number;
  dataEncryptionKey: string | null;
  active: boolean;
  activeAt: number;
  createdAt: number;
  updatedAt: number;
}

interface SessionsResponse {
  sessions: RawSession[];
}

export interface DecryptedSession {
  id: string;
  seq: number;
  active: boolean;
  activeAt: number;
  createdAt: number;
  updatedAt: number;
  /** null if unwrapped metadata failed to parse — the row itself is still kept (metadata may be legitimately absent). */
  metadata: unknown | null;
  /** Optimistic-concurrency version for `metadata` — required by updateSessionAgentModes. */
  metadataVersion: number;
  agentState: unknown | null;
  agentStateVersion: number;
  /** The row's unwrapped per-session AES key, or null for a legacy session. Reuse this to decrypt its messages. */
  dataKey: Uint8Array | null;
}

/**
 * GET /v1/sessions + decrypt. Resilience rule (matches upstream): a session
 * whose dataEncryptionKey fails to unwrap is DROPPED entirely, not shown
 * with null metadata — an undecryptable session key means we cannot safely
 * say anything about that row.
 */
export async function fetchSessions(http: HttpClient, encryption: Encryption): Promise<DecryptedSession[]> {
  const { sessions } = await http.get<SessionsResponse>('/v1/sessions');

  const results: DecryptedSession[] = [];
  for (const session of sessions) {
    let dataKey: Uint8Array | null = null;
    if (session.dataEncryptionKey) {
      dataKey = await encryption.decryptEncryptionKey(session.dataEncryptionKey);
      if (!dataKey) {
        continue; // drop: we cannot decrypt anything about this session
      }
    }

    const encryptor = encryption.openEncryption(dataKey);
    const [metadata] = await encryptor.decrypt([decodeBase64(session.metadata, 'base64')]);
    let agentState: unknown | null = null;
    if (session.agentState) {
      const [decryptedAgentState] = await encryptor.decrypt([decodeBase64(session.agentState, 'base64')]);
      agentState = decryptedAgentState ?? null;
    }

    results.push({
      id: session.id,
      seq: session.seq,
      active: session.active,
      activeAt: session.activeAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      metadata: metadata ?? null,
      metadataVersion: session.metadataVersion,
      agentState,
      agentStateVersion: session.agentStateVersion,
      dataKey,
    });
  }
  return results;
}
