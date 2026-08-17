import type { HttpClient } from '../api/http';
import { decodeBase64 } from '../crypto/base64';
import type { Encryption } from '../crypto/encryption';

interface RawMachine {
  id: string;
  metadata: string;
  metadataVersion: number;
  daemonState?: string | null;
  daemonStateVersion?: number;
  dataEncryptionKey?: string | null;
  seq: number;
  active: boolean;
  activeAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface DecryptedMachine {
  id: string;
  active: boolean;
  activeAt: number;
  createdAt: number;
  updatedAt: number;
  /** null when metadata is absent OR failed to decrypt — the machine row itself is always kept (see resilience rule below). */
  metadata: unknown | null;
  daemonState: unknown | null;
  /**
   * The row's unwrapped per-machine AES key, or null for a legacy machine
   * (or one whose key failed to unwrap — see the resilience rule below).
   * Reuse this via `encryption.openEncryption(dataKey)` for machineRPC
   * calls (e.g. spawning a session) — do NOT pass null unconditionally,
   * that only happens to work when the machine is actually legacy.
   */
  dataKey: Uint8Array | null;
}

/**
 * GET /v1/machines (a BARE ARRAY, not `{machines: [...]}`) + decrypt.
 *
 * Resilience rule (matches upstream, deliberately different from sessions):
 * a machine whose dataEncryptionKey fails to unwrap is KEPT with
 * metadata: null, never dropped. The machine list must never disappear a
 * row just because one field is temporarily undecryptable — decryptEncryptionKey
 * and every decrypt() path here fail closed to null/[] rather than throwing,
 * so a bad key naturally falls through to openEncryption(null) (legacy),
 * which itself fails closed if the data was actually AES-encrypted.
 */
export async function fetchMachines(http: HttpClient, encryption: Encryption): Promise<DecryptedMachine[]> {
  const raw = await http.get<RawMachine[]>('/v1/machines');

  const results: DecryptedMachine[] = [];
  for (const machine of raw) {
    let dataKey: Uint8Array | null = null;
    if (machine.dataEncryptionKey) {
      dataKey = await encryption.decryptEncryptionKey(machine.dataEncryptionKey);
    }

    let metadata: unknown | null = null;
    let daemonState: unknown | null = null;
    try {
      const encryptor = encryption.openEncryption(dataKey);
      const [decryptedMetadata] = await encryptor.decrypt([decodeBase64(machine.metadata, 'base64')]);
      metadata = decryptedMetadata ?? null;
      if (machine.daemonState) {
        const [decryptedDaemonState] = await encryptor.decrypt([decodeBase64(machine.daemonState, 'base64')]);
        daemonState = decryptedDaemonState ?? null;
      }
    } catch {
      // metadata/daemonState stay null; the machine row is still pushed below.
    }

    results.push({
      id: machine.id,
      active: machine.active,
      activeAt: machine.activeAt,
      createdAt: machine.createdAt,
      updatedAt: machine.updatedAt,
      metadata,
      daemonState,
      dataKey,
    });
  }

  return results;
}
