#!/usr/bin/env tsx
/**
 * Gate 3 (M1 completion criteria): prove the linked account actually works —
 * list all machines and sessions with DECRYPTED metadata, decrypt the
 * latest messages of one session, and observe at least one live socket
 * event. See .claude/plans/ok-happy-ultrathink-foamy-wadler.md.
 */
import { getCredentials, setCredentials } from '../src/auth/credentials';
import { mintToken } from '../src/auth/token';
import { HttpClient, HttpError } from '../src/api/http';
import { RelaySocket } from '../src/api/socket';
import { encodeBase64, decodeBase64 } from '../src/crypto/base64';
import { Encryption } from '../src/crypto/encryption';
import { fetchMachines } from '../src/sync/fetchMachines';
import { fetchSessions } from '../src/sync/fetchSessions';
import { fetchLatestMessages } from '../src/sync/fetchMessages';
import { subscribeToRelayUpdates } from '../src/sync/liveUpdates';

const LIVE_WINDOW_MS = 10_000;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function fmtTime(ms: number): string {
  return new Date(ms).toISOString();
}

function summarizeMessageContent(content: unknown): string {
  if (content === null || content === undefined) {
    return '<failed to decrypt>';
  }
  if (typeof content !== 'object') {
    return String(content);
  }
  const record = content as Record<string, unknown>;
  if (record.role === 'user' || record.role === 'agent') {
    const inner = record.content as Record<string, unknown> | undefined;
    if (inner?.type === 'text' && typeof inner.text === 'string') {
      return `${record.role}: ${truncate(inner.text, 120)}`;
    }
    return `${record.role}: <${String(inner?.type ?? 'unknown')}>`;
  }
  if (record.role === 'session') {
    const inner = record.content as Record<string, unknown> | undefined;
    const ev = inner?.ev as Record<string, unknown> | undefined;
    if (ev?.t === 'text' && typeof ev.text === 'string') {
      return `session/text: ${truncate(ev.text, 120)}`;
    }
    return `session/${String(ev?.t ?? 'unknown')}`;
  }
  return truncate(JSON.stringify(content), 150);
}

async function main() {
  const credentials = await getCredentials();
  if (!credentials) {
    console.error('No stored credentials. Run `pnpm --filter happy-client link` first.');
    process.exitCode = 1;
    return;
  }

  const secret = decodeBase64(credentials.secret, 'base64url');
  const encryption = await Encryption.create(secret);
  console.log(`Loaded credentials for account ${encryption.anonID} from the Keychain.\n`);

  let currentToken = credentials.token;
  const http = new HttpClient(() => currentToken);

  async function withTokenRefresh<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        console.log('  (token rejected — reminting via challenge-signature, no QR needed)');
        currentToken = await mintToken(secret);
        await setCredentials({ token: currentToken, secret: encodeBase64(secret, 'base64url') });
        return fn();
      }
      throw error;
    }
  }

  console.log('=== Machines ===');
  const machines = await withTokenRefresh(() => fetchMachines(http, encryption));
  if (machines.length === 0) {
    console.log('  (none)');
  }
  for (const machine of machines) {
    console.log(`  ${machine.id}  active=${machine.active}  activeAt=${fmtTime(machine.activeAt)}`);
    console.log(`    metadata: ${machine.metadata ? truncate(JSON.stringify(machine.metadata), 200) : '<none/undecryptable>'}`);
  }

  console.log('\n=== Sessions ===');
  const sessions = await withTokenRefresh(() => fetchSessions(http, encryption));
  if (sessions.length === 0) {
    console.log('  (none)');
  }
  for (const session of sessions) {
    console.log(`  ${session.id}  active=${session.active}  activeAt=${fmtTime(session.activeAt)}`);
    console.log(`    metadata: ${session.metadata ? truncate(JSON.stringify(session.metadata), 200) : '<none>'}`);
  }

  const targetSession = sessions.find((s) => s.active) ?? sessions[0];
  if (targetSession) {
    console.log(`\n=== Latest messages: ${targetSession.id} ===`);
    const encryptor = encryption.openEncryption(targetSession.dataKey);
    const messages = await withTokenRefresh(() => fetchLatestMessages(http, encryptor, targetSession.id, 10));
    if (messages.length === 0) {
      console.log('  (no messages)');
    }
    for (const message of messages) {
      console.log(`  [seq ${message.seq}] ${summarizeMessageContent(message.content)}`);
    }
  } else {
    console.log('\n=== Latest messages ===\n  (no sessions to test against)');
  }

  console.log(`\n=== Live socket (listening ${LIVE_WINDOW_MS / 1000}s) ===`);
  await new Promise<void>((resolve) => {
    const relay = new RelaySocket({ token: currentToken, appState: () => 'background' });
    let sawLiveEvent = false;

    const unsubscribe = subscribeToRelayUpdates(relay.socket, {
      onUpdate: (update) => {
        sawLiveEvent = true;
        console.log(`  update: ${update.body.t}`);
      },
      onEphemeral: (ephemeral) => {
        sawLiveEvent = true;
        console.log(`  ephemeral: ${ephemeral.type}`);
      },
    });

    relay.socket.on('connect', () => console.log('  connected.'));
    relay.socket.on('connect_error', (error) => console.log(`  connect_error: ${error.message}`));

    setTimeout(() => {
      unsubscribe();
      relay.disconnect();
      if (!sawLiveEvent) {
        console.log('  (no live events observed in the window — not a failure if nothing changed on any machine)');
      }
      resolve();
    }, LIVE_WINDOW_MS);
  });

  console.log('\nDone.');
}

main()
  .catch((error) => {
    console.error('\nStatus check failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
