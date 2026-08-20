import { invoke } from '@tauri-apps/api/core';

const LOG_FILE = 'error.log';
// Rough cap so a debug log left running for weeks doesn't grow unbounded --
// not exact log rotation, just a periodic reset once it's clearly past
// "still useful to skim."
const MAX_LOG_BYTES = 512_000;

let writeChain: Promise<void> = Promise.resolve();

/**
 * Appends every action failure (see runAction in SessionTile.tsx) to a
 * plain-text log under the OS app-config directory, in full, regardless of
 * how the user-facing message gets summarized. The UI-facing error text can
 * only ever show a short human sentence — this is what to actually look at
 * when that's not enough to tell what happened.
 *
 * Uses the read_app_config_file/write_app_config_file Rust commands (see
 * src-tauri/src/lib.rs), same as tauriStorage.ts — NOT @tauri-apps/plugin-fs,
 * which turned out to silently never write anything at all.
 */
export function logError(context: string, error: unknown): void {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const line = `[${new Date().toISOString()}] ${context}\n${detail}\n\n`;
  // Chained, not fired in parallel -- concurrent appends could otherwise
  // interleave (two appends racing on the same file have no ordering
  // guarantee against each other).
  writeChain = writeChain.then(async () => {
    try {
      const existing = await invoke<string | null>('read_app_config_file', { name: LOG_FILE });
      const append = !existing || existing.length <= MAX_LOG_BYTES;
      await invoke('write_app_config_file', { name: LOG_FILE, contents: line, append });
    } catch {
      // No Tauri runtime (plain-browser mock dev) or a genuine disk error --
      // the in-app error message is still shown either way, this is purely
      // the extra debug trail.
    }
  });
}
