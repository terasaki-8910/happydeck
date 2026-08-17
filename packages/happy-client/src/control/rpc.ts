import type { Socket } from 'socket.io-client';
import { decodeBase64, encodeBase64 } from '../crypto/base64';
import type { Decryptor, Encryptor } from '../crypto/encryptor';

interface RpcAck {
  ok: boolean;
  result?: string;
  error?: string;
}

/**
 * Shared implementation behind sessionRPC/machineRPC: encrypt params with
 * the target's own encryptor, call, decrypt the result. The relay just
 * relays — `method` is namespaced as "<targetId>:<method>" so it reaches
 * only the agent/daemon process that owns that session or machine.
 */
async function callRPC<TResult, TParams>(
  socket: Socket,
  targetId: string,
  method: string,
  params: TParams,
  encryptor: Encryptor & Decryptor,
): Promise<TResult> {
  const [encryptedParams] = await encryptor.encrypt([params]);
  const ack = (await socket.emitWithAck('rpc-call', {
    method: `${targetId}:${method}`,
    params: encodeBase64(encryptedParams, 'base64'),
  })) as RpcAck;

  if (!ack.ok) {
    throw new Error(ack.error || `RPC ${method} failed`);
  }
  const [decrypted] = await encryptor.decrypt([decodeBase64(ack.result ?? '', 'base64')]);
  return decrypted as TResult;
}

/** RPC call scoped to a session (e.g. abort, permission, killSession). Use the session's own encryptor. */
export function sessionRPC<TResult, TParams>(
  socket: Socket,
  sessionId: string,
  method: string,
  params: TParams,
  encryptor: Encryptor & Decryptor,
): Promise<TResult> {
  return callRPC(socket, sessionId, method, params, encryptor);
}

/** RPC call scoped to a machine (e.g. spawn-happy-session). Use the machine's own encryptor. */
export function machineRPC<TResult, TParams>(
  socket: Socket,
  machineId: string,
  method: string,
  params: TParams,
  encryptor: Encryptor & Decryptor,
): Promise<TResult> {
  return callRPC(socket, machineId, method, params, encryptor);
}
