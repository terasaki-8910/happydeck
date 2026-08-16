import { decodeBase64, encodeBase64 } from './base64';
import { AES256Encryption, SecretBoxEncryption, type Decryptor, type Encryptor, decodeVersionedRecord, encodeVersionedRecord } from './encryptor';
import { deriveKey } from './hd';
import { boxSeedKeyPair, decryptBox, encryptBox, type KeyPair } from './nacl';

/**
 * Client-side key management for one Happy account.
 *
 * Everything here is derived from the 32-byte master secret and never
 * leaves this process — the server only ever sees ciphertext and
 * box-to-self-wrapped per-row keys. Mirrors happy-app's
 * sync/encryption/encryption.ts.
 */
export class Encryption {
  readonly anonID: string;
  readonly contentKeyPair: KeyPair;
  private readonly masterBlobKey: Uint8Array;
  private readonly legacyEncryption: SecretBoxEncryption;

  private constructor(masterSecret: Uint8Array, contentKeyPair: KeyPair, anonID: string, masterBlobKey: Uint8Array) {
    this.contentKeyPair = contentKeyPair;
    this.anonID = anonID;
    this.masterBlobKey = masterBlobKey;
    this.legacyEncryption = new SecretBoxEncryption(masterSecret);
  }

  static async create(masterSecret: Uint8Array): Promise<Encryption> {
    if (masterSecret.length !== 32) {
      throw new Error(`Invalid master secret length: ${masterSecret.length}, expected 32`);
    }
    const contentDataKey = deriveKey(masterSecret, 'Happy EnCoder', ['content']);
    const contentKeyPair = await boxSeedKeyPair(contentDataKey);
    const anonIdBytes = deriveKey(masterSecret, 'Happy Coder', ['analytics', 'id']);
    const anonID = Buffer.from(anonIdBytes).toString('hex').slice(0, 16).toLowerCase();
    const masterBlobKey = deriveKey(masterSecret, 'Happy Blobs', ['master']);
    return new Encryption(masterSecret, contentKeyPair, anonID, masterBlobKey);
  }

  /**
   * The single legacy-vs-AES decision in the whole protocol. `dataEncryptionKey`
   * is a row's raw per-session/machine key (already unwrapped by
   * decryptEncryptionKey) — null means the row predates per-row keys.
   */
  openEncryption(dataEncryptionKey: Uint8Array | null): Encryptor & Decryptor {
    if (!dataEncryptionKey) {
      return this.legacyEncryption;
    }
    return new AES256Encryption(dataEncryptionKey);
  }

  /**
   * Unwraps a session/machine row's `dataEncryptionKey` field (base64 of a
   * version byte + Box-to-self ciphertext) into the raw per-row key.
   * Deliberately never throws: callers iterate many rows from one API
   * response, and one malformed/foreign key must not reject the whole
   * batch — see the resilience rules in the M1 plan (session rows with an
   * undecryptable key get dropped by the CALLER; this just returns null).
   */
  async decryptEncryptionKey(encryptedBase64: string): Promise<Uint8Array | null> {
    try {
      const wrapped = decodeVersionedRecord(decodeBase64(encryptedBase64, 'base64'));
      if (!wrapped) {
        return null;
      }
      return await decryptBox(wrapped, this.contentKeyPair.secretKey);
    } catch {
      return null;
    }
  }

  /** Wraps a raw per-row key "to self" (Box-encrypted to our own content public key). */
  async encryptEncryptionKey(key: Uint8Array): Promise<string> {
    const boxed = await encryptBox(key, this.contentKeyPair.publicKey);
    return encodeBase64(encodeVersionedRecord(boxed), 'base64');
  }

  /**
   * Legacy-fixed raw encrypt/decrypt — always uses the master-secret-keyed
   * SecretBox regardless of any per-row data key. This is what machine
   * metadata's `update-metadata` RPC path uses (see happy-app's comment:
   * "Legacy methods for machine metadata, temporary until machines are
   * migrated"). Do not use this for session messages/metadata — use
   * openEncryption(dataEncryptionKey) instead.
   */
  async encryptRaw(data: unknown): Promise<string> {
    const [encrypted] = await this.legacyEncryption.encrypt([data]);
    return encodeBase64(encrypted, 'base64');
  }

  async decryptRaw(encryptedBase64: string): Promise<unknown | null> {
    const [decrypted] = await this.legacyEncryption.decrypt([decodeBase64(encryptedBase64, 'base64')]);
    return decrypted ?? null;
  }

  /** Blob (attachment) key for a session — per-session if it has a data key, else the master fallback. */
  getBlobKey(sessionDataKey: Uint8Array | null): Uint8Array {
    return sessionDataKey ? deriveKey(sessionDataKey, 'Happy Blobs', ['session']) : this.masterBlobKey;
  }
}
