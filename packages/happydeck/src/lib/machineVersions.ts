/**
 * Reads — and, on request, updates — the happy CLI and Claude Code
 * installed on one of the account's machines, for the popover behind the
 * host badge on a session tile.
 *
 * Everything in here is either a pure parser/command builder (tested in
 * machineVersions.test.ts) or the npm-registry fetch; the RPC plumbing and
 * caching live in store/machineVersionStore.ts. The split exists because
 * the parsers are the part that silently rots when a CLI changes its
 * output, and that is cheap to pin down with tests and impossible to pin
 * down through a store that needs a live machine.
 */

import { shellSingleQuote } from './openTerminal';
import { joinPath } from './paths';

/**
 * How Claude Code was installed, as Claude Code itself reports it —
 * `claude doctor` prints `Running: ${installationType} (${version})`.
 * The named values are the ones found verbatim in the installed 2.1.283
 * binary; anything else it might print maps to 'unknown', which only ever
 * costs the user the auto-update button, never a wrong command.
 */
export type InstallMethod = 'npm-global' | 'native' | 'homebrew' | 'development' | 'local' | 'unknown';

const KNOWN_INSTALL_METHODS: InstallMethod[] = ['npm-global', 'native', 'homebrew', 'development', 'local'];

/** npm package ids. `happy-coder` is the OLD name (stuck at 1.1.9 on the registry) — the live package is plain `happy`. */
export const HAPPY_NPM_PACKAGE = 'happy';
export const CLAUDE_NPM_PACKAGE = '@anthropic-ai/claude-code';

export interface ClaudeProbe {
  version: string | null;
  method: InstallMethod;
}

/**
 * Parses `claude doctor`'s own summary line:
 *
 *     Running: npm-global (2.1.283)
 *
 * Preferred over `claude --version` because it answers BOTH questions at
 * once — which version, and which installer owns it — and the second one
 * decides whether an update is `npm install -g` or `claude install`.
 * Guessing it from the resolved binary path instead would mean shipping a
 * path heuristic that has to track every installer Claude Code gains.
 */
export function parseClaudeDoctor(stdout: string): ClaudeProbe | null {
  const match = /^\s*Running:\s*(\S+)\s*\(([^)]+)\)/m.exec(stdout);
  if (!match) return null;
  const method = KNOWN_INSTALL_METHODS.find((m) => m === match[1]) ?? 'unknown';
  return { version: normalizeVersion(match[2]), method };
}

/**
 * Fallback for a machine where `claude doctor` failed or printed something
 * unrecognized: `claude --version` prints `2.1.283 (Claude Code)`. Yields
 * no install method, so the update button stays off and the popover shows
 * the command to run by hand instead of running the wrong one.
 */
export function parseClaudeVersion(stdout: string): string | null {
  const match = /(\d+\.\d+\.\d+[\w.+-]*)/.exec(stdout);
  return match ? match[1] : null;
}

/** `happy --version` prints `happy version: 1.2.5` (plus an unrelated Claude Code line after it). */
export function parseHappyVersion(stdout: string): string | null {
  const match = /happy\s+version:\s*(\S+)/i.exec(stdout);
  if (match) return normalizeVersion(match[1]);
  return parseClaudeVersion(stdout);
}

/**
 * `npm ls -g <pkg> --depth=0 --json`, which exits 0 and prints
 * `{"name":"lib"}` with no `dependencies` key when the package simply
 * isn't installed globally — so this doubles as the npm-global test for
 * happy, which has no `doctor`-style self-report of its own.
 */
export function parseNpmLsVersion(stdout: string, pkg: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { dependencies?: Record<string, { version?: string }> };
    const version = parsed.dependencies?.[pkg]?.version;
    return typeof version === 'string' ? normalizeVersion(version) : null;
  } catch {
    return null;
  }
}

function normalizeVersion(raw: string): string | null {
  const trimmed = raw.trim().replace(/^v/, '');
  return trimmed.length > 0 ? trimmed : null;
}

export type VersionComparison = 'behind' | 'current' | 'ahead' | 'unknown';

