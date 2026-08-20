import { encodeBase64 } from 'happy-client';
import { shellSingleQuote } from './openTerminal';

type RunBash = (machineId: string, command: string) => Promise<{ success: boolean; error?: string }>;
type WriteBinary = (machineId: string, path: string, bytes: Uint8Array) => Promise<{ success: boolean; error?: string }>;

// Above this raw size, a single writeFile RPC's wire payload — base64 the
// bytes (x1.33), JSON-wrap, AES-256-GCM encrypt, then base64 THAT (x1.33
// again, since writeFile's own params object gets encrypted+encoded as a
// whole) — risks exceeding the relay's default socket.io message cap
// (~1MB; no maxHttpBufferSize override found in happy-server's Server()
// options, so Engine.IO's 1,000,000-byte default applies). Confirmed as
// the real cause of a live "socket has been disconnected" failure
// attaching a PDF to a remote machine over Tailscale. Above the
// threshold, write in chunks via the bash RPC instead.
const SINGLE_SHOT_MAX_BYTES = 350_000;

// Chunk size for the bash fallback is bounded by a SMALLER, more surprising
// limit than the socket message cap: the bash RPC's `command` string gets
// passed to Node's child_process.exec(), which on POSIX runs it as `sh -c
// "<command>"` — the WHOLE command is one argv string. Linux caps any
// single argv/envp string at MAX_ARG_STRLEN (32 pages, generally 128KiB) —
// well below what the socket message cap alone would allow. Sized well
// under that, with room for the surrounding printf/redirect syntax.
const CHUNK_SIZE = 90_000;

function tempPathFor(platform: string, id: string): string {
  return platform === 'win32' ? `%TEMP%\\happydeck-upload-${id}.b64` : `/tmp/happydeck-upload-${id}.b64`;
}

function posixAppendCommand(chunk: string, tempPath: string, create: boolean): string {
  return `printf '%s' ${shellSingleQuote(chunk)} ${create ? '>' : '>>'} ${shellSingleQuote(tempPath)}`;
}

function posixFinishCommand(tempPath: string, targetPath: string): string {
  // `base64 -d <file>` (a positional filename argument) is GNU coreutils
  // syntax — confirmed broken on macOS's actual /usr/bin/base64 (BSD),
  // which only accepts an input file via `-i` and otherwise reads stdin;
  // handed a bare positional argument it errors with its own usage text
  // instead of decoding anything. `<` (stdin redirection) is what both
  // implementations actually agree on, so this works on Linux and macOS
  // alike instead of only ever having been tried on one of them.
  return `base64 -d < ${shellSingleQuote(tempPath)} > ${shellSingleQuote(targetPath)} && rm -f ${shellSingleQuote(tempPath)}`;
}

// child_process.exec() on Windows runs the command via cmd.exe (confirmed
// against happy-cli's source: no `shell` option override, and Node's own
// default for exec() on win32 is cmd.exe, not PowerShell). `<nul set /p` is
// cmd.exe's standard trick for writing text without a trailing newline —
// plain `echo` always appends one, which would corrupt the concatenated
// base64 stream. certutil -decode is a built-in Windows tool for exactly
// this. NOT verified against a real Windows machine — no such box reachable
// from this dev environment; worth confirming the first time this path is
// actually hit on omen6.
function windowsAppendCommand(chunk: string, tempPath: string, create: boolean): string {
  return `<nul set /p ".=${chunk}" ${create ? '>' : '>>'} "${tempPath}"`;
}

function windowsFinishCommand(tempPath: string, targetPath: string): string {
  return `certutil -decode "${tempPath}" "${targetPath}" & del "${tempPath}"`;
}

/**
 * Writes bytes to a path on a machine, transparently switching from the
 * normal single-RPC binary write to a chunked bash-based one once the file
 * is large enough to risk the relay's socket message cap (see
 * SINGLE_SHOT_MAX_BYTES above) — e.g. a PDF, where an image attachment
 * would usually stay under the fast single-shot path.
 */
export async function writeAttachmentFile(
  runMachineBash: RunBash,
  writeMachineBinaryFile: WriteBinary,
  machineId: string,
  platform: string,
  targetPath: string,
  bytes: Uint8Array,
): Promise<void> {
  if (bytes.byteLength <= SINGLE_SHOT_MAX_BYTES) {
    const result = await writeMachineBinaryFile(machineId, targetPath, bytes);
    if (!result.success) throw new Error(result.error);
    return;
  }

  const isWindows = platform === 'win32';
  const tempPath = tempPathFor(platform, crypto.randomUUID());
  const base64 = encodeBase64(bytes, 'base64');

  for (let offset = 0; offset < base64.length; offset += CHUNK_SIZE) {
    const chunk = base64.slice(offset, offset + CHUNK_SIZE);
    const command = isWindows ? windowsAppendCommand(chunk, tempPath, offset === 0) : posixAppendCommand(chunk, tempPath, offset === 0);
    const result = await runMachineBash(machineId, command);
    if (!result.success) throw new Error(result.error || `Failed to write attachment chunk at offset ${offset}`);
  }

  const finishResult = await runMachineBash(machineId, isWindows ? windowsFinishCommand(tempPath, targetPath) : posixFinishCommand(tempPath, targetPath));
  if (!finishResult.success) throw new Error(finishResult.error || 'Failed to finalize the attachment write');
}
