import { openPath } from '@tauri-apps/plugin-opener';
import type { TerminalAppChoice } from '../store/settingsStore';

/**
 * Opens a directory in a real terminal window.
 *
 * `preference` is the user's own Settings > General choice — macOS has no
 * OS-level "default terminal for a folder" the way it has a default
 * browser (`open <folder>` with no app hint opens Finder, not a
 * terminal), so there's no way to defer to a system setting the way
 * "default browser" can. An explicit non-'system' preference always
 * wins, so switching terminal apps later is a settings change, not a
 * code change.
 *
 * 'system' (no preference set) falls back to happydeck's own best-effort
 * per-platform guess: Terminal.app (always present on every Mac) is the
 * closest thing to a real platform default there. Windows/Linux aren't
 * verified against a real build yet (this project doesn't have one) —
 * `cmd` is a reasonable, always-present guess for Windows; other
 * platforms fall through to the plugin's own default-app resolution.
 */
export function openInTerminal(path: string, preference: TerminalAppChoice = 'system'): Promise<void> {
  if (preference === 'terminal') return openPath(path, 'Terminal');
  if (preference === 'iterm') return openPath(path, 'iTerm');

  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) return openPath(path, 'Terminal');
  if (platform.includes('win')) return openPath(path, 'cmd');
  return openPath(path);
}
