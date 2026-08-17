import { invoke } from '@tauri-apps/api/core';

export interface StoredCredentials {
  schemaVersion: 1;
  token: string;
  secret: string;
}

/** Reads the Happy account credentials from the macOS Keychain via the Rust bridge (src-tauri/src/lib.rs). */
export async function getStoredCredentials(): Promise<StoredCredentials | null> {
  return invoke<StoredCredentials | null>('get_credentials');
}

/** Saves Happy account credentials to the macOS Keychain — the write side, used by the in-app QR device-link flow. */
export async function setStoredCredentials(credentials: StoredCredentials): Promise<void> {
  return invoke<void>('set_credentials', { credentials });
}

/** This machine's Happy machineId, read from ~/.happy/settings.json via the Rust bridge. */
export async function getLocalMachineId(): Promise<string | null> {
  return invoke<string | null>('get_local_machine_id');
}
