import { invoke } from '@tauri-apps/api/core';
import { claudeUsageTimeoutError, credentialsReadTimeoutError, credentialsWriteTimeoutError, localMachineIdTimeoutError } from './errorMessages';
import { useSettingsStore } from '../store/settingsStore';

export interface StoredCredentials {
  schemaVersion: 1;
  token: string;
  secret: string;
}

const KEYCHAIN_TIMEOUT_MS = 15_000;
// `claude -p "/usage"` measured at ~3.5s live; this is headroom to catch a
// genuine hang (e.g. the resolved binary path no longer exists), not a
// budget it's expected to approach in normal operation.
const CLAUDE_USAGE_TIMEOUT_MS = 20_000;

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
function withTauriTimeout<T>(promise: Promise<T>, message: string, timeoutMs: number = KEYCHAIN_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
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
  return withTauriTimeout(invoke<StoredCredentials | null>('get_credentials'), credentialsReadTimeoutError(useSettingsStore.getState().language));
}

/** Saves Happy account credentials to the macOS Keychain — the write side, used by the in-app QR device-link flow. */
export async function setStoredCredentials(credentials: StoredCredentials): Promise<void> {
  return withTauriTimeout(invoke<void>('set_credentials', { credentials }), credentialsWriteTimeoutError(useSettingsStore.getState().language));
}

/** This machine's Happy machineId, read from ~/.happy/settings.json via the Rust bridge. */
export async function getLocalMachineId(): Promise<string | null> {
  return withTauriTimeout(invoke<string | null>('get_local_machine_id'), localMachineIdTimeoutError(useSettingsStore.getState().language));
}

/**
 * Vertically centers the native macOS traffic-light buttons within the
 * real, rendered height of the `.titlebar` element (a no-op on other
 * platforms) — see src-tauri/src/macos_titlebar.rs for why this can't be
 * a fixed value in tauri.conf.json. Fire-and-forget: a failure here is a
 * cosmetic miss, not worth surfacing to the user or retrying.
 */
export function positionTrafficLights(titlebarHeight: number): void {
  invoke('position_traffic_lights', { titlebarHeight }).catch(() => {});
}

/**
 * Raw stdout of `claude -p "/usage" --output-format json`, via the Rust
 * bridge (src-tauri/src/claude_usage.rs). Deliberately returns the
 * unparsed string — see src/lib/claudeUsage.ts for why parsing lives on
 * this side instead.
 */
export async function getClaudeUsageRaw(): Promise<string> {
  return withTauriTimeout(invoke<string>('claude_usage'), claudeUsageTimeoutError(useSettingsStore.getState().language), CLAUDE_USAGE_TIMEOUT_MS);
}
