const DEFAULT_SERVER_URL = 'https://api.cluster-fluster.com';

let serverUrlOverride: string | null = null;

/**
 * Overrides the relay endpoint. This module never reads `process.env`
 * itself (it must work unmodified in a browser/Tauri webview) — Node
 * callers that want HAPPY_SERVER_URL support call this once at startup,
 * e.g. `setServerUrl(process.env.HAPPY_SERVER_URL ?? null)`.
 */
export function setServerUrl(url: string | null): void {
  serverUrlOverride = url;
}

/** Trailing slashes are stripped so callers can always do `${getServerUrl()}/v1/...` without a double slash. */
export function getServerUrl(): string {
  const raw = serverUrlOverride?.trim() || DEFAULT_SERVER_URL;
  return raw.replace(/\/+$/, '');
}
