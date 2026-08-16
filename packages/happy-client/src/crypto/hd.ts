import { hmacSha512 } from './hmacSha512';

/**
 * Happy's client-side key derivation tree.
 *
 * NOT BIP32: the root step uses the usage label as the HMAC key and the seed
 * as the message (BIP32 does the opposite), and child derivation walks a
 * string-labeled path (not integer indices). See happy-crypto research
 * findings for the byte-exact spec this ports.
 */

const textEncoder = new TextEncoder();

export interface KeyTreeNode {
  key: Uint8Array;
  chainCode: Uint8Array;
}

export function deriveSecretKeyTreeRoot(seed: Uint8Array, usage: string): KeyTreeNode {
  const hmacKey = textEncoder.encode(`${usage} Master Seed`);
  const digest = hmacSha512(hmacKey, seed);
  return {
    key: digest.slice(0, 32),
    chainCode: digest.slice(32, 64),
  };
}

export function deriveSecretKeyTreeChild(chainCode: Uint8Array, index: string): KeyTreeNode {
  const indexBytes = textEncoder.encode(index);
  const message = new Uint8Array(1 + indexBytes.length);
  message[0] = 0x00; // separator
  message.set(indexBytes, 1);
  const digest = hmacSha512(chainCode, message);
  return {
    key: digest.slice(0, 32),
    chainCode: digest.slice(32, 64),
  };
}

/**
 * Derives a 32-byte key from `seed` under `usage`, walking `path` as a chain
 * of string-labeled child derivations. Empty `path` returns the root key.
 */
export function deriveKey(seed: Uint8Array, usage: string, path: string[]): Uint8Array {
  let node = deriveSecretKeyTreeRoot(seed, usage);
  for (const index of path) {
    node = deriveSecretKeyTreeChild(node.chainCode, index);
  }
  return node.key;
}
