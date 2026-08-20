import { create } from 'zustand';
import {
  type BashResult,
  type CreateDirectoryResult,
  type DecryptedMachine,
  type DecryptedMessage,
  type DecryptedSession,
  type Decryptor,
  Encryption,
  type Encryptor,
  HttpClient,
  HttpError,
  RelaySocket,
  type ListDirectoryResult,
  type ReadFileResult,
  type SendMessageMeta,
  type SessionAgentModesPatch,
  type SpawnSessionOptions,
  type SpawnSessionResult,
  type WriteFileResult,
  decodeBase64,
  decryptBlobBytes,
  downloadAttachmentBytes,
  fetchLatestMessages,
  fetchMachines,
  fetchOlderMessages,
  fetchSessions,
  machineCreateDirectory,
  machineListDirectory,
  machineReadFile,
  machineResumeSession,
  machineRunBash,
  machineSpawnNewSession,
  machineWriteBinaryFile,
  machineWriteFile,
  withDisconnectRetry,
  mintToken,
  sendSessionMessage,
  sessionAbort,
  sessionAllow,
  sessionArchive,
  sessionDelete,
  sessionDeny,
  sessionKill,
  subscribeToRelayUpdates,
  updateSessionAgentModes,
  updateSessionSummary,
} from 'happy-client';
import { buildMockSession, MOCK_ENABLED, mockCreateDirectory, mockListDirectory, mockMachines, mockSessions } from '../lib/mockData';
import {
  attachmentDecryptFailedError,
  noMachineIdToResumeError,
  notConnectedError,
  sentButNotResumedError,
  unknownMachineError,
  unknownSessionError,
} from '../lib/errorMessages';
import { ensureNotificationPermission, notify } from '../lib/notifications';
import { explainResumeError } from '../lib/resumeError';
import { getLocalMachineId, getStoredCredentials } from '../lib/tauri';
import { useSettingsStore } from './settingsStore';

// A real network+decrypt round trip has nothing to mock against in
// VITE_HAPPYDECK_MOCK — a minimal valid 1x1 PNG so the preview/download UI
// itself is still exercisable there. Not a fixture that means anything.
const MOCK_ATTACHMENT_PNG = decodeBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

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
  /** True if the server has older messages beyond what's currently loaded (see loadOlderMessages). */
  hasMoreMessages: boolean;
  /** Set while loadOlderMessages is in flight for this session, so the UI can't fire it twice concurrently. */
  loadingOlderMessages?: boolean;
}

