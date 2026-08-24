import { type Socket, io } from 'socket.io-client';
import { getHappyClientId } from './happyClientId';
import { getServerUrl } from './serverConfig';

export type AppState = 'active' | 'background';

export interface RelaySocketOptions {
  token: string;
  /** Read fresh on every (re)connect — a stale 'active' would suppress the user's phone pushes. */
  appState?: () => AppState;
}

/**
 * User-scoped socket.io connection — the same tier as the mobile/web app,
 * seeing every machine and session on the account. Exposes the raw
 * socket.io `Socket` so callers attach `update`/`ephemeral` listeners
 * directly rather than through a re-wrapped event API.
 *
 * connectionStateRecovery is not enabled server-side, so `socket.recovered`
 * is effectively always false — treat every `connect` as "refetch
 * everything", matching sync.ts's onReconnected behavior.
 */
/** See the ackTimeout comment in the constructor for why this exists and why it's this loose. */
const ACK_TIMEOUT_MS = 60_000;

export class RelaySocket {
  readonly socket: Socket;

  constructor(options: RelaySocketOptions) {
    this.socket = io(getServerUrl(), {
      path: '/v1/updates',
      auth: (callback: (data: Record<string, unknown>) => void) =>
        callback({
          token: options.token,
          clientType: 'user-scoped',
          happyClient: getHappyClientId(),
          appState: options.appState ? options.appState() : 'background',
        }),
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      // Without this, EVERY emitWithAck can hang forever. Verified against
      // socket.io-client 4.8.3's own source: _registerAckCallback reads
      // `this.flags.timeout ?? this._opts.ackTimeout` and, when that is
      // undefined, stores the ack with NO timer at all — there is no
      // built-in default. Two distinct never-settles paths follow from
      // that: (1) the socket stays nominally connected but the remote
      // daemon never acks, and (2) the call is emitted during a
      // disconnect window, so it lands in `sendBuffer` — which
      // `_clearAcks` deliberately SKIPS when rejecting pending acks, so
      // even the disconnect path never rejects it. Confirmed live as the
      // cause of an attachment upload freezing with no way out (a large
      // file is hundreds of sequential chunk RPCs, each an independent
      // chance to hang).
      //
      // 60s, not something tighter: the remote bash handler caps itself
      // at 30s (`timeout: data.timeout || 3e4` in the happy CLI), so
      // anything past that plus relay round-trip is a lost ack by
      // definition — this only needs to be BOUNDED, not tight, and a
      // generous bound can't false-positive on a legitimately slow call.
      // Deliberately global rather than threaded per call site so a
      // future RPC can't reintroduce the hang by forgetting to opt in.
      ackTimeout: ACK_TIMEOUT_MS,
    });
  }

  sendAppState(state: AppState): void {
    this.socket.emit('app-state', { state });
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}
