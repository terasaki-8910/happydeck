import { invoke } from '@tauri-apps/api/core';
import type { StateStorage } from 'zustand/middleware';

/**
 * A zustand `persist` storage backend that writes to a JSON file under the
 * OS app-config directory (via the read_app_config_file/write_app_config_file
 * Rust commands — see src-tauri/src/lib.rs for why, NOT the
 * @tauri-apps/plugin-fs JS plugin, which silently never created the file at
 * all), instead of the WKWebView's own localStorage.
 *
 * Why not localStorage: on macOS, an unsigned/ad-hoc-signed build (what
 * `tauri build` produces without a configured signing identity) gets a
 * fresh code signature every single rebuild. WKWebView's default
 * persistent storage is scoped to the running app's signing identity, not
 * just its bundle identifier -- so every `build:install` was quietly
 * handing the webview a brand-new, empty storage partition, which read as
 * "settings got reset" after each rebuild. A plain file at a fixed path
 * has no such dependency.
 */
export function createTauriFileStorage(fileName: string): StateStorage {
  return {
    async getItem(_name: string): Promise<string | null> {
      try {
        return await invoke<string | null>('read_app_config_file', { name: fileName });
      } catch (error) {
        console.error(`[tauriStorage] read failed for ${fileName}:`, error);
        return null;
      }
    },
    async setItem(_name: string, value: string): Promise<void> {
      try {
        await invoke('write_app_config_file', { name: fileName, contents: value, append: false });
      } catch (error) {
        // No Tauri runtime (e.g. plain-browser mock dev) or a genuine disk
        // error -- either way, nothing useful to do about it here beyond
        // not losing the failure silently this time.
        console.error(`[tauriStorage] write failed for ${fileName}:`, error);
      }
    },
    async removeItem(_name: string): Promise<void> {
      // Never called today -- nothing in this app invokes
      // store.persist.clearStorage().
    },
  };
}
