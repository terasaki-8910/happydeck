import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64 } from './base64';
import { decryptAESGCMString, encryptAESGCMString } from './aes';

const key64 = encodeBase64(new Uint8Array(32).fill(11));

describe('AES-256-GCM string encryption', () => {
  it('round-trips a string', async () => {
    const encrypted = await encryptAESGCMString('hello world', key64);
    expect(await decryptAESGCMString(encrypted, key64)).toBe('hello world');
  });

  it('round-trips JSON.stringify output (the actual production usage)', async () => {
    const value = { permissionMode: 'plan', model: 'claude-opus', n: 3, ok: true };
    const encrypted = await encryptAESGCMString(JSON.stringify(value), key64);
    const decrypted = await decryptAESGCMString(encrypted, key64);
    expect(JSON.parse(decrypted!)).toEqual(value);
  });

  it('produces the documented wire length: 12-byte IV + ciphertext + 16-byte tag', async () => {
    const encrypted = await encryptAESGCMString('a', key64);
    const decoded = decodeBase64(encrypted);
    // plaintext 'a' -> 1 byte
    expect(decoded.length).toBe(12 + 1 + 16);
  });

  it('produces a fresh random IV every time (ciphertexts differ)', async () => {
    const a = await encryptAESGCMString('same plaintext', key64);
    const b = await encryptAESGCMString('same plaintext', key64);
    expect(a).not.toBe(b);
  });

  it('fails closed (returns null) with the wrong key', async () => {
    const otherKey64 = encodeBase64(new Uint8Array(32).fill(22));
    const encrypted = await encryptAESGCMString('secret', key64);
    expect(await decryptAESGCMString(encrypted, otherKey64)).toBeNull();
  });

  it('fails closed on garbage input instead of throwing', async () => {
    expect(await decryptAESGCMString('not-valid-base64-ciphertext!!', key64)).toBeNull();
  });
});
