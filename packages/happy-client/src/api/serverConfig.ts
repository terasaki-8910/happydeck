const DEFAULT_SERVER_URL = 'https://api.cluster-fluster.com';

/**
 * Resolution order matches happy-app/happy-cli: HAPPY_SERVER_URL env var,
 * else the production default. Trailing slashes are stripped so callers can
 * always do `${getServerUrl()}/v1/...` without a double slash.
 */
export function getServerUrl(): string {
  const fromEnv = process.env.HAPPY_SERVER_URL?.trim();
  const raw = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_SERVER_URL;
  return raw.replace(/\/+$/, '');
}
