import { getHappyClientId } from '../api/happyClientId';
import { getServerUrl } from '../api/serverConfig';
import { encodeBase64 } from '../crypto/base64';
import { signDetached, signSeedKeyPair } from '../crypto/nacl';

/**
 * Mints a fresh bearer token from the account master secret via a
 * self-signed challenge (POST /v1/auth) — no phone involved. The account's
 * identity is hex(ed25519 pubkey), which is deterministic from `secret`, so
 * this can be called at any time (e.g. on a 401) instead of re-running the
 * QR device-link flow.
 *
 * Note: the Ed25519 keypair uses `secret` directly as the sign seed — no HD
 * derivation, unlike the X25519 content keypair in crypto/encryption.ts.
 */
export async function mintToken(secret: Uint8Array): Promise<string> {
  const keypair = await signSeedKeyPair(secret);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const signature = await signDetached(challenge, keypair.secretKey);

  const response = await fetch(`${getServerUrl()}/v1/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Happy-Client': getHappyClientId() },
    body: JSON.stringify({
      challenge: encodeBase64(challenge, 'base64'),
      signature: encodeBase64(signature, 'base64'),
      publicKey: encodeBase64(keypair.publicKey, 'base64'),
    }),
  });
  if (!response.ok) {
    throw new Error(`Token mint failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { success?: boolean; token?: string };
  if (!data.success || !data.token) {
    throw new Error('Token mint response did not include a token');
  }
  return data.token;
}
