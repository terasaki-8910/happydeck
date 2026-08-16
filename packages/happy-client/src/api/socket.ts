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
    });
  }

  sendAppState(state: AppState): void {
    this.socket.emit('app-state', { state });
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}
