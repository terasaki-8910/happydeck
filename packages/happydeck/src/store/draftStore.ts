import { create } from 'zustand';
import { useHappyStore } from './happyStore';

/**
 * Per-session composer drafts, including their full undo/redo history.
 *
 * Why a store rather than component state: App.tsx renders
 * `<SessionTile key={sessionId} …>` in both the panes view (App.tsx:319)
 * and the grid view (App.tsx:404), so switching which session a pane
 * shows UNMOUNTS the old tile — anything the user had half-typed in it
 * (and its undo stack) died with the component. Keying the draft by
 * sessionId here instead makes the tile's composer a pure view of state
 * that outlives the mount, which is the only way the text can survive a
 * switch-away-and-back.
 *
 * Memory-only, deliberately NOT persisted to disk (unlike settings/
 * workspaces, which go through createTauriFileStorage). Two reasons:
 * (1) a draft is written on essentially every keystroke, and
 * createTauriFileStorage's setItem is a full-file Tauri IPC round-trip
 * per write (tauriStorage.ts: `invoke('write_app_config_file', { …,
 * append: false })`) — persisting would mean one disk write per character
 * typed across every open composer, for state whose whole value is being
 * instantly current; (2) a half-sentence resurfacing days later next to a
 * session that has long since moved on is its own kind of confusing, and
 * far harder to notice than the loss this fixes. The reported complaint
 * is specifically about switching chats, which is a within-run problem.
 * If cross-restart survival is wanted later, the fix is `persist` with a
 * debounced storage wrapper (a few hundred ms), not a raw write per
 * keystroke.
 */
export interface DraftEntry {
  /** Undo history, oldest first. `stack[index]` is the value currently shown. */
  stack: string[];
  index: number;
}

/**
 * Undo history used to be bounded implicitly by the tile's mount lifetime;
 * now that it survives switching, an unbounded stack for every session
 * would be a slow leak. Steps coalesce on a 500ms window (see
 * useSessionDraft), so 200 is on the order of several minutes of
 * continuous typing — far more than anyone undoes through — while capping
 * a single session's history at 200 string copies.
 */
const MAX_UNDO_STEPS = 200;

const EMPTY_ENTRY: DraftEntry = { stack: [''], index: 0 };

interface DraftState {
  drafts: Record<string, DraftEntry>;
  /**
   * `coalesce` is resolved by the caller (the hook owns the typing-rhythm
   * timer, which is per-mount, not global state); this only enforces the
   * part that depends on state the store owns — you can never coalesce
   * into a step you have already undone away from.
   */
  setValue: (sessionId: string, nextOrUpdater: string | ((prev: string) => string), coalesce: boolean) => void;
  reset: (sessionId: string, next: string) => void;
  undo: (sessionId: string) => void;
  redo: (sessionId: string) => void;
  /** Drops drafts for sessions that no longer exist. See the subscription at the bottom of this file. */
  prune: (existingSessionIds: readonly string[]) => void;
}

