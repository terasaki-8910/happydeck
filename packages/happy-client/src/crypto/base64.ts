/**
 * base64 / base64url codec, isomorphic (Node >=18 and browser both expose
 * global atob/btoa). Standard base64 is padded; base64url is unpadded and
 * URL-safe. Matches happy-app's sources/encryption/base64.ts semantics
 * exactly (see base64.appspec.ts vectors ported in base64.test.ts).
 *
 * Wire convention across the whole protocol: every HTTP/socket payload field
 * uses standard padded base64; base64url is used only for the on-disk
 * master secret and the QR device-link public key.
 */

// Encode/decode in chunks to avoid `String.fromCharCode(...bytes)` blowing
// the call stack on large blobs.
const CHUNK_SIZE = 0x8000;

export type Base64Encoding = 'base64' | 'base64url';

export function encodeBase64(bytes: Uint8Array, encoding: Base64Encoding = 'base64'): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  const standard = btoa(binary);
  if (encoding === 'base64url') {
    return standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return standard;
}

export function decodeBase64(value: string, encoding: Base64Encoding = 'base64'): Uint8Array {
  let standard = value;
  if (encoding === 'base64url') {
    standard = value.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (standard.length % 4)) % 4;
    standard += '='.repeat(padLength);
  }
  const binary = atob(standard);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
