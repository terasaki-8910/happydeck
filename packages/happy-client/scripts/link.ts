#!/usr/bin/env tsx
/**
 * Gate 2: link this Mac as a full "user-scoped" Happy device.
 *
 * Shows a QR code — scan it with the existing, unmodified Happy iPhone app
 * (Settings → Account → Link New Device) to approve. On success, stores the
 * account's master secret + bearer token in the macOS Keychain
 * (see src/auth/credentials.ts for the exact item).
 *
 * SECURITY: the master secret decrypts every machine and session on the
 * account. This script never logs it, in any form (raw, base64, or
 * truncated) — only success/failure and non-secret metadata are printed.
 */
import qrcodeTerminal from 'qrcode-terminal';
import { setServerUrl } from '../src/api/serverConfig';
import { setCredentials } from '../src/auth/credentials';
import { pollAccountLink, startAccountLink } from '../src/auth/link';
import { Encryption } from '../src/crypto/encryption';
import { encodeBase64 } from '../src/crypto/base64';

setServerUrl(process.env.HAPPY_SERVER_URL ?? null);

async function main() {
  console.log('Generating a device-link request...\n');
  const attempt = await startAccountLink();

  qrcodeTerminal.generate(attempt.qrUrl, { small: true }, (qr) => {
    console.log(qr);
  });
  console.log('Scan this QR with the Happy app on your phone:');
  console.log('  Settings -> Account -> Link New Device\n');
  console.log('Waiting for approval (up to 120s)...');

  const result = await pollAccountLink(attempt, {
    onTick: (elapsedMs) => {
      process.stdout.write(`\r  ...still waiting (${Math.round(elapsedMs / 1000)}s)`);
    },
  });
  process.stdout.write('\n');

  await setCredentials({
    token: result.token,
    secret: encodeBase64(result.secret, 'base64url'),
  });

  // Sanity check: derive the account's non-secret analytics ID as proof the
  // stored secret is usable, without ever printing the secret itself.
  const encryption = await Encryption.create(result.secret);

  console.log('\nLinked. Credentials stored in the macOS Keychain.');
  console.log(`  account id (non-secret):  ${encryption.anonID}`);
  console.log(`  content public key:       ${encodeBase64(encryption.contentKeyPair.publicKey, 'base64url')}`);
  console.log('\nRun `pnpm --filter happy-client status` next.');
}

main().catch((error) => {
  console.error('\nDevice link failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