/**
 * Numeric-segment compare, prerelease-blind on purpose: both CLIs ship
 * plain `x.y.z` releases, and the only question being asked is "is there
 * something newer on the registry". An unparseable or missing side answers
 * 'unknown' rather than guessing — the popover then shows the versions
 * without claiming anything about the gap.
 */
export function compareVersions(installed: string | null, latest: string | null): VersionComparison {
  const a = numericSegments(installed);
  const b = numericSegments(latest);
  if (!a || !b) return 'unknown';
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left < right) return 'behind';
    if (left > right) return 'ahead';
  }
  return 'current';
}

function numericSegments(version: string | null): number[] | null {
  if (!version) return null;
  const core = version.split(/[-+]/)[0];
  const parts = core.split('.');
  const numbers: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    numbers.push(Number(part));
  }
  return numbers.length > 0 ? numbers : null;
}

//
// Probe commands
//

/**
 * Deliberately three separate one-shot commands rather than one composed
 * script: the bash RPC hands the whole string to `child_process.exec`,
 * which is `sh -c` on POSIX and `cmd.exe` on Windows, and those two agree
 * on almost no syntax beyond "run this program". Three round trips over an
 * already-open socket cost far less than a Windows path nobody can test
 * from here.
 */
export const CLAUDE_DOCTOR_COMMAND = 'claude doctor';
export const CLAUDE_VERSION_COMMAND = 'claude --version';
export const HAPPY_VERSION_COMMAND = 'happy --version';
export const CLAUDE_NPM_LS_COMMAND = `npm ls -g ${CLAUDE_NPM_PACKAGE} --depth=0 --json`;
export const HAPPY_NPM_LS_COMMAND = `npm ls -g ${HAPPY_NPM_PACKAGE} --depth=0 --json`;

//
// Update commands
//

/**
 * The update command for a tool, or null when we can't name one we're sure
 * of. Null is a real answer here, not a failure to try: running
 * `claude install latest` against a Homebrew-managed install would leave
 * two Claude Codes on the machine with the shell picking between them by
 * PATH order, and `npm install -g` against a native install would do the
 * same. The popover shows what it knows and stops.
 */
export function claudeUpdateCommand(method: InstallMethod): string | null {
  if (method === 'npm-global') return `npm install -g ${CLAUDE_NPM_PACKAGE}@latest`;
  // `claude install [stable|latest|<version>]` is Claude Code's own
  // installer for its native build — the right verb only when the native
  // build is what's already running.
  if (method === 'native') return 'claude install latest';
  return null;
}

/** happy has no self-updater and no `doctor`-style install report, so npm-global is the only case we can name. */
export function happyUpdateCommand(npmGlobal: boolean): string | null {
  return npmGlobal ? `npm install -g ${HAPPY_NPM_PACKAGE}@latest` : null;
}

//
// Detached execution
//

/**
 * An update can't run as a plain bash RPC. The remote handler caps `exec`
 * at 30s (`timeout: data.timeout || 3e4` in happy-cli's common handlers)
 * and this app's socket caps every ack at 60s (a deliberately global
 * `ackTimeout`, see happy-client's socket.ts) — while
 * `npm install -g @anthropic-ai/claude-code@latest` fetches a ~225MB
 * binary and routinely runs past both. So the update is written out as a
 * small script, LAUNCHED detached by one short RPC, and then watched by
 * polling the log it writes.
 *
 * Writing a script rather than composing one long shell string is what
 * makes this the same shape on both platforms: the launch command is then
 * a single quoted path, with none of the nested-quote guesswork a
 * one-liner would need on cmd.exe.
 *
 * The `HAPPYDECK_EXIT=<code>` sentinel appended after the command is what
 * makes the log self-terminating: without it a poller cannot tell "still
 * installing" from "finished", since npm is silent for long stretches
 * mid-download.
 */
export const UPDATE_EXIT_SENTINEL = 'HAPPYDECK_EXIT=';

export interface UpdateScript {
  scriptPath: string;
  logPath: string;
  /** Script contents, to be written with the machine's writeFile RPC before launching. */
  body: string;
  /** Returns as soon as the detached child exists — never waits for the install. */
  launchCommand: string;
  readLogCommand: string;
  cleanupCommand: string;
}