interface HappyStoreState {
  status: HappyStatus;
  error: string | null;
  localMachineId: string | null;
  sessions: LiveSession[];
  machines: DecryptedMachine[];
  bootstrap: () => Promise<void>;
  loadOlderMessages: (sessionId: string) => Promise<void>;
  sendMessage: (sessionId: string, text: string, meta?: SendMessageMeta) => Promise<void>;
  setAgentModes: (sessionId: string, patch: SessionAgentModesPatch) => Promise<void>;
  allowRequest: (sessionId: string, requestId: string, updatedInput?: Record<string, unknown>) => Promise<void>;
  denyRequest: (sessionId: string, requestId: string) => Promise<void>;
  abortSession: (sessionId: string) => Promise<void>;
  killSession: (sessionId: string) => Promise<void>;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  listMachineDirectory: (machineId: string, path: string) => Promise<ListDirectoryResult>;
  createMachineDirectory: (machineId: string, path: string, platform: string) => Promise<CreateDirectoryResult>;
  runMachineBash: (machineId: string, command: string) => Promise<BashResult>;
  resumeSession: (sessionId: string) => Promise<SpawnSessionResult>;
  deleteSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  readMachineFile: (machineId: string, path: string) => Promise<ReadFileResult>;
  writeMachineFile: (machineId: string, path: string, content: string) => Promise<WriteFileResult>;
  writeMachineBinaryFile: (machineId: string, path: string, bytes: Uint8Array) => Promise<WriteFileResult>;
  /** Fetches and decrypts a session-protocol file event's attachment blob (Happy's own upload protocol, not this app's own [Attached file: path] convention). */
  downloadAttachment: (sessionId: string, ref: string) => Promise<Uint8Array>;
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
// Was local to bootstrap() — promoted so downloadAttachment (a later action,
// not part of bootstrap's own closure) can derive a session's blob key.
let encryption: Encryption | null = null;

// Cooldown for sendMessage's auto-resume — a live-update announcing the
// resumed process is active can take a few seconds to arrive, and sending
// several messages in that window shouldn't spawn a second (or third...)
// process for the same session. Not reactive state, same reasoning as the
// encryptor maps above.
const lastResumeAttemptAt = new Map<string, number>();
const RESUME_COOLDOWN_MS = 30_000;

// How often to re-fetch active/activeAt for the online/offline dot -- see
// refreshSessionActivity in bootstrap() for why this can't just come from
// subscribeToRelayUpdates.
const ACTIVITY_REFRESH_INTERVAL_MS = 60_000;

function requireSocket() {
  if (!relay) {
    throw new Error(notConnectedError(useSettingsStore.getState().language));
  }
  return relay.socket;
}

function requireHttp(): HttpClient {
  if (!http) {
    throw new Error(notConnectedError(useSettingsStore.getState().language));
  }
  return http;
}

function requireSessionEncryptor(sessionId: string): Encryptor & Decryptor {
  const encryptor = sessionEncryptors.get(sessionId);
  if (!encryptor) {
    throw new Error(unknownSessionError(useSettingsStore.getState().language, sessionId));
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

    if (MOCK_ENABLED) {
      set({ status: 'ready', localMachineId: 'mock-machine-mac', sessions: mockSessions(), machines: mockMachines() });
      return;
    }

    ensureNotificationPermission();
    try {
      const credentials = await getStoredCredentials();
      if (!credentials) {
        set({ status: 'linking-required' });
        return;
      }

      secret = decodeBase64(credentials.secret, 'base64url');
      encryption = await Encryption.create(secret);
      // TS can't narrow a mutable outer-scope `let` across the rest of this
      // async function (another call could reassign it, in principle) --
      // this const alias is what actually gets narrowed/used below.
      const enc = encryption;

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
        withTokenRefresh(() => fetchSessions(http!, enc)),
        withTokenRefresh(() => fetchMachines(http!, enc)),
      ]);

      sessionEncryptors = new Map(allSessions.map((s) => [s.id, enc.openEncryption(s.dataKey)]));
      machineEncryptors = new Map(allMachines.map((m) => [m.id, enc.openEncryption(m.dataKey)]));

      // Promise.all here would let ONE slow/failed session's message fetch
      // reject the whole bootstrap — confirmed live: with enough sessions,
      // one request tripping the timeout took down the entire load, so a
      // retry kept landing back on the same failure instead of ever
      // reaching a usable state. allSettled + per-session fallback matches
      // this app's existing resilience rule elsewhere (a broken row doesn't
      // take the whole list down with it) — a session that fails to load
      // its messages still shows up, just empty, rather than vanishing the
      // entire account's session list.
      const liveSessions: LiveSession[] = (
        await Promise.allSettled(
          allSessions.map(async (session) => {
            const encryptor = sessionEncryptors.get(session.id)!;
            const page = await withTokenRefresh(() => fetchLatestMessages(http!, encryptor, session.id));
            return { ...session, messages: page.messages, hasMoreMessages: page.hasMore, thinking: false };
          }),
        )
      ).map((result, i) =>
        result.status === 'fulfilled' ? result.value : { ...allSessions[i], messages: [], hasMoreMessages: false, thinking: false },
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
              const newMessage = { id: message.id, seq: message.seq, createdAt: message.createdAt, content: content ?? null };
              set((state) => ({
                sessions: state.sessions.map((s) =>
                  // A flaky connection (reconnects, at-least-once socket
                  // delivery) can redeliver the same new-message event —
                  // confirmed live as the same message rendering several
                  // times in a row on a machine with an unstable link.
                  // Appending unconditionally had no defense against that.
                  s.id === sid && !s.messages.some((m) => m.id === newMessage.id) ? { ...s, messages: [...s.messages, newMessage] } : s,
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
            withTokenRefresh(() => fetchSessions(http!, enc)).then(async (refreshedSessions) => {
              const found = refreshedSessions.find((s) => s.id === newSessionId);
              if (!found) return;
              sessionEncryptors.set(found.id, enc.openEncryption(found.dataKey));
              const encryptor = sessionEncryptors.get(found.id)!;
              const page = await withTokenRefresh(() => fetchLatestMessages(http!, encryptor, found.id));
              set((state) =>
                state.sessions.some((s) => s.id === found.id)
                  ? state
                  : { sessions: [...state.sessions, { ...found, messages: page.messages, hasMoreMessages: page.hasMore, thinking: false }] },
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
            const notifyPrefs = useSettingsStore.getState().notify;
            if (kind in notifyPrefs && !notifyPrefs[kind as keyof typeof notifyPrefs]) {
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

      // `active`/`activeAt` only ever come from fetchSessions — nothing in
      // subscribeToRelayUpdates above touches them (update-session only
      // ever applies metadata/agentState). So once a session's underlying
      // process dies without this client explicitly killing it (crash,
      // network drop, machine sleep), the locally cached `active: true`
      // never corrects itself — confirmed as the cause of a session
      // showing green/online while genuinely dead. Re-fetching on an
      // interval, and on focus (the moment staleness is most likely to be
      // visible), keeps it honest without needing a dedicated live event
      // for this specific field.
      const refreshSessionActivity = async () => {
        try {
          const refreshed = await withTokenRefresh(() => fetchSessions(http!, enc));
          const byId = new Map(refreshed.map((s) => [s.id, s]));
          set((state) => ({
            sessions: state.sessions.map((s) => {
              const fresh = byId.get(s.id);
              if (!fresh || (fresh.active === s.active && fresh.activeAt === s.activeAt)) return s;
              // A session confirmed offline can't still be generating —
              // `thinking` has no fetchSessions-backed source of truth of
              // its own (ephemeral-only), so this is its one correction
              // point too, for the same "process died without a live event
              // telling us" case.
              return { ...s, active: fresh.active, activeAt: fresh.activeAt, thinking: fresh.active && s.thinking };
            }),
          }));
        } catch {
          // Best-effort -- the next interval tick or focus event retries;
          // an explicit resume/kill elsewhere still keeps state accurate
          // for the session the user is actually interacting with.
        }
      };
      window.setInterval(refreshSessionActivity, ACTIVITY_REFRESH_INTERVAL_MS);
      window.addEventListener('focus', refreshSessionActivity);
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  },

  async loadOlderMessages(sessionId) {
    if (MOCK_ENABLED) return;
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session || !session.hasMoreMessages || session.loadingOlderMessages || session.messages.length === 0) return;
    const encryptor = sessionEncryptors.get(sessionId);
    if (!encryptor) return;
    set((state) => ({ sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, loadingOlderMessages: true } : s)) }));
    try {
      const oldestLoadedSeq = session.messages[0].seq;
      const page = await fetchOlderMessages(requireHttp(), encryptor, sessionId, oldestLoadedSeq);
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId
            ? { ...s, messages: [...page.messages, ...s.messages], hasMoreMessages: page.hasMore, loadingOlderMessages: false }
            : s,
        ),
      }));
    } catch (error) {
      set((state) => ({ sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, loadingOlderMessages: false } : s)) }));
      throw error;
    }
  },

  async sendMessage(sessionId, text, meta) {
    // Sending to an offline session queues fine either way (sendSessionMessage
    // is a plain HTTP call, not dependent on a live connection) — but nothing
    // will actually read it until some process resumes the session, so try to
    // bring it back online first rather than making the user click Resume
    // themselves before every message.
    const session = get().sessions.find((s) => s.id === sessionId);
    let resumeFailure: string | null = null;
    if (session && !session.active) {
      const lastAttempt = lastResumeAttemptAt.get(sessionId) ?? 0;
      if (Date.now() - lastAttempt > RESUME_COOLDOWN_MS) {
        lastResumeAttemptAt.set(sessionId, Date.now());
        try {
          const result = await get().resumeSession(sessionId);
          if (result.type !== 'success') {
            resumeFailure = result.type === 'error' ? result.errorMessage : result.type;
          }
        } catch (error) {
          resumeFailure = error instanceof Error ? error.message : String(error);
        }
      }
    }

    if (MOCK_ENABLED) {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                messages: [
                  ...s.messages,
                  { id: `mock-msg-${crypto.randomUUID()}`, seq: s.messages.length, createdAt: Date.now(), content: { role: 'user', content: { type: 'text', text } } },
                ],
              }
            : s,
        ),
      }));
    } else {
      await sendSessionMessage(requireHttp(), sessionId, requireSessionEncryptor(sessionId), text, meta);
    }

    if (resumeFailure) {
      const language = useSettingsStore.getState().language;
      throw new Error(sentButNotResumedError(language, explainResumeError(resumeFailure, language)));
    }
  },

  async setAgentModes(sessionId, patch) {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(unknownSessionError(useSettingsStore.getState().language, sessionId));
    if (MOCK_ENABLED) {
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, metadata: { ...(s.metadata as Record<string, unknown>), ...patch } } : s)),
      }));
      return;
    }
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

  async allowRequest(sessionId, requestId, updatedInput) {
    if (MOCK_ENABLED) {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId && s.agentState && typeof s.agentState === 'object' && 'requests' in s.agentState
            ? { ...s, agentState: { ...s.agentState, requests: Object.fromEntries(Object.entries((s.agentState as AgentState).requests ?? {}).filter(([id]) => id !== requestId)) } }
            : s,
        ),
      }));
      return;
    }
    await sessionAllow(requireSocket(), sessionId, requireSessionEncryptor(sessionId), requestId, { updatedInput });
  },

  async denyRequest(sessionId, requestId) {
    await sessionDeny(requireSocket(), sessionId, requireSessionEncryptor(sessionId), requestId);
  },

  async abortSession(sessionId) {
    await sessionAbort(requireSocket(), sessionId, requireSessionEncryptor(sessionId));
  },

  async killSession(sessionId) {
    if (MOCK_ENABLED) {
      set((state) => ({ sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, active: false, thinking: false } : s)) }));
      return;
    }
    try {
      await sessionKill(requireSocket(), sessionId, requireSessionEncryptor(sessionId));
    } catch {
      // Kill can legitimately fail to even reach an already-dead process —
      // archive below is the documented fallback for exactly this, so a
      // kill-specific failure shouldn't block it.
    }
    await sessionArchive(requireHttp(), sessionId);
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, active: false, thinking: false } : s)),
    }));
  },

  async spawnSession(options) {
    if (MOCK_ENABLED) {
      const machine = get().machines.find((m) => m.id === options.machineId);
      const host = (machine?.metadata as { host?: string } | null)?.host ?? options.machineId;
      const session = buildMockSession(options.machineId, host, options.directory);
      set((state) => ({ sessions: [...state.sessions, session] }));
      return { type: 'success', sessionId: session.id };
    }
    const encryptor = machineEncryptors.get(options.machineId);
    if (!encryptor) throw new Error(unknownMachineError(useSettingsStore.getState().language, options.machineId));
    return machineSpawnNewSession(requireSocket(), encryptor, options);
  },

  async listMachineDirectory(machineId, path) {
    if (MOCK_ENABLED) return mockListDirectory(path);
    const encryptor = machineEncryptors.get(machineId);
    if (!encryptor) throw new Error(unknownMachineError(useSettingsStore.getState().language, machineId));
    const socket = requireSocket();
    return withDisconnectRetry(socket, () => machineListDirectory(socket, machineId, encryptor, path));
  },

  async createMachineDirectory(machineId, path, platform) {
    if (MOCK_ENABLED) return mockCreateDirectory(path);
    const encryptor = machineEncryptors.get(machineId);
    if (!encryptor) throw new Error(unknownMachineError(useSettingsStore.getState().language, machineId));
    const socket = requireSocket();
    return withDisconnectRetry(socket, () => machineCreateDirectory(socket, machineId, encryptor, path, platform));
  },

  async runMachineBash(machineId, command) {
    if (MOCK_ENABLED) return { success: true, stdout: '', stderr: '' };
    const encryptor = machineEncryptors.get(machineId);
    if (!encryptor) throw new Error(unknownMachineError(useSettingsStore.getState().language, machineId));
    return machineRunBash(requireSocket(), machineId, encryptor, command);
  },

  async resumeSession(sessionId) {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(unknownSessionError(useSettingsStore.getState().language, sessionId));
    const machineId = (session.metadata as { machineId?: string } | null)?.machineId;
    if (!machineId) throw new Error(noMachineIdToResumeError(useSettingsStore.getState().language));
    const encryptor = machineEncryptors.get(machineId);
    if (!encryptor) throw new Error(unknownMachineError(useSettingsStore.getState().language, machineId));
    const result = await machineResumeSession(requireSocket(), encryptor, machineId, sessionId);
    // Mirrors killSession's optimistic update in reverse — the RPC's own
    // success already tells us the process is back, but statusOf/
    // statusClassOf gate the "thinking" ephemeral behind `active`, so
    // without this the sidebar dot and tile header sit on stale "offline"
    // until a server-pushed update-session event happens to arrive (slow,
    // reaper-adjacent — same reason killSession forces its own flag rather
    // than waiting for one).
    if (result.type === 'success') {
      set((state) => ({ sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, active: true } : s)) }));
    }
    return result;
  },

  async deleteSession(sessionId) {
    await sessionDelete(requireHttp(), sessionId);
    sessionEncryptors.delete(sessionId);
    set((state) => ({ sessions: state.sessions.filter((s) => s.id !== sessionId) }));
  },

  async renameSession(sessionId, title) {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(unknownSessionError(useSettingsStore.getState().language, sessionId));
    const result = await updateSessionSummary(
      requireSocket(),
      sessionId,
      requireSessionEncryptor(sessionId),
      (session.metadata as Record<string, unknown>) ?? {},
      session.metadataVersion,
      title,
    );
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, metadata: result.metadata, metadataVersion: result.version } : s,
      ),
    }));
  },

  async readMachineFile(machineId, path) {
    const encryptor = machineEncryptors.get(machineId);
    if (!encryptor) throw new Error(unknownMachineError(useSettingsStore.getState().language, machineId));
    const socket = requireSocket();
    return withDisconnectRetry(socket, () => machineReadFile(socket, machineId, encryptor, path));
  },

  async writeMachineFile(machineId, path, content) {
    const encryptor = machineEncryptors.get(machineId);
    if (!encryptor) throw new Error(unknownMachineError(useSettingsStore.getState().language, machineId));
    const socket = requireSocket();
    return withDisconnectRetry(socket, () => machineWriteFile(socket, machineId, encryptor, path, content));
  },

  async writeMachineBinaryFile(machineId, path, bytes) {
    if (MOCK_ENABLED) return { success: true };
    const encryptor = machineEncryptors.get(machineId);
    if (!encryptor) throw new Error(unknownMachineError(useSettingsStore.getState().language, machineId));
    const socket = requireSocket();
    return withDisconnectRetry(socket, () => machineWriteBinaryFile(socket, machineId, encryptor, path, bytes));
  },

  async downloadAttachment(sessionId, ref) {
    if (MOCK_ENABLED) return MOCK_ATTACHMENT_PNG;
    if (!encryption) throw new Error('Not connected');
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) throw new Error(unknownSessionError(useSettingsStore.getState().language, sessionId));
    const encryptedBytes = await downloadAttachmentBytes(requireHttp(), sessionId, ref);
    const blobKey = encryption.getBlobKey(session.dataKey);
    const decrypted = await decryptBlobBytes(encryptedBytes, blobKey);
    if (!decrypted) throw new Error(attachmentDecryptFailedError(useSettingsStore.getState().language));
    return decrypted;
  },
}));
