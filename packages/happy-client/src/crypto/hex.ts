const HEX_CHARS = '0123456789abcdef';

/** Isomorphic hex encoder (lowercase) — no `Buffer`, so this works in the browser/Tauri webview as well as Node. */
export function encodeHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    out += HEX_CHARS[byte >> 4] + HEX_CHARS[byte & 0x0f];
  }
  return out;
}
