import { create } from 'zustand';
import {
  type DecryptedMachine,
  type DecryptedMessage,
  type DecryptedSession,
  type Decryptor,
  Encryption,
  type Encryptor,
  HttpClient,
  HttpError,
  RelaySocket,
  type SendMessageMeta,
  type SessionAgentModesPatch,
  type SpawnSessionOptions,
  type SpawnSessionResult,
  decodeBase64,
  fetchLatestMessages,
  fetchMachines,
  fetchSessions,
  machineSpawnNewSession,
  mintToken,
  sendSessionMessage,
  sessionAbort,
  sessionAllow,
  sessionDeny,
  sessionKill,
  subscribeToRelayUpdates,
  updateSessionAgentModes,
} from 'happy-client';
import { ensureNotificationPermission, notify } from '../lib/notifications';
import { getLocalMachineId, getStoredCredentials } from '../lib/tauri';

const SESSION_EVENT_TITLES: Record<string, string> = {
  done: 'Session finished',
  permission: 'Permission needed',
  question: 'Question from agent',
};

export type HappyStatus = 'idle' | 'linking-required' | 'loading' | 'ready' | 'error';

export interface PendingPermissionRequest {
  tool: string;
  arguments: unknown;
  createdAt?: number;
  toolUseId?: string;
}

export interface AgentState {
  requests?: Record<string, PendingPermissionRequest>;
  [key: string]: unknown;
}

export interface LiveSession extends DecryptedSession {
  messages: DecryptedMessage[];
  thinking: boolean;
}

interface HappyStoreState {
  status: HappyStatus;
  error: string | null;
  localMachineId: string | null;
  sessions: LiveSession[];
  machines: DecryptedMachine[];
  bootstrap: () => Promise<void>;
  sendMessage: (sessionId: string, text: string, meta?: SendMessageMeta) => Promise<void>;
  setAgentModes: (sessionId: string, patch: SessionAgentModesPatch) => Promise<void>;
  allowRequest: (sessionId: string, requestId: string) => Promise<void>;
  denyRequest: (sessionId: string, requestId: string) => Promise<void>;
  abortSession: (sessionId: string) => Promise<void>;
  killSession: (sessionId: string) => Promise<void>;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
}

function getAppState(): 'active' | 'background' {
  if (typeof document === 'undefined') {
    return 'active';
  }
  const visible = document.visibilityState === 'visible';
  const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  return visible && focused ? 'active' : 'background';
}

// Not reactive UI state, so kept outside the store: encryptors (needed to
// decrypt live pushes and to make control-plane calls), the socket
// connection, and the HTTP client + master secret needed for 401 retry.
let sessionEncryptors = new Map<string, Encryptor & Decryptor>();
let machineEncryptors = new Map<string, Encryptor & Decryptor>();
let relay: RelaySocket | null = null;
let http: HttpClient | null = null;
let secret: Uint8Array | null = null;

function requireSocket() {
  if (!relay) {
    throw new Error('Not connected');
  }
  return relay.socket;
}

function requireHttp(): HttpClient {
  if (!http) {
    throw new Error('Not connected');
  }
  return http;
}

function requireSessionEncryptor(sessionId: string): Encryptor & Decryptor {
  const encryptor = sessionEncryptors.get(sessionId);
  if (!encryptor) {
    throw new Error(`Unknown session ${sessionId}`);
  }
  return encryptor;
}

