import type { TerminalAppChoice } from '../store/settingsStore';

/** Escapes a string for embedding as an AppleScript double-quoted string literal. */
function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Escapes a string for embedding as a single-quoted POSIX shell argument. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appleScriptFor(app: 'Terminal' | 'iTerm2', command: string): string {
  if (app === 'Terminal') {
    return `tell application "Terminal" to do script ${appleScriptString(command)}\ntell application "Terminal" to activate`;
  }
  return `tell application "iTerm2" to create window with default profile command ${appleScriptString(command)}`;
}

export interface RemoteTarget {
  sshTarget: string;
  /** The session's own machine's platform (e.g. 'win32'/'linux'/'darwin'), for picking a remote shell. */
  platform?: string;
}

/**
 * Builds the POSIX shell command line to type into a LOCAL Terminal/iTerm
 * window — either a plain `cd` into a local path, or an `ssh` hop into a
 * remote session's machine followed by a `cd` there. There's no dedicated
 * "open a shell" verb in Happy's protocol, so a remote open is just SSH from
 * this machine — the user is expected to already have key-based SSH access
 * to their other machines (this doesn't manage credentials).
 *
 * The Windows branch invokes pwsh explicitly with a double-quoted -Command
 * argument (rather than a bare `cd '<path>' && pwsh`) so it parses correctly
 * regardless of whether the remote OpenSSH server's configured default shell
 * is cmd.exe or PowerShell — both parse `pwsh -NoExit -Command "..."` the
 * same way. Not verified against a real Windows sshd (no such machine
 * reachable from this dev environment) — worth confirming on the actual
 * omen6 box the first time it's used.
 */
function buildShellCommand(path: string, remote?: RemoteTarget): string {
  if (!remote) return `cd ${shellSingleQuote(path)} && exec $SHELL -l`;
  const remoteCommand =
    remote.platform === 'win32'
      ? `pwsh -NoExit -Command "Set-Location -LiteralPath '${path.replace(/'/g, "''")}'"`
      : `cd ${shellSingleQuote(path)} && exec $SHELL -l`;
  return `ssh -t ${shellSingleQuote(remote.sshTarget)} ${shellSingleQuote(remoteCommand)}`;
}

/**
 * Opens a terminal window on THIS machine (the one happydeck itself runs
 * on), landing either in a local path or — via `remote` — SSH'd into
 * another Happy-connected machine's matching path.
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
 * Runs via the LOCAL machine's own `bash` RPC (osascript) — always the
 * local machine, even for a remote target, since the terminal window itself
 * always opens on this Mac; only the shell *inside* it hops out over SSH.
 */
export function openInTerminal(
  localMachineId: string,
  path: string,
  preference: TerminalAppChoice,
  runMachineBash: (machineId: string, command: string) => Promise<{ success: boolean; error?: string }>,
  remote?: RemoteTarget,
) {
  const app = preference === 'iterm' ? 'iTerm2' : 'Terminal';
  const shellCommand = buildShellCommand(path, remote);
  const script = appleScriptFor(app, shellCommand);
  const command = `osascript -e ${shellSingleQuote(script)}`;
  return runMachineBash(localMachineId, command).then((result) => {
    if (!result.success) throw new Error(result.error || `Failed to open ${app}`);
  });
}
