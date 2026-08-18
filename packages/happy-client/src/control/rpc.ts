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

const DISCONNECT_RETRY_LIMIT = 2;
const RECONNECT_WAIT_MS = 8000;

function waitForReconnect(socket: Socket, timeoutMs: number): Promise<boolean> {
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off('connect', onConnect);
      resolve(false);
    }, timeoutMs);
    const onConnect = () => {
      clearTimeout(timer);
      resolve(true);
    };
    socket.once('connect', onConnect);
  });
}

/**
 * Retries an RPC call if it fails because the socket disconnected while the
 * call was in flight. socket.io-client rejects every pending emitWithAck
 * with the exact message "socket has been disconnected" the instant the
 * transport drops (see Socket.prototype._clearAcks in socket.io-client) —
 * expected for a brief reconnect blip, especially over a cross-machine
 * connection (Tailscale), not a real failure. Only wrap calls that are
 * genuinely safe to run twice (a read, or a write with idempotent content
 * like writeFile/mkdir -p) — never something with a side effect that isn't
 * safe to repeat, like spawning a process.
 */
export async function withDisconnectRetry<T>(socket: Socket, call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const isDisconnect = error instanceof Error && error.message === 'socket has been disconnected';
      if (!isDisconnect || attempt >= DISCONNECT_RETRY_LIMIT || !(await waitForReconnect(socket, RECONNECT_WAIT_MS))) {
        throw error;
      }
    }
  }
}
