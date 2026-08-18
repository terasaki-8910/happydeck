import type { TerminalAppChoice } from '../store/settingsStore';

/** Escapes a string for embedding as an AppleScript double-quoted string literal. */
function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Escapes a string for embedding as a single-quoted POSIX shell argument. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appleScriptFor(app: 'Terminal' | 'iTerm2', path: string): string {
  const quotedPath = `(quoted form of ${appleScriptString(path)})`;
  if (app === 'Terminal') {
    return `tell application "Terminal" to do script "cd " & ${quotedPath}\ntell application "Terminal" to activate`;
  }
  return `tell application "iTerm2" to create window with default profile command "cd " & ${quotedPath} & " && exec $SHELL -l"`;
}

/**
 * Opens a directory in a real terminal window, on the machine this
 * session is running on (only ever called for a *local* session — see
 * SessionTile's localPath gating).
 *
 * Deliberately NOT `open -a <App> <path>` (via @tauri-apps/plugin-opener):
 * confirmed live that this fails for iTerm2 specifically with "Not
 * allowed to open path X with iTerm" — a macOS Launch Services
 * restriction, since iTerm2 (unlike Terminal.app) doesn't declare
 * support for being handed an arbitrary folder path this way. AppleScript
 * is the standard, robust mechanism other dev tools (VSCode included)
 * use for exactly this "open a terminal at this directory" case, for
 * both Terminal.app and iTerm2 — so it's used uniformly here rather than
 * only as an iTerm-specific fallback.
 *
 * Runs via the machine's own `bash` RPC (osascript), the same mechanism
 * used for mkdir — this machine is one of the user's own Happy-connected
 * machines (confirmed: `localMachineId` is always a real, addressable
 * machine ID), so no new Tauri-side shell plugin is needed.
 */
export function openInTerminal(machineId: string, path: string, preference: TerminalAppChoice, runMachineBash: (machineId: string, command: string) => Promise<{ success: boolean; error?: string }>) {
  const app = preference === 'iterm' ? 'iTerm2' : 'Terminal';
  const script = appleScriptFor(app, path);
  const command = `osascript -e ${shellSingleQuote(script)}`;
  return runMachineBash(machineId, command).then((result) => {
    if (!result.success) throw new Error(result.error || `Failed to open ${app}`);
  });
}
