import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';

/**
 * HMAC-SHA512, RFC 2104. Used both directly (Happy's HD key tree, see hd.ts)
 * and as the hash function inside HMAC itself.
 */
export function hmacSha512(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha512, key, message);
}
