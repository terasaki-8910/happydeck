import type { Socket } from 'socket.io-client';
import { decodeBase64, encodeBase64 } from '../crypto/base64';
import type { Decryptor, Encryptor } from '../crypto/encryptor';
import { machineRPC } from './rpc';

export interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: number;
}

export type ListDirectoryResult = { success: true; entries: DirectoryEntry[] } | { success: false; error: string };

/**
 * Lists a directory on the machine's daemon (NOT scoped to any session's
 * cwd/sandbox — confirmed via a disposable test session that the session-
 * scoped `listDirectory` RPC refuses anything outside its own working
 * directory, while this machine-scoped call can browse anywhere the daemon
 * process can read). Used for the GUI directory picker when spawning a new
 * session — no existing session on that machine is required.
 */
export function machineListDirectory(
  socket: Socket,
  machineId: string,
  encryptor: Encryptor & Decryptor,
  path: string,
): Promise<ListDirectoryResult> {
  return machineRPC(socket, machineId, 'listDirectory', { path }, encryptor);
}

type RawReadFileResult = { success: true; content: string } | { success: false; error: string };
type RawWriteFileResult = { success: true; hash: string } | { success: false; error: string };

export type ReadFileResult = { success: true; content: string } | { success: false; error: string };
export type WriteFileResult = { success: true } | { success: false; error: string };

/**
 * Reads a text file via the machine daemon (same unsandboxed scope as
 * machineListDirectory — confirmed empirically by reading this Mac's real
 * ~/.claude/CLAUDE.md with no session running there). Decodes the RPC's
 * base64 payload to a UTF-8 string.
 */
export async function machineReadFile(socket: Socket, machineId: string, encryptor: Encryptor & Decryptor, path: string): Promise<ReadFileResult> {
  const result = await machineRPC<RawReadFileResult, { path: string }>(socket, machineId, 'readFile', { path }, encryptor);
  if (!result.success) return result;
  return { success: true, content: new TextDecoder().decode(decodeBase64(result.content, 'base64')) };
}

/** Writes a text file via the machine daemon. Confirmed empirically (write + read-back round-trip) against a disposable scratch file. */
export async function machineWriteFile(
  socket: Socket,
  machineId: string,
  encryptor: Encryptor & Decryptor,
  path: string,
  content: string,
): Promise<WriteFileResult> {
  const encoded = encodeBase64(new TextEncoder().encode(content), 'base64');
  const result = await machineRPC<RawWriteFileResult, { path: string; content: string }>(
    socket,
    machineId,
    'writeFile',
    { path, content: encoded },
    encryptor,
  );
  if (!result.success) return result;
  return { success: true };
}
