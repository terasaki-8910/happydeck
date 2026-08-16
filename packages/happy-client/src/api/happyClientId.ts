const CCDECK_VERSION = '0.1.0';

/**
 * The `X-Happy-Client` header / socket handshake `happyClient` field.
 * Server-side this only feeds a Prometheus label and (as a header fallback)
 * the socket handshake — nothing rejects an unrecognized value.
 *
 * happy-app detects `desktop` by checking `'__TAURI__' in window`; these
 * Node verification scripts have no `window`, so this is hardcoded. Once
 * ccdeck's Tauri webview consumes this package, this should become a real
 * `'__TAURI__' in window` check mirroring the original.
 */
export function getHappyClientId(): string {
  return `desktop/${CCDECK_VERSION}`;
}
