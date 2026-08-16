import { decryptAESGCMString, encryptAESGCMString } from './aes';
import { decodeBase64, encodeBase64 } from './base64';
import { decryptSecretBox, encryptSecretBox } from './nacl';

/**
 * Prepends/strips the 0x00 version byte that marks an AES256Encryption
 * record. Exported so encryption.ts's encryptEncryptionKey/decryptEncryptionKey
 * (which wrap a different thing — a Box-encrypted key, not an AES record —
 * but use the identical version-byte convention) can share the same
 * primitive instead of duplicating the off-by-one-prone slicing.
 */
export function encodeVersionedRecord(inner: Uint8Array): Uint8Array {
  const output = new Uint8Array(inner.length + 1);
  output[0] = 0;
  output.set(inner, 1);
  return output;
}

export function decodeVersionedRecord(record: Uint8Array): Uint8Array | null {
  if (record.length === 0 || record[0] !== 0) {
    return null;
  }
  return record.slice(1);
}

/**
 * Batch-oriented encrypt/decrypt, mirroring happy-app's sync/encryption/encryptor.ts.
 * Every decrypt path fails closed (returns null per item) rather than
 * throwing — a single malformed/foreign record must never take down a batch
 * that also contains valid ones.
 */
export interface Encryptor {
  encrypt(data: unknown[]): Promise<Uint8Array[]>;
}

export interface Decryptor {
  decrypt(data: Uint8Array[]): Promise<(unknown | null)[]>;
}

/** Legacy scheme: keyed directly by the raw master secret (no derivation). */
export class SecretBoxEncryption implements Encryptor, Decryptor {
  constructor(private readonly secretKey: Uint8Array) {}

  async encrypt(data: unknown[]): Promise<Uint8Array[]> {
    const results: Uint8Array[] = [];
    for (const item of data) {
      results.push(await encryptSecretBox(item, this.secretKey));
    }
    return results;
  }

  async decrypt(data: Uint8Array[]): Promise<(unknown | null)[]> {
    const results: (unknown | null)[] = [];
    for (const item of data) {
      results.push(await decryptSecretBox(item, this.secretKey));
    }
    return results;
  }
}

/**
 * Newer scheme: keyed by a random per-session/machine AES-256 key (the
 * unwrapped `dataEncryptionKey`). Every record is prefixed with a 0x00
 * version byte — distinct from, and not to be confused with, the version
 * byte `encryptEncryptionKey` (in encryption.ts) puts on the wrapped KEY
 * itself.
 */
export class AES256Encryption implements Encryptor, Decryptor {
  private readonly secretKeyB64: string;

  constructor(secretKey: Uint8Array) {
    this.secretKeyB64 = encodeBase64(secretKey);
  }

  async encrypt(data: unknown[]): Promise<Uint8Array[]> {
    const results: Uint8Array[] = [];
    for (const item of data) {
      const encryptedB64 = await encryptAESGCMString(JSON.stringify(item), this.secretKeyB64);
      results.push(encodeVersionedRecord(decodeBase64(encryptedB64)));
    }
    return results;
  }

  async decrypt(data: Uint8Array[]): Promise<(unknown | null)[]> {
    // Promise.all, not a sequential loop: on a session with many messages
    // this lets the crypto backend interleave instead of serializing every
    // AES-GCM call on the event loop.
    return Promise.all(
      data.map(async (item) => {
        const inner = decodeVersionedRecord(item);
        if (!inner) {
          return null;
        }
        try {
          const decryptedString = await decryptAESGCMString(encodeBase64(inner), this.secretKeyB64);
          if (!decryptedString) {
            return null;
          }
          return JSON.parse(decryptedString);
        } catch {
          return null;
        }
      }),
    );
  }
}
