import type { Socket } from 'socket.io-client';
import { decodeBase64, encodeBase64 } from '../crypto/base64';
import type { Decryptor, Encryptor } from '../crypto/encryptor';

export interface SessionAgentModesPatch {
  permissionMode?: string | null;
  modelMode?: string | null;
  effortLevel?: string | null;
  [key: string]: unknown;
}

export interface UpdateMetadataResult {
  metadata: Record<string, unknown>;
  version: number;
}

interface UpdateMetadataAck {
  result: 'success' | 'version-mismatch' | 'error';
  version?: number;
  metadata?: string;
  message?: string;
}

/**
 * Patches arbitrary fields into synced session metadata (a single
 * `update-metadata` socket emit — NOT an RPC to the agent; this only
 * touches the server's copy, which the agent picks up on its own poll/next
 * turn). Optimistic concurrency: on `version-mismatch`, re-fetches the
 * server's latest metadata and retries, dropping any patch field the
 * latest copy already matches (another device/tab made the same change
 * first) so a stale retry can't clobber it.
 *
 * `currentMetadata`/`currentVersion` must be the caller's own up-to-date
 * view of the session (this library holds no session state itself).
 */
export async function updateSessionMetadataPatch(
  socket: Socket,
  sessionId: string,
  encryptor: Encryptor & Decryptor,
  currentMetadata: Record<string, unknown>,
  currentVersion: number,
  patch: Record<string, unknown>,
  maxRetries = 3,
): Promise<UpdateMetadataResult> {
  let version = currentVersion;
  let pendingPatch: Record<string, unknown> = { ...patch };
  let metadata: Record<string, unknown> = { ...currentMetadata, ...pendingPatch };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const [encryptedBytes] = await encryptor.encrypt([metadata]);
    const ack = (await socket.emitWithAck('update-metadata', {
      sid: sessionId,
      metadata: encodeBase64(encryptedBytes, 'base64'),
      expectedVersion: version,
    })) as UpdateMetadataAck;

    if (ack.result === 'success') {
      return { metadata, version: ack.version! };
    }

    if (ack.result === 'version-mismatch') {
      version = ack.version!;
      const [latest] = await encryptor.decrypt([decodeBase64(ack.metadata ?? '', 'base64')]);
      if (!latest || typeof latest !== 'object') {
        throw new Error('Failed to decrypt latest session metadata');
      }
      const latestRecord = latest as Record<string, unknown>;

      for (const key of Object.keys(pendingPatch)) {
        if (latestRecord[key] === pendingPatch[key]) {
          delete pendingPatch[key];
        }
      }
      if (Object.keys(pendingPatch).length === 0) {
        return { metadata: latestRecord, version };
      }
      metadata = { ...latestRecord, ...pendingPatch };
      continue;
    }

    throw new Error(ack.message || 'Failed to update session metadata');
  }

  throw new Error(`Failed to update session metadata after ${maxRetries} retries due to version conflicts`);
}

/** Persists a permissionMode/modelMode/effortLevel pick. See updateSessionMetadataPatch. */
export function updateSessionAgentModes(
  socket: Socket,
  sessionId: string,
  encryptor: Encryptor & Decryptor,
  currentMetadata: Record<string, unknown>,
  currentVersion: number,
  patch: SessionAgentModesPatch,
): Promise<UpdateMetadataResult> {
  return updateSessionMetadataPatch(socket, sessionId, encryptor, currentMetadata, currentVersion, patch);
}

/**
 * Renames a session by directly setting `metadata.summary` — the same
 * field `mcp__happy__change_title` sets from inside the agent. A real
 * rename (synced, not a local-only display override): any other Happy
 * client (mobile, this app on another device) sees it too.
 */
export function updateSessionSummary(
  socket: Socket,
  sessionId: string,
  encryptor: Encryptor & Decryptor,
  currentMetadata: Record<string, unknown>,
  currentVersion: number,
  title: string,
): Promise<UpdateMetadataResult> {
  return updateSessionMetadataPatch(socket, sessionId, encryptor, currentMetadata, currentVersion, {
    summary: { text: title, updatedAt: Date.now() },
  });
}
