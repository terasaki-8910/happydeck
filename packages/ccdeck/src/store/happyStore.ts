import { create } from 'zustand';
import {
  type DecryptedMessage,
  type DecryptedSession,
  type Decryptor,
  Encryption,
  type Encryptor,
  HttpClient,
  HttpError,
  RelaySocket,
  decodeBase64,
  fetchLatestMessages,
  fetchSessions,
  mintToken,
  subscribeToRelayUpdates,
} from 'happy-client';
import { getLocalMachineId, getStoredCredentials } from '../lib/tauri';

export type HappyStatus = 'idle' | 'linking-required' | 'loading' | 'ready' | 'error';

export interface LiveSession extends DecryptedSession {
  messages: DecryptedMessage[];
  thinking: boolean;
}

interface HappyStoreState {
  status: HappyStatus;
  error: string | null;
  localMachineId: string | null;
  sessions: LiveSession[];
  bootstrap: () => Promise<void>;
}

function getAppState(): 'active' | 'background' {
  if (typeof document === 'undefined') {
    return 'active';
  }
  const visible = document.visibilityState === 'visible';
  const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  return visible && focused ? 'active' : 'background';
}

// Not reactive UI state, so kept outside the store: per-session encryptors
// (needed to decrypt live 'new-message' pushes) and the socket connection.
let sessionEncryptors = new Map<string, Encryptor & Decryptor>();
let relay: RelaySocket | null = null;

export const useHappyStore = create<HappyStoreState>((set) => ({
  status: 'idle',
  error: null,
  localMachineId: null,
  sessions: [],

  async bootstrap() {
    set({ status: 'loading', error: null });
    try {
      const credentials = await getStoredCredentials();
      if (!credentials) {
        set({ status: 'linking-required' });
        return;
      }

      const secret = decodeBase64(credentials.secret, 'base64url');
      const encryption = await Encryption.create(secret);

      let currentToken = credentials.token;
      const http = new HttpClient(() => currentToken);
      const withTokenRefresh = async <T,>(fn: () => Promise<T>): Promise<T> => {
        try {
          return await fn();
        } catch (error) {
          if (error instanceof HttpError && error.status === 401) {
            currentToken = await mintToken(secret);
            return fn();
          }
          throw error;
        }
      };

      // localMachineId is kept in state for UI use (e.g. highlighting "this
      // machine"'s own sessions) — M3 shows every machine's sessions, not
      // just this one's, so it's no longer used to filter here.
      const localMachineId = await getLocalMachineId();
      const allSessions = await withTokenRefresh(() => fetchSessions(http, encryption));

      sessionEncryptors = new Map(allSessions.map((s) => [s.id, encryption.openEncryption(s.dataKey)]));

      const liveSessions: LiveSession[] = await Promise.all(
        allSessions.map(async (session) => {
          const encryptor = sessionEncryptors.get(session.id)!;
          const messages = await withTokenRefresh(() => fetchLatestMessages(http, encryptor, session.id, 20));
          return { ...session, messages: [...messages].reverse(), thinking: false };
        }),
      );

      set({ status: 'ready', localMachineId, sessions: liveSessions });

      relay?.disconnect();
      relay = new RelaySocket({ token: currentToken, appState: getAppState });

      subscribeToRelayUpdates(relay.socket, {
        onUpdate: (update) => {
          if (update.body.t !== 'new-message') {
            return;
          }
          const sid = update.body.sid as string | undefined;
          const message = update.body.message as
            | { id: string; seq: number; createdAt: number; content: { c: string; t: string } }
            | undefined;
          if (!sid || !message) {
            return;
          }
          const encryptor = sessionEncryptors.get(sid);
          if (!encryptor) {
            return; // not one of this machine's tracked sessions
          }
          encryptor.decrypt([decodeBase64(message.content.c, 'base64')]).then(([content]) => {
            set((state) => ({
              sessions: state.sessions.map((s) =>
                s.id === sid
                  ? {
                      ...s,
                      messages: [
                        ...s.messages,
                        { id: message.id, seq: message.seq, createdAt: message.createdAt, content: content ?? null },
                      ],
                    }
                  : s,
              ),
            }));
          });
        },
        onEphemeral: (ephemeral) => {
          if (ephemeral.type !== 'activity') {
            return;
          }
          const id = ephemeral.id as string | undefined;
          if (!id || !sessionEncryptors.has(id)) {
            return;
          }
          set((state) => ({
            sessions: state.sessions.map((s) => (s.id === id ? { ...s, thinking: Boolean(ephemeral.thinking) } : s)),
          }));
        },
      });

      const reportAppState = () => relay?.sendAppState(getAppState());
      window.addEventListener('focus', reportAppState);
      window.addEventListener('blur', reportAppState);
      document.addEventListener('visibilitychange', reportAppState);
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  },
}));
