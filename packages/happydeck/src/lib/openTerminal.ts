import type { DecryptedMachine } from 'happy-client';
import { sshTargetMissingError, terminalOpenFailedError } from './errorMessages';
import { type Language, useSettingsStore, type TerminalAppChoice, type TerminalWindowMode } from '../store/settingsStore';

/** Escapes a string for embedding as an AppleScript double-quoted string literal. */
function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Escapes a string for embedding as a single-quoted POSIX shell argument. */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Terminal.app: `do script` both creates the shell AND runs the command in
 * one step. `do script X in front window` opens X as a new TAB in the
 * existing front window instead of a new window — but errors if no window
 * exists yet, hence the branch.
 */
function appleScriptForTerminal(cmd: string, windowMode: TerminalWindowMode): string {
  const quotedCmd = appleScriptString(cmd);
  const newTabLine = `if (count of windows) > 0 then\n    do script ${quotedCmd} in front window\n  else\n    do script ${quotedCmd}\n  end if`;
  return `tell application "Terminal"\n  activate\n  ${windowMode === 'tab' ? newTabLine : `do script ${quotedCmd}`}\nend tell`;
}

/**
 * iTerm2: opening a window/tab with an overridden session *command* treats
 * that command as the session's entire process — if it exits for any reason
 * (confirmed happening: `exec $SHELL -l` failing because `$SHELL` isn't set
 * in the daemon's environment that spawns osascript), iTerm shows "A session
 * ended very soon after starting" and the window closes. Instead, open a
 * window/tab with its normal default profile (own shell, own startup) and
 * `write text` the command into it afterward — the same "type it in" model
 * Terminal.app's `do script` already uses, robust regardless of what's set
 * in the profile or the daemon's environment. A freshly created tab/window
 * becomes iTerm's "current" one, so `current session of current window`
 * always refers to the one just created.
 */
function appleScriptForITerm(cmd: string, windowMode: TerminalWindowMode): string {
  const quotedCmd = appleScriptString(cmd);
  const create =
    windowMode === 'tab'
      ? `if (count of windows) > 0 then\n    tell current window to create tab with default profile\n  else\n    create window with default profile\n  end if`
      : `create window with default profile`;
  return `tell application "iTerm2"\n  activate\n  ${create}\n  tell current session of current window to write text ${quotedCmd}\nend tell`;
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
 * to their other machines (this doesn't manage credentials). Deliberately
 * just lands in the directory rather than also resuming the Claude session
 * there — kept to that one job on purpose.
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
  if (!remote) return `cd ${shellSingleQuote(path)}`;
  const remoteCommand =
    remote.platform === 'win32'
      ? `pwsh -NoExit -Command "Set-Location -LiteralPath '${path.replace(/'/g, "''")}'"`
      : `cd ${shellSingleQuote(path)} && exec $SHELL -l`;
  return `ssh -t ${shellSingleQuote(remote.sshTarget)} ${shellSingleQuote(remoteCommand)}`;
}

/**
 * Opens a terminal window/tab on THIS machine (the one happydeck itself
 * runs on), landing either in a local path or — via `remote` — SSH'd into
 * another Happy-connected machine's matching path.
 *
 * Deliberately NOT `open -a <App> <path>` (via @tauri-apps/plugin-opener):
 * confirmed live that this fails for iTerm2 specifically with "Not
 * allowed to open path X with iTerm" — a macOS Launch Services
 * restriction, since iTerm2 (unlike Terminal.app) doesn't declare
 * support for being handed an arbitrary folder path this way. AppleScript
 * is the standard, robust mechanism other dev tools (VSCode included)
 * use for exactly this "open a terminal at this directory" case.
 *
 * Runs via the LOCAL machine's own `bash` RPC (osascript) — always the
 * local machine, even for a remote target, since the terminal window itself
 * always opens on this Mac; only the shell *inside* it hops out over SSH.
 */
export function openInTerminal(
  localMachineId: string,
  path: string,
  preference: TerminalAppChoice,
  windowMode: TerminalWindowMode,
  runMachineBash: (machineId: string, command: string) => Promise<{ success: boolean; error?: string }>,
  remote?: RemoteTarget,
) {
  const app = preference === 'iterm' ? 'iTerm2' : 'Terminal';
  const shellCommand = buildShellCommand(path, remote);
  const script = app === 'Terminal' ? appleScriptForTerminal(shellCommand, windowMode) : appleScriptForITerm(shellCommand, windowMode);
  const command = `osascript -e ${shellSingleQuote(script)}`;
  return runMachineBash(localMachineId, command).then((result) => {
    if (!result.success) throw new Error(result.error || terminalOpenFailedError(useSettingsStore.getState().language, app));
  });
}

export interface OpenTerminalContext {
  localMachineId: string | null;
  machines: DecryptedMachine[];
  terminalApp: TerminalAppChoice;
  terminalWindowMode: TerminalWindowMode;
  sshTargets: Record<string, string>;
  runMachineBash: (machineId: string, command: string) => Promise<{ success: boolean; error?: string }>;
  language: Language;
}

/**
 * Resolves the "Open in Terminal" action for a session (or undefined when
 * it isn't eligible — no known path, or this machine's own id isn't known
 * yet), shared between the tile header menu and the sidebar's context menu
 * so both branch on local-vs-remote/SSH the exact same way rather than
 * maintaining two copies that could quietly drift apart.
 */
export function resolveOpenTerminalAction(
  metadata: { path?: string; host?: string; machineId?: string } | null,
  ctx: OpenTerminalContext,
): (() => Promise<void>) | undefined {
  if (!metadata?.path || !ctx.localMachineId) return undefined;
  const path = metadata.path;
  const localMachineId = ctx.localMachineId;
  const isLocalSession = metadata.machineId === localMachineId;

  return async () => {
    if (isLocalSession) {
      await openInTerminal(localMachineId, path, ctx.terminalApp, ctx.terminalWindowMode, ctx.runMachineBash);
      return;
    }
    const sshTarget = metadata.machineId ? ctx.sshTargets[metadata.machineId] : undefined;
    if (!sshTarget) throw new Error(sshTargetMissingError(ctx.language, metadata.host ?? (ctx.language === 'ja' ? 'このマシン' : 'this machine')));
    const remoteMachine = metadata.machineId ? ctx.machines.find((m) => m.id === metadata.machineId) : undefined;
    const remoteMachinePlatform = (remoteMachine?.metadata as { platform?: string } | null)?.platform;
    await openInTerminal(localMachineId, path, ctx.terminalApp, ctx.terminalWindowMode, ctx.runMachineBash, {
      sshTarget,
      platform: remoteMachinePlatform,
    });
  };
}
