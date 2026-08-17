import type { Socket } from 'socket.io-client';
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