/**
 * `happyHomeDir` (the CLI's own ~/.happy, carried in every machine's
 * metadata) is the scratch directory rather than /tmp or %TEMP%: it is the
 * one path known to exist on every machine in a form this app already
 * holds, and %TEMP% is only ever expanded by cmd.exe — useless for the
 * writeFile RPC, which is a plain Node fs write.
 *
 * NOT verified against a real Windows machine — none is reachable from
 * this dev environment, same caveat as the Windows branch of
 * lib/chunkedFileWrite.ts. A failure there surfaces as a launch error in
 * the popover, not as a half-applied update.
 */
export function buildUpdateScript(platform: string, happyHomeDir: string, id: string, command: string): UpdateScript {
  const isWindows = platform === 'win32';
  const scriptPath = joinPath(happyHomeDir, `happydeck-update-${id}.${isWindows ? 'cmd' : 'sh'}`);
  const logPath = joinPath(happyHomeDir, `happydeck-update-${id}.log`);

  if (isWindows) {
    // CRLF: cmd.exe is documented to want it, and a batch file is not
    // worth finding out about the exceptions. No space before `>>` so the
    // sentinel line has no trailing blank before the redirect.
    const body = ['@echo off', `${command} > "${logPath}" 2>&1`, `echo ${UPDATE_EXIT_SENTINEL}%errorlevel%>> "${logPath}"`, ''].join('\r\n');
    return {
      scriptPath,
      logPath,
      body,
      launchCommand: `start "" /b cmd /c "${scriptPath}"`,
      // `2>nul` plus `exit 0`: the log does not exist for the first moment
      // after launch, and a non-zero exit comes back from the RPC as a
      // failed command, which would read as "the update failed".
      readLogCommand: `type "${logPath}" 2>nul & exit 0`,
      cleanupCommand: `del "${logPath}" "${scriptPath}" 2>nul & exit 0`,
    };
  }

  const quotedLog = shellSingleQuote(logPath);
  const body = ['#!/bin/sh', `${command} > ${quotedLog} 2>&1`, `echo ${UPDATE_EXIT_SENTINEL}$? >> ${quotedLog}`, ''].join('\n');
  return {
    scriptPath,
    logPath,
    body,
    // `< /dev/null` and both output streams to /dev/null: exec() resolves
    // only once every pipe it holds is closed, so a child still attached
    // to the RPC's stdout would keep that RPC open for the whole install —
    // exactly what this avoids.
    launchCommand: `nohup sh ${shellSingleQuote(scriptPath)} > /dev/null 2>&1 < /dev/null &`,
    readLogCommand: `cat ${quotedLog} 2>/dev/null || true`,
    cleanupCommand: `rm -f ${quotedLog} ${shellSingleQuote(scriptPath)}`,
  };
}

export interface UpdateLogState {
  /** Everything the command has printed so far, sentinel line removed. */
  output: string;
  /** null while still running; the process's exit code once it has finished. */
  exitCode: number | null;
}

export function parseUpdateLog(log: string): UpdateLogState {
  const match = new RegExp(`${UPDATE_EXIT_SENTINEL}(-?\\d+)`).exec(log);
  if (!match) return { output: log.trimEnd(), exitCode: null };
  return { output: log.slice(0, match.index).trimEnd(), exitCode: Number(match[1]) };
}

//
// Registry
//

/**
 * Latest published version of an npm package. Reached straight from the
 * webview — the registry sends `access-control-allow-origin: *` on this
 * endpoint (verified), and the app sets no CSP — so this needs neither a
 * Rust command nor an http plugin.
 *
 * No request headers on purpose: adding even an `accept` the browser
 * wouldn't have sent itself turns this into a preflighted cross-origin
 * request, and the registry's handling of the OPTIONS probe isn't
 * something to find out about from a user's machine.
 */
export async function fetchLatestNpmVersion(pkg: string): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`);
  if (!response.ok) throw new Error(`registry.npmjs.org responded ${response.status}`);
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== 'string') throw new Error('registry response had no version');
  return body.version;
}
