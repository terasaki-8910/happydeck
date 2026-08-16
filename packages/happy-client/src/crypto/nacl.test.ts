import { describe, expect, it } from 'vitest';
import {
  boxKeyPair,
  boxSeedKeyPair,
  decryptBlobBytes,
  decryptBox,
  decryptSecretBox,
  encryptBlobBytes,
  encryptBox,
  encryptSecretBox,
  signDetached,
  signSeedKeyPair,
} from './nacl';

describe('box (crypto_box_easy, explicit ephemeral keypair)', () => {
  it('round-trips a value between two parties', async () => {
    const recipient = await boxKeyPair();
    const plaintext = new TextEncoder().encode('the master secret, 32 bytes long');
    const bundle = await encryptBox(plaintext, recipient.publicKey);
    const decrypted = await decryptBox(bundle, recipient.secretKey);
    expect(decrypted).toEqual(plaintext);
  });

  it('produces the documented wire layout: ephPk(32) || nonce(24) || ct+MAC(16)', async () => {
    const recipient = await boxKeyPair();
    const plaintext = new Uint8Array(32);
    const bundle = await encryptBox(plaintext, recipient.publicKey);
    expect(bundle.length).toBe(32 + 24 + (32 + 16));
  });

  it('fails to open with the wrong secret key', async () => {
    const recipient = await boxKeyPair();
    const other = await boxKeyPair();
    const bundle = await encryptBox(new TextEncoder().encode('secret'), recipient.publicKey);
    expect(await decryptBox(bundle, other.secretKey)).toBeNull();
  });

  it('never throws on garbage input', async () => {
    const recipient = await boxKeyPair();
    expect(await decryptBox(new Uint8Array(10), recipient.secretKey)).toBeNull();
    expect(await decryptBox(new Uint8Array(0), recipient.secretKey)).toBeNull();
  });
});

describe('crypto_box_seed_keypair (X25519 from a 32-byte seed)', () => {
  it('is deterministic for a given seed', async () => {
    const seed = new Uint8Array(32).fill(7);
    const a = await boxSeedKeyPair(seed);
    const b = await boxSeedKeyPair(seed);
    expect(a.publicKey).toEqual(b.publicKey);
    expect(a.secretKey).toEqual(b.secretKey);
  });

  it('produces different keys for different seeds', async () => {
    const a = await boxSeedKeyPair(new Uint8Array(32).fill(1));
    const b = await boxSeedKeyPair(new Uint8Array(32).fill(2));
    expect(a.publicKey).not.toEqual(b.publicKey);
  });
});

describe('crypto_sign_seed_keypair + detached signature (auth challenge)', () => {
  it('produces a verifiable 64-byte detached signature', async () => {
    const seed = new Uint8Array(32).fill(9);
    const keypair = await signSeedKeyPair(seed);
    const challenge = new Uint8Array(32).fill(3);
    const signature = await signDetached(challenge, keypair.secretKey);
    expect(signature.length).toBe(64);
  });

  it('is deterministic for a given seed', async () => {
    const seed = new Uint8Array(32).fill(9);
    const a = await signSeedKeyPair(seed);
    const b = await signSeedKeyPair(seed);
    expect(a.publicKey).toEqual(b.publicKey);
  });
});

describe('secretbox (JSON.stringify inside, keyed by a raw 32-byte secret)', () => {
  it('round-trips a JS value', async () => {
    const secret = new Uint8Array(32).fill(5);
    const value = { hello: 'world', n: 42, nested: [1, 2, 3] };
    const bundle = await encryptSecretBox(value, secret);
    expect(await decryptSecretBox(bundle, secret)).toEqual(value);
  });

  it('produces the documented wire layout: nonce(24) || ct+MAC(16)', async () => {
    const secret = new Uint8Array(32).fill(5);
    const bundle = await encryptSecretBox('x', secret);
    // plaintext is JSON.stringify('x') = '"x"' -> 3 bytes
    expect(bundle.length).toBe(24 + 3 + 16);
  });

  it('fails to open with the wrong key', async () => {
    const secret = new Uint8Array(32).fill(5);
    const wrong = new Uint8Array(32).fill(6);
    const bundle = await encryptSecretBox('x', secret);
    expect(await decryptSecretBox(bundle, wrong)).toBeNull();
  });
});

describe('blob secretbox (raw bytes, no JSON — for attachments)', () => {
  it('round-trips raw bytes and matches length === data.length + 24 + 16', async () => {
    const secret = new Uint8Array(32).fill(1);
    const data = new Uint8Array(1000).map((_, i) => i % 256);
    const bundle = await encryptBlobBytes(data, secret);
    expect(bundle.length).toBe(data.length + 24 + 16);
    expect(await decryptBlobBytes(bundle, secret)).toEqual(data);
  });
});
