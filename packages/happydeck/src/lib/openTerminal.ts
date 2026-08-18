import { openPath } from '@tauri-apps/plugin-opener';

/**
 * Opens a directory in a real terminal window. Deliberately doesn't
 * hardcode a specific third-party app (e.g. iTerm) — the user may not
 * keep using any particular one, and this needs to make sense on
 * whatever OS happydeck itself is running on, not just this machine.
 *
 * macOS has no OS-level "default terminal for a folder" the way it has a
 * default browser — `open <folder>` with no app hint opens Finder, not a
 * terminal — so Terminal.app (always present on every Mac) is the
 * closest thing to a real platform default. Windows/Linux aren't
 * verified against a real build yet (this project doesn't have one) —
 * `cmd` is a reasonable, always-present guess for Windows; other
 * platforms fall through to the plugin's own default-app resolution.
 */
export function openInTerminal(path: string): Promise<void> {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) return openPath(path, 'Terminal');
  if (platform.includes('win')) return openPath(path, 'cmd');
  return openPath(path);
}
