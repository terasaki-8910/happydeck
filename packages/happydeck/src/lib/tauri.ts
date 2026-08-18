import { invoke } from '@tauri-apps/api/core';

export interface StoredCredentials {
  schemaVersion: 1;
  token: string;
  secret: string;
}

const KEYCHAIN_TIMEOUT_MS = 15_000;

/**
 * invoke() has no built-in timeout — unlike fetch(), a hung Rust-side call
 * blocks the caller's await forever with no error, no retry path, nothing.
 * Confirmed as a real failure mode, not theoretical: get_credentials calls
 * into macOS's Security framework (SecKeychainFindGenericPassword, visible
 * in Console/`log show` as an activity-trace entry), which can end up
 * waiting on a Keychain access prompt that — for reasons not fully
 * understood yet (ad-hoc dev-build code signature changing on every
 * rebuild is the leading theory) — sometimes never actually renders on
 * screen. Without this, that hang is invisible and permanent: the app
 * sits in status:'loading' forever, no error, nothing to retry.
 */
function withTauriTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), KEYCHAIN_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Reads the Happy account credentials from the macOS Keychain via the Rust bridge (src-tauri/src/lib.rs). */
export async function getStoredCredentials(): Promise<StoredCredentials | null> {
  return withTauriTimeout(
    invoke<StoredCredentials | null>('get_credentials'),
    'Reading account credentials from the macOS Keychain timed out. A Keychain access prompt may be stuck behind another window, or failed to appear at all (known to happen with dev builds, whose code signature changes on every rebuild) — check for a "happydeck wants to access…" dialog on another Space/window, then Retry. If it keeps happening, try Keychain Access.app → search "ccdeck-happy-account" → check its access control, or quit happydeck fully (not just close the window) and reopen it.',
  );
}

/** Saves Happy account credentials to the macOS Keychain — the write side, used by the in-app QR device-link flow. */
export async function setStoredCredentials(credentials: StoredCredentials): Promise<void> {
  return withTauriTimeout(invoke<void>('set_credentials', { credentials }), 'Saving account credentials to the macOS Keychain timed out — same likely cause as the read-side timeout (see getStoredCredentials).');
}

/** This machine's Happy machineId, read from ~/.happy/settings.json via the Rust bridge. */
export async function getLocalMachineId(): Promise<string | null> {
  return withTauriTimeout(invoke<string | null>('get_local_machine_id'), "Reading this machine's Happy ID (~/.happy/settings.json) timed out unexpectedly — this is a plain local file read, so if this fires the Tauri IPC bridge itself is likely stuck rather than anything keychain-specific.");
}
