/**
 * AES-256-GCM via WebCrypto (`crypto.subtle`) — global in both Node >=19 and
 * any browser/webview, so this file is the isomorphic replacement for
 * happy-app's RN-only `rn-encryption` native module. Confirmed byte-for-byte
 * compatible with production ciphertext via happy-app's own
 * `sources/encryption/aes.web.ts` (their web build takes this exact path).
 *
 * Wire format: IV(12, random, prepended) || ciphertext || GCM tag(16,
 * appended — WebCrypto returns ciphertext‖tag concatenated already), all
 * base64 (standard, padded). Key is 32 bytes, passed across the function
 * boundary as a base64 string. Default GCM tag length (128 bits) — do not
 * override it.
 */
import { decodeBase64, encodeBase64 } from './base64';

const ALGO = 'AES-GCM';
const IV_LEN = 12;

async function importKey(key64: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const keyBytes = decodeBase64(key64);
  return crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: ALGO }, false, [usage]);
}

function concat(iv: Uint8Array, ciphertextWithTag: ArrayBuffer): Uint8Array {
  const out = new Uint8Array(iv.length + ciphertextWithTag.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertextWithTag), iv.length);
  return out;
}

function split(bundle: Uint8Array): { iv: Uint8Array; ciphertext: Uint8Array } {
  return { iv: bundle.slice(0, IV_LEN), ciphertext: bundle.slice(IV_LEN) };
}

export async function encryptAESGCMString(data: string, key64: string): Promise<string> {
  const key = await importKey(key64, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv: iv as BufferSource },
    key,
    new TextEncoder().encode(data) as BufferSource,
  );
  return encodeBase64(concat(iv, ciphertext));
}

export async function decryptAESGCMString(data: string, key64: string): Promise<string | null> {
  try {
    const key = await importKey(key64, 'decrypt');
    const { iv, ciphertext } = split(decodeBase64(data));
    const plaintext = await crypto.subtle.decrypt({ name: ALGO, iv: iv as BufferSource }, key, ciphertext as BufferSource);
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
