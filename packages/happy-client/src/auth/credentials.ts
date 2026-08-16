import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * macOS Keychain storage for the Happy account's device-link credentials.
 *
 * NODE-ONLY: this shells out to the `security` CLI, so it only works from
 * the verification scripts (and any future Node-based tooling). The Tauri
 * app itself runs in a webview with no child_process access — it must read
 * the SAME keychain item (identical SERVICE/ACCOUNT below) through a Rust
 * Tauri command (e.g. the `keyring` crate) instead of importing this file.
 * Keeping the naming here as the single source of truth for that item.
 *
 * Known limitation: `security add-generic-password -w <value>` briefly
 * exposes the JSON payload (which contains the master secret) in the local
 * process list (`ps`) while the command runs. This is a limitation of the
 * macOS Keychain CLI itself, not something Node can avoid; a hardened
 * implementation would go through Security.framework directly.
 */

const SERVICE = 'ccdeck-happy-account';
const ACCOUNT = 'default';

export interface StoredCredentials {
  schemaVersion: 1;
  /** Bearer token for the relay. Cheap to re-mint from `secret` — see auth/token.ts. */
  token: string;
  /** The 32-byte account master secret, base64url-encoded. */
  secret: string;
}

function isNotFoundError(error: unknown): boolean {
  const err = error as { code?: number; stderr?: string } | undefined;
  return err?.code === 44 || /could not be found/i.test(err?.stderr ?? '');
}

export async function getCredentials(): Promise<StoredCredentials | null> {
  try {
    const { stdout } = await execFileAsync('security', ['find-generic-password', '-a', ACCOUNT, '-s', SERVICE, '-w']);
    const raw = stdout.trim();
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
    if (parsed.schemaVersion !== 1 || typeof parsed.token !== 'string' || typeof parsed.secret !== 'string') {
      throw new Error('Stored Happy credentials in the keychain are malformed');
    }
    return parsed as StoredCredentials;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

export async function setCredentials(credentials: { token: string; secret: string }): Promise<void> {
  const payload: StoredCredentials = { schemaVersion: 1, ...credentials };
  const json = JSON.stringify(payload);
  // -U: update the item in place if it already exists, instead of failing.
  await execFileAsync('security', ['add-generic-password', '-a', ACCOUNT, '-s', SERVICE, '-w', json, '-U']);
}

export async function clearCredentials(): Promise<void> {
  try {
    await execFileAsync('security', ['delete-generic-password', '-a', ACCOUNT, '-s', SERVICE]);
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw error;
  }
}
