import sodium from 'libsodium-wrappers';
import { decodeUTF8, encodeUTF8 } from './text';

let readyPromise: Promise<typeof sodium> | null = null;

async function ready(): Promise<typeof sodium> {
  if (!readyPromise) {
    readyPromise = sodium.ready.then(() => sodium);
  }
  return readyPromise;
}

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export async function boxKeyPair(): Promise<KeyPair> {
  const s = await ready();
  const kp = s.crypto_box_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

/**
 * X25519 keypair from a 32-byte seed. libsodium hashes the seed
 * (SHA-512(seed)[0:32]) internally to get the secret scalar — this is
 * exactly the step a hand-rolled tweetnacl port would need to replicate
 * manually. Using libsodium-wrappers here gets it for free.
 */
export async function boxSeedKeyPair(seed: Uint8Array): Promise<KeyPair> {
  const s = await ready();
  const kp = s.crypto_box_seed_keypair(seed);
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

/** Ed25519 keypair from a 32-byte seed, used for the auth challenge-signature. */
export async function signSeedKeyPair(seed: Uint8Array): Promise<KeyPair> {
  const s = await ready();
  const kp = s.crypto_sign_seed_keypair(seed);
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

export async function signDetached(message: Uint8Array, secretKey: Uint8Array): Promise<Uint8Array> {
  const s = await ready();
  return s.crypto_sign_detached(message, secretKey);
}

/**
 * "Box to a public key": generates a fresh ephemeral keypair and does an
 * explicit crypto_box_easy — NOT crypto_box_seal. Wire layout:
 *   ephemeralPublicKey(32) || nonce(24) || crypto_box_easy ciphertext(+16 MAC)
 * `data` is raw bytes; callers that want to box a JS value must
 * JSON.stringify + encodeUTF8 first (see encryptEncryptionKey in
 * encryption.ts for that usage).
 */
export async function encryptBox(data: Uint8Array, recipientPublicKey: Uint8Array): Promise<Uint8Array> {
  const s = await ready();
  const ephemeral = s.crypto_box_keypair();
  const nonce = s.randombytes_buf(s.crypto_box_NONCEBYTES);
  const ciphertext = s.crypto_box_easy(data, nonce, recipientPublicKey, ephemeral.privateKey);
  const bundle = new Uint8Array(ephemeral.publicKey.length + nonce.length + ciphertext.length);
  bundle.set(ephemeral.publicKey, 0);
  bundle.set(nonce, ephemeral.publicKey.length);
  bundle.set(ciphertext, ephemeral.publicKey.length + nonce.length);
  return bundle;
}

export async function decryptBox(bundle: Uint8Array, recipientSecretKey: Uint8Array): Promise<Uint8Array | null> {
  const s = await ready();
  const pkLen = s.crypto_box_PUBLICKEYBYTES;
  const nonceLen = s.crypto_box_NONCEBYTES;
  if (bundle.length < pkLen + nonceLen) {
    return null;
  }
  const ephemeralPublicKey = bundle.slice(0, pkLen);
  const nonce = bundle.slice(pkLen, pkLen + nonceLen);
  const ciphertext = bundle.slice(pkLen + nonceLen);
  try {
    return s.crypto_box_open_easy(ciphertext, nonce, ephemeralPublicKey, recipientSecretKey);
  } catch {
    return null;
  }
}

/**
 * NaCl secretbox keyed directly by `secret` (no derivation) — the legacy
 * scheme applied when a session/machine row has no dataEncryptionKey.
 * JSON.stringify happens INSIDE, matching libsodium.ts's encryptSecretBox.
 * Wire layout: nonce(24) || ciphertext(+16 MAC).
 */
export async function encryptSecretBox(value: unknown, secret: Uint8Array): Promise<Uint8Array> {
  const s = await ready();
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const plaintext = encodeUTF8(JSON.stringify(value));
  const ciphertext = s.crypto_secretbox_easy(plaintext, nonce, secret);
  const bundle = new Uint8Array(nonce.length + ciphertext.length);
  bundle.set(nonce, 0);
  bundle.set(ciphertext, nonce.length);
  return bundle;
}

export async function decryptSecretBox(bundle: Uint8Array, secret: Uint8Array): Promise<unknown | null> {
  const s = await ready();
  const nonceLen = s.crypto_secretbox_NONCEBYTES;
  if (bundle.length < nonceLen) {
    return null;
  }
  const nonce = bundle.slice(0, nonceLen);
  const ciphertext = bundle.slice(nonceLen);
  try {
    const plaintext = s.crypto_secretbox_open_easy(ciphertext, nonce, secret);
    return JSON.parse(decodeUTF8(plaintext));
  } catch {
    return null;
  }
}

/**
 * Raw-bytes secretbox variant for binary blobs (attachments) — same layout
 * as encryptSecretBox but no JSON serialization.
 */
export async function encryptBlobBytes(data: Uint8Array, secret: Uint8Array): Promise<Uint8Array> {
  const s = await ready();
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const ciphertext = s.crypto_secretbox_easy(data, nonce, secret);
  const bundle = new Uint8Array(nonce.length + ciphertext.length);
  bundle.set(nonce, 0);
  bundle.set(ciphertext, nonce.length);
  return bundle;
}

export async function decryptBlobBytes(bundle: Uint8Array, secret: Uint8Array): Promise<Uint8Array | null> {
  const s = await ready();
  const nonceLen = s.crypto_secretbox_NONCEBYTES;
  if (bundle.length < nonceLen + 16) {
    return null;
  }
  const nonce = bundle.slice(0, nonceLen);
  const ciphertext = bundle.slice(nonceLen);
  try {
    return s.crypto_secretbox_open_easy(ciphertext, nonce, secret);
  } catch {
    return null;
  }
}