export const useDraftStore = create<DraftState>((set) => ({
  drafts: {},

  setValue: (sessionId, nextOrUpdater, coalesce) =>
    set((state) => {
      const entry = state.drafts[sessionId] ?? EMPTY_ENTRY;
      // Read the previous value out of the store, not out of a React
      // closure: a caller mid-await (attachFiles appends its
      // "[Attached file: …]" reference only after its remote writes
      // resolve) must append onto whatever the user typed in the
      // meantime instead of clobbering it with a stale snapshot — the
      // same class of bug as the original data-loss incident with the
      // old summarize button. EMPTY_ENTRY is only ever read from, never
      // written through: both branches below copy the stack first.
      const prev = entry.stack[entry.index] ?? '';
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;
      // A no-op write (e.g. a programmatic set that happens to produce
      // the same text) must not push a duplicate undo step, and must not
      // publish a new state object that re-renders every tile.
      if (next === prev) return state;
      const atTopOfStack = entry.index === entry.stack.length - 1;
      if (coalesce && atTopOfStack) {
        const stack = entry.stack.slice();
        stack[entry.index] = next;
        return { drafts: { ...state.drafts, [sessionId]: { stack, index: entry.index } } };
      }
      // Typing after undoing forks the stack here, discarding the
      // now-stale redo entries — standard editor undo-stack behavior.
      const truncated = entry.stack.slice(0, entry.index + 1);
      truncated.push(next);
      const overflow = Math.max(0, truncated.length - MAX_UNDO_STEPS);
      const stack = overflow > 0 ? truncated.slice(overflow) : truncated;
      return { drafts: { ...state.drafts, [sessionId]: { stack, index: stack.length - 1 } } };
    }),

  // For "this value is no longer meaningfully undoable" points (right
  // after sending — nothing to undo back TO once the message is gone over
  // the wire): starts a brand new stack instead of pushing onto the old one.
  reset: (sessionId, next) =>
    set((state) => {
      if (next === '') {
        // Resetting to empty is the post-send path, i.e. by far the most
        // common one. Deleting the key rather than storing an empty stack
        // keeps this map from growing one permanent entry per session the
        // user has ever typed in; an absent key already reads as ''.
        if (!(sessionId in state.drafts)) return state;
        const drafts = { ...state.drafts };
        delete drafts[sessionId];
        return { drafts };
      }
      return { drafts: { ...state.drafts, [sessionId]: { stack: [next], index: 0 } } };
    }),

  undo: (sessionId) =>
    set((state) => {
      const entry = state.drafts[sessionId];
      if (!entry || entry.index <= 0) return state;
      return { drafts: { ...state.drafts, [sessionId]: { stack: entry.stack, index: entry.index - 1 } } };
    }),

  redo: (sessionId) =>
    set((state) => {
      const entry = state.drafts[sessionId];
      if (!entry || entry.index >= entry.stack.length - 1) return state;
      return { drafts: { ...state.drafts, [sessionId]: { stack: entry.stack, index: entry.index + 1 } } };
    }),

  prune: (existingSessionIds) =>
    set((state) => {
      const alive = new Set(existingSessionIds);
      let changed = false;
      const drafts: Record<string, DraftEntry> = {};
      for (const [sessionId, entry] of Object.entries(state.drafts)) {
        if (alive.has(sessionId)) drafts[sessionId] = entry;
        else changed = true;
      }
      // Returning the untouched state (not a fresh object) when nothing
      // was dropped matters: this runs off every sessions-array change,
      // which includes every incoming message. zustand compares with
      // Object.is before notifying, so an unchanged return costs zero
      // re-renders.
      return changed ? { drafts } : state;
    }),
}));

/**
 * Cleanup. Drafts are keyed by sessionId, so a deleted session would
 * otherwise leave its text pinned in memory for the rest of the run.
 *
 * Driven off happyStore's own session list rather than patched into
 * deleteSession, because a session disappears by two independent routes —
 * the local `deleteSession` action (happyStore.ts:827) and the relay's
 * pushed `delete-session` update (happyStore.ts:441) — and both land here.
 *
 * Deliberately NOT tied to killSession: that only archives (sets
 * active:false, happyStore.ts:751/:763) and leaves the session in the
 * list, and such a session can be brought back with resumeSession
 * (happyStore.ts:819), so a draft written against it is still worth
 * keeping.
 *
 * No empty-list guard: the only `sessions: []` in happyStore is its
 * initial value, which exists before this listener can ever fire and
 * before any draft can exist. bootstrap()'s loading and error branches
 * both leave `sessions` untouched. Guarding on length === 0 would
 * therefore protect nothing and would instead permanently pin the draft
 * of the last session you delete.
 */
useHappyStore.subscribe((state, prev) => {
  if (state.sessions === prev.sessions) return;
  // Cheap bail-out on the overwhelmingly common case (a message arrived,
  // nobody has typed anything) before allocating the Set in prune.
  if (Object.keys(useDraftStore.getState().drafts).length === 0) return;
  useDraftStore.getState().prune(state.sessions.map((s) => s.id));
});
