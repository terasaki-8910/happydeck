/**
 * NOTE the direction: encodeUTF8 = string -> bytes, decodeUTF8 = bytes ->
 * string. This is the OPPOSITE of tweetnacl-util's naming. Mixing the two
 * libraries silently inverts every string<->bytes conversion in this
 * codebase — do not import tweetnacl-util alongside this file.
 */

export function encodeUTF8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function decodeUTF8(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}
