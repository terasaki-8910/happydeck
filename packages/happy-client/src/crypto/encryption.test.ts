import { describe, expect, it } from 'vitest';
import { AES256Encryption, SecretBoxEncryption } from './encryptor';
import { Encryption } from './encryption';

function randomSecret(fill = 42): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

describe('Encryption.create', () => {
  it('rejects a master secret that is not exactly 32 bytes', async () => {
    await expect(Encryption.create(new Uint8Array(31))).rejects.toThrow(/32/);
    await expect(Encryption.create(new Uint8Array(33))).rejects.toThrow(/32/);
  });

  it('derives a deterministic content keypair and anonID for a given secret', async () => {
    const secret = randomSecret(1);
    const a = await Encryption.create(secret);
    const b = await Encryption.create(secret);
    expect(a.contentKeyPair.publicKey).toEqual(b.contentKeyPair.publicKey);
    expect(a.anonID).toBe(b.anonID);
    expect(a.anonID).toHaveLength(16);
  });

  it('derives different keys for different secrets', async () => {
    const a = await Encryption.create(randomSecret(1));
    const b = await Encryption.create(randomSecret(2));
    expect(a.contentKeyPair.publicKey).not.toEqual(b.contentKeyPair.publicKey);
    expect(a.anonID).not.toBe(b.anonID);
  });
});

describe('openEncryption dispatch (the one legacy-vs-AES branch)', () => {
  it('returns the legacy SecretBox encryptor when dataEncryptionKey is null', async () => {
    const enc = await Encryption.create(randomSecret());
    expect(enc.openEncryption(null)).toBeInstanceOf(SecretBoxEncryption);
  });

  it('returns an AES256Encryption when a data key is present', async () => {
    const enc = await Encryption.create(randomSecret());
    expect(enc.openEncryption(new Uint8Array(32))).toBeInstanceOf(AES256Encryption);
  });
});

describe('encryptEncryptionKey / decryptEncryptionKey (per-row key wrapping)', () => {
  it('round-trips a random per-session AES key', async () => {
    const enc = await Encryption.create(randomSecret());
    const dataKey = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await enc.encryptEncryptionKey(dataKey);
    const unwrapped = await enc.decryptEncryptionKey(wrapped);
    expect(unwrapped).toEqual(dataKey);
  });

  it('fails closed (returns null) on a foreign/garbage dataEncryptionKey instead of throwing', async () => {
    const enc = await Encryption.create(randomSecret());
    expect(await enc.decryptEncryptionKey('not-a-real-wrapped-key')).toBeNull();
    expect(await enc.decryptEncryptionKey('')).toBeNull();
    // Wrapped by a DIFFERENT account's content key — must not decrypt, must not throw.
    const other = await Encryption.create(randomSecret(99));
    const dataKey = new Uint8Array(32).fill(3);
    const wrappedByOther = await other.encryptEncryptionKey(dataKey);
    expect(await enc.decryptEncryptionKey(wrappedByOther)).toBeNull();
  });
});

describe('encryptRaw / decryptRaw (legacy-fixed, machine metadata path)', () => {
  it('round-trips regardless of any per-row key — always the master-secret SecretBox', async () => {
    const enc = await Encryption.create(randomSecret());
    const payload = { permissionMode: 'default', modelLocked: false };
    const encrypted = await enc.encryptRaw(payload);
    expect(await enc.decryptRaw(encrypted)).toEqual(payload);
  });
});

describe('end-to-end: a session row with a wrapped dataEncryptionKey', () => {
  it('unwraps the key, opens the AES encryptor, and decrypts a message the same way the row was created', async () => {
    const enc = await Encryption.create(randomSecret());

    // Simulate the server minting a fresh per-session key and us wrapping it,
    // exactly as machineSpawnNewSession would on the way in.
    const sessionDataKey = crypto.getRandomValues(new Uint8Array(32));
    const wrappedForServer = await enc.encryptEncryptionKey(sessionDataKey);

    // ... later, fetching the session row back and decrypting a message on it.
    const unwrapped = await enc.decryptEncryptionKey(wrappedForServer);
    expect(unwrapped).not.toBeNull();
    const sessionEncryption = enc.openEncryption(unwrapped);

    const message = { role: 'user', content: { type: 'text', text: 'hello from happydeck' } };
    const [encryptedMessage] = await sessionEncryption.encrypt([message]);
    const [decryptedMessage] = await sessionEncryption.decrypt([encryptedMessage]);
    expect(decryptedMessage).toEqual(message);
  });

  it('a legacy session (no dataEncryptionKey) round-trips through the master-secret SecretBox', async () => {
    const enc = await Encryption.create(randomSecret());
    const legacyEncryption = enc.openEncryption(null);
    const message = { role: 'agent', content: { type: 'text' } };
    const [encryptedMessage] = await legacyEncryption.encrypt([message]);
    const [decryptedMessage] = await legacyEncryption.decrypt([encryptedMessage]);
    expect(decryptedMessage).toEqual(message);
  });
});

describe('getBlobKey', () => {
  it('derives a session-specific key when a session data key is given', async () => {
    const enc = await Encryption.create(randomSecret());
    const sessionDataKey = new Uint8Array(32).fill(7);
    const key = enc.getBlobKey(sessionDataKey);
    expect(key).toHaveLength(32);
    expect(key).not.toEqual(sessionDataKey);
  });

  it('falls back to the master blob key when there is no session data key', async () => {
    const enc = await Encryption.create(randomSecret());
    const a = enc.getBlobKey(null);
    const b = enc.getBlobKey(null);
    expect(a).toEqual(b);
  });
});
