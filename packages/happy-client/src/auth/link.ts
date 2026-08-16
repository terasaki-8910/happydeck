import { getHappyClientId } from '../api/happyClientId';
import { getServerUrl } from '../api/serverConfig';
import { decodeBase64, encodeBase64 } from '../crypto/base64';
import { boxKeyPair, decryptBox } from '../crypto/nacl';

/**
 * Requester-side account-link flow (POST /v1/auth/account/request).
 *
 * The server keys the pending request row by hex(publicKey) and NEVER
 * deletes it — re-polling with the same keypair replays the old response
 * forever. A fresh ephemeral keypair is therefore required per attempt;
 * startAccountLink() must be called again to retry after a timeout.
 */

export interface AccountLinkAttempt {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  /** happy:///account?<base64url pubkey> — render this as a QR for the phone to scan. */
  qrUrl: string;
}

export interface AccountLinkResult {
  token: string;
  /** The raw 32-byte account master secret. */
  secret: Uint8Array;
}

type AccountLinkResponse = { state: 'requested' } | { state: 'authorized'; token: string; response: string };

/** Generates a fresh ephemeral keypair and the QR string. No network call yet. */
export async function startAccountLink(): Promise<AccountLinkAttempt> {
  const keypair = await boxKeyPair();
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    qrUrl: `happy:///account?${encodeBase64(keypair.publicKey, 'base64url')}`,
  };
}

async function requestAccountLink(publicKey: Uint8Array): Promise<AccountLinkResponse> {
  const response = await fetch(`${getServerUrl()}/v1/auth/account/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Happy-Client': getHappyClientId() },
    body: JSON.stringify({ publicKey: encodeBase64(publicKey, 'base64') }),
  });
  if (!response.ok) {
    throw new Error(`Account link request failed: HTTP ${response.status}`);
  }
  return (await response.json()) as AccountLinkResponse;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PollAccountLinkOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Called after every poll (success or transient failure) with elapsed ms. */
  onTick?: (elapsedMs: number) => void;
}

/**
 * Polls the same POST endpoint that registered the attempt. Unlike
 * happy-app's reference implementation (which aborts on the first HTTP
 * error), transient network/5xx errors are tolerated and retried — only a
 * successful `authorized` response or the timeout end the loop.
 */
export async function pollAccountLink(
  attempt: AccountLinkAttempt,
  options: PollAccountLinkOptions = {},
): Promise<AccountLinkResult> {
  const intervalMs = options.intervalMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    let response: AccountLinkResponse | null = null;
    try {
      response = await requestAccountLink(attempt.publicKey);
    } catch {
      // Transient error: fall through to the sleep+retry below.
    }

    if (response?.state === 'authorized') {
      const bundle = decodeBase64(response.response, 'base64');
      const secret = await decryptBox(bundle, attempt.secretKey);
      if (!secret || secret.length !== 32) {
        throw new Error('Failed to decrypt the account master secret from the approval response');
      }
      return { token: response.token, secret };
    }

    options.onTick?.(Date.now() - start);
    await sleep(intervalMs);
  }

  throw new Error('Account link timed out after 120s — generate a new QR code and try again');
}
