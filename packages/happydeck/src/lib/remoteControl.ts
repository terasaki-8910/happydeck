/**
 * Resolves the per-session Remote Control URL for a session — the page that
 * actually opens THAT session on claude.ai, not the list of all of them.
 *
 * How the URL is built (read out of the claude 2.1.258 binary, not guessed):
 * its one session-URL builder is `${base}/code/${toCompatSessionId(id)}`,
 * where `base` is https://claude.ai unless the id or the ingress URL carries
 * `_staging_`/`_local_`, and `toCompatSessionId` rewrites a `cse_<body>`
 * infra id to `session_<body>`. Remote Control feeds it the bridge session
 * id (the CLI's own `replBridgeSessionUrl` is exactly
 * `Ta(bridgeSessionId, sessionIngressUrl)`).
 *
 * Where the bridge session id comes from: Claude Code keeps a tiny
 * per-process registry at `<config dir>/sessions/<pid>.json` (431-656 bytes
 * in every sample seen), one file per LIVE session, swept on exit. It holds
 * `sessionId` (the Claude Code session UUID — the same value happy-cli
 * syncs into Happy metadata as `claudeSessionId`, so it is the join key we
 * already have) and, once Remote Control connects, `bridgeSessionId`
 * ALREADY in `session_` compat form, so it is used verbatim. Confirmed live
 * on all three of this account's machines — darwin, linux AND win32 — with
 * every registry entry's `sessionId` matching a Happy session we knew
 * about, and `bridgeSessionId` present on exactly the sessions that had run
 * /remote-control.
 *
 * So "is Remote Control on for this session" IS observable after all (an
 * earlier version of this file's caller recorded the opposite) — but only
 * by asking the session's own machine, which is why it happens on click
 * rather than on render.
 *
 * Deliberately reads the registry through listDirectory + readFile rather
 * than one `grep` through the bash RPC: both work on POSIX, but the file
 * RPCs need no shell quoting and no cmd.exe dialect, and this repo already
 * carries one Windows bash command it could never verify (see
 * chunkedFileWrite.ts). The registry is small enough that reading all of it
 * costs less than getting that wrong — 1-2 files per machine in practice.
 */

import type { ListDirectoryResult, ReadFileResult } from 'happy-client';

/** Claude Code's own Remote Control landing page — the list, not a session. */
export const REMOTE_CONTROL_LIST_URL = 'https://claude.ai/code';

/**
 * A `bridgeSessionId` is already `session_<body>`; a raw infra id would be
 * `cse_<body>`. Normalising here rather than trusting the field means a
 * future CLI that stores the infra form still produces a working URL —
 * `toCompatSessionId`'s whole job, reimplemented in one line.
 */
export function remoteControlSessionUrl(bridgeSessionId: string): string {
  const compat = bridgeSessionId.startsWith('cse_') ? `session_${bridgeSessionId.slice(4)}` : bridgeSessionId;
  return `${REMOTE_CONTROL_LIST_URL}/${compat}`;
}

/** Shape of one `<config dir>/sessions/<pid>.json`. Every field is optional: it is an internal CLI file, not a contract. */
interface RegistryEntry {
  sessionId?: unknown;
  bridgeSessionId?: unknown;
  updatedAt?: unknown;
}

/**
 * `os` is what Happy metadata records for the session's machine, so it is
 * normally just there — but a row missing it must not silently get POSIX
 * separators on a Windows box, which would produce a path no daemon can
 * open. A home directory is unambiguous about which it is: `C:\Users\e8910`
 * on win32 (confirmed live on this account's Windows machine), rooted at `/`
 * everywhere else.
 */
export function registryOs(os: string | undefined, homeDir: string): 'win32' | 'posix' {
  if (os === 'win32') return 'win32';
  if (os !== undefined) return 'posix';
  return /^[A-Za-z]:[\\/]/.test(homeDir) || homeDir.includes('\\') ? 'win32' : 'posix';
}

export function sessionRegistryDir(homeDir: string, os: string | undefined): string {
  const sep = registryOs(os, homeDir) === 'win32' ? '\\' : '/';
  return `${homeDir}${sep}.claude${sep}sessions`;
}

export function joinRegistryPath(dir: string, name: string, os: string | undefined): string {
  return `${dir}${registryOs(os, dir) === 'win32' ? '\\' : '/'}${name}`;
}