export const useHappyStore = create<HappyStoreState>((set, get) => ({
  status: 'idle',
  error: null,
  localMachineId: null,
  sessions: [],
  machines: [],

  async bootstrap() {
    set({ status: 'loading', error: null });
    ensureNotificationPermission();
    try {
      const credentials = await getStoredCredentials();
      if (!credentials) {
        set({ status: 'linking-required' });
        return;
      }

      secret = decodeBase64(credentials.secret, 'base64url');
      const encryption = await Encryption.create(secret);

      let currentToken = credentials.token;
      http = new HttpClient(() => currentToken);
      const withTokenRefresh = async <T,>(fn: () => Promise<T>): Promise<T> => {
        try {
          return await fn();
        } catch (error) {
          if (error instanceof HttpError && error.status === 401) {
            currentToken = await mintToken(secret!);
            return fn();
          }
          throw error;
        }
      };

      // localMachineId is kept in state for UI use (e.g. highlighting "this
      // machine"'s own sessions) — M3 shows every machine's sessions, not
      // just this one's, so it's no longer used to filter here.
      const localMachineId = await getLocalMachineId();
      const [allSessions, allMachines] = await Promise.all([
        withTokenRefresh(() => fetchSessions(http!, encryption)),
        withTokenRefresh(() => fetchMachines(http!, encryption)),
      ]);

      sessionEncryptors = new Map(allSessions.map((s) => [s.id, encryption.openEncryption(s.dataKey)]));
      machineEncryptors = new Map(allMachines.map((m) => [m.id, encryption.openEncryption(m.dataKey)]));

      const liveSessions: LiveSession[] = await Promise.all(
        allSessions.map(async (session) => {
          const encryptor = sessionEncryptors.get(session.id)!;
          const messages = await withTokenRefresh(() => fetchLatestMessages(http!, encryptor, session.id, 20));
          return { ...session, messages: [...messages].reverse(), thinking: false };
        }),
      );

      set({ status: 'ready', localMachineId, sessions: liveSessions, machines: allMachines });

      relay?.disconnect();
      relay = new RelaySocket({ token: currentToken, appState: getAppState });

      subscribeToRelayUpdates(relay.socket, {
        onUpdate: (update) => {
          if (update.body.t === 'new-message') {
            const sid = update.body.sid as string | undefined;
            const message = update.body.message as
              | { id: string; seq: number; createdAt: number; content: { c: string; t: string } }
              | undefined;
            if (!sid || !message) return;
            const encryptor = sessionEncryptors.get(sid);
            if (!encryptor) return; // not one of this machine's tracked sessions
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
            return;
          }

          if (update.body.t === 'update-session') {
            const sid = update.body.id as string | undefined;
            if (!sid) return;
            const encryptor = sessionEncryptors.get(sid);
            if (!encryptor) return;
            const metadataUpdate = update.body.metadata as { value: string; version: number } | undefined;
            const agentStateUpdate = update.body.agentState as { value: string | null; version: number } | undefined;

            Promise.all([
              metadataUpdate ? encryptor.decrypt([decodeBase64(metadataUpdate.value, 'base64')]) : null,
              agentStateUpdate?.value ? encryptor.decrypt([decodeBase64(agentStateUpdate.value, 'base64')]) : null,
            ]).then(([metadataResult, agentStateResult]) => {
              set((state) => ({
                sessions: state.sessions.map((s) => {
                  if (s.id !== sid) return s;
                  const next = { ...s };
                  if (metadataUpdate && metadataResult?.[0]) {
                    next.metadata = metadataResult[0];
                    next.metadataVersion = metadataUpdate.version;
                  }
                  if (agentStateUpdate) {
                    next.agentState = agentStateUpdate.value ? (agentStateResult?.[0] ?? next.agentState) : null;
                  }
                  return next;
                }),
              }));
            });
            return;
          }

          if (update.body.t === 'new-session') {
            const newSessionId = update.body.id as string | undefined;
            if (!newSessionId) return;
            // No single-session GET exists — refetch the list and pick out
            // the new row. Rare event, so the extra round-trip is fine.
            withTokenRefresh(() => fetchSessions(http!, encryption)).then(async (refreshedSessions) => {
              const found = refreshedSessions.find((s) => s.id === newSessionId);
              if (!found) return;
              sessionEncryptors.set(found.id, encryption.openEncryption(found.dataKey));
              const encryptor = sessionEncryptors.get(found.id)!;
              const messages = await withTokenRefresh(() => fetchLatestMessages(http!, encryptor, found.id, 20));
              set((state) =>
                state.sessions.some((s) => s.id === found.id)
                  ? state
                  : { sessions: [...state.sessions, { ...found, messages: [...messages].reverse(), thinking: false }] },
              );
            });
            return;
          }

          if (update.body.t === 'delete-session') {
            const removedId = update.body.sid as string | undefined;
            if (!removedId) return;
            sessionEncryptors.delete(removedId);
            set((state) => ({ sessions: state.sessions.filter((s) => s.id !== removedId) }));
          }
        },
        onEphemeral: (ephemeral) => {
          if (ephemeral.type === 'activity') {
            const id = ephemeral.id as string | undefined;
            if (!id || !sessionEncryptors.has(id)) {
              return;
            }
            set((state) => ({
              sessions: state.sessions.map((s) => (s.id === id ? { ...s, thinking: Boolean(ephemeral.thinking) } : s)),
            }));
            return;
          }

          if (ephemeral.type === 'session-event') {
            // Same signal that triggers the mobile push notification — the
            // natural hook for a native Mac notification too.
            const sessionId = ephemeral.sessionId as string | undefined;
            const kind = ephemeral.kind as string | undefined;
            if (!sessionId || !kind) {
              return;
            }
            const session = get().sessions.find((s) => s.id === sessionId);
            const metadata = session?.metadata as { path?: string; host?: string } | null;
            const label = metadata?.host ? `${metadata.host}: ${metadata.path ?? sessionId}` : (metadata?.path ?? sessionId);
            const title = (ephemeral.title as string | undefined) || SESSION_EVENT_TITLES[kind] || kind;
            const body = (ephemeral.body as string | undefined) || label;
            notify(title, body);
          }
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

  async sendMessage(sessionId, text, meta) {
    await sendSessionMessage(requireHttp(), sessionId, requireSessionEncryptor(sessionId), text, meta);
  },

  async setAgentModes(sessionId, patch) {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(`Unknown session ${sessionId}`);
    const result = await updateSessionAgentModes(
      requireSocket(),
      sessionId,
      requireSessionEncryptor(sessionId),
      (session.metadata as Record<string, unknown>) ?? {},
      session.metadataVersion,
      patch,
    );
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, metadata: result.metadata, metadataVersion: result.version } : s,
      ),
    }));
  },

  async allowRequest(sessionId, requestId) {
    await sessionAllow(requireSocket(), sessionId, requireSessionEncryptor(sessionId), requestId);
  },

  async denyRequest(sessionId, requestId) {
    await sessionDeny(requireSocket(), sessionId, requireSessionEncryptor(sessionId), requestId);
  },

  async abortSession(sessionId) {
    await sessionAbort(requireSocket(), sessionId, requireSessionEncryptor(sessionId));
  },

  async killSession(sessionId) {
    await sessionKill(requireSocket(), sessionId, requireSessionEncryptor(sessionId));
  },

  async spawnSession(options) {
    const encryptor = machineEncryptors.get(options.machineId);
    if (!encryptor) throw new Error(`Unknown machine ${options.machineId}`);
    return machineSpawnNewSession(requireSocket(), encryptor, options);
  },
}));