/**
 * Picks the bridge session id for one Claude Code session out of the
 * registry files' contents.
 *
 * Ties are broken by `updatedAt` (newest wins) rather than by taking the
 * first match: a session resumed after its previous process died without
 * cleaning up leaves two files carrying the same `sessionId`, and the stale
 * one's `bridgeSessionId` points at a bridge that is already archived.
 */
export function pickBridgeSessionId(contents: string[], claudeSessionId: string): { found: boolean; bridgeSessionId: string | null } {
  let found = false;
  let best: { bridgeSessionId: string | null; updatedAt: number } | null = null;
  for (const raw of contents) {
    let entry: RegistryEntry;
    try {
      entry = JSON.parse(raw) as RegistryEntry;
    } catch {
      continue; // half-written file mid-update; the others still answer
    }
    if (entry.sessionId !== claudeSessionId) continue;
    found = true;
    const bridgeSessionId = typeof entry.bridgeSessionId === 'string' && entry.bridgeSessionId !== '' ? entry.bridgeSessionId : null;
    const updatedAt = typeof entry.updatedAt === 'number' ? entry.updatedAt : 0;
    if (!best || updatedAt > best.updatedAt) best = { bridgeSessionId, updatedAt };
  }
  return { found, bridgeSessionId: best?.bridgeSessionId ?? null };
}

export interface RemoteControlTarget {
  machineId: string;
  /** From the session's own Happy metadata (`homeDir`), so it is that machine's home, not this one's. */
  homeDir: string;
  /** The session's `os` — 'win32' | 'darwin' | 'linux'. Only the path separator depends on it; see registryOs for the absent case. */
  os: string | undefined;
  claudeSessionId: string;
}

export interface RemoteControlDeps {
  listMachineDirectory: (machineId: string, path: string) => Promise<ListDirectoryResult>;
  readMachineFile: (machineId: string, path: string) => Promise<ReadFileResult>;
}

export type RemoteControlResolution =
  /** Remote Control is connected for this session — open it directly. */
  | { kind: 'url'; url: string }
  /** The session is in the registry but has no bridge — /remote-control has not been run in it. */
  | { kind: 'not-connected' }
  /** No registry entry for it: the session's process is gone, or its CLI predates the registry. */
  | { kind: 'no-entry' }
  /** The machine could not be asked at all (offline, no such directory, RPC refused). */
  | { kind: 'unreachable'; detail: string };

/**
 * Asks the session's OWN machine for its Remote Control URL. Never throws —
 * every failure is a resolution the caller can phrase for the user, because
 * "that machine is asleep" is an ordinary outcome here, not a bug.
 */
export async function resolveRemoteControlUrl(deps: RemoteControlDeps, target: RemoteControlTarget): Promise<RemoteControlResolution> {
  const dir = sessionRegistryDir(target.homeDir, target.os);
  let listed: ListDirectoryResult;
  try {
    listed = await deps.listMachineDirectory(target.machineId, dir);
  } catch (error) {
    return { kind: 'unreachable', detail: error instanceof Error ? error.message : String(error) };
  }
  if (!listed.success) return { kind: 'unreachable', detail: listed.error };

  const names = listed.entries.filter((entry) => entry.type === 'file' && entry.name.endsWith('.json')).map((entry) => entry.name);
  if (names.length === 0) return { kind: 'no-entry' };

  // In parallel: these are independent reads of sub-kilobyte files, and a
  // machine with several live sessions would otherwise pay one full relay
  // round-trip per file before the user sees anything happen.
  let reads: ReadFileResult[];
  try {
    reads = await Promise.all(names.map((name) => deps.readMachineFile(target.machineId, joinRegistryPath(dir, name, target.os))));
  } catch (error) {
    return { kind: 'unreachable', detail: error instanceof Error ? error.message : String(error) };
  }

  const contents = reads.filter((read): read is Extract<ReadFileResult, { success: true }> => read.success).map((read) => read.content);
  const { found, bridgeSessionId } = pickBridgeSessionId(contents, target.claudeSessionId);
  if (bridgeSessionId) return { kind: 'url', url: remoteControlSessionUrl(bridgeSessionId) };
  return found ? { kind: 'not-connected' } : { kind: 'no-entry' };
}
