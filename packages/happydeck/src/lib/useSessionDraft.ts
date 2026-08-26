import { useCallback, useRef } from 'react';
import { useDraftStore } from '../store/draftStore';

const DEFAULT_COALESCE_MS = 500;

/**
 * The composer's draft, bound to one session. Drop-in replacement for the
 * old useUndoableState (same { value, set, reset, undo, redo } shape), with
 * the state moved into useDraftStore so it survives the tile unmounting
 * when the user switches which session a pane shows.
 *
 * Text-editing undo/redo stays independent of the browser's own native
 * undo stack, for the reason it always was: the composer's value gets
 * overwritten programmatically in a few places (slash-command insertion,
 * restoring an interrupted message from Stop), and those assignments don't
 * go through real keyboard input, so they silently desync the native stack
 * from what's on screen (native undo either does nothing or jumps to a
 * stale state).
 *
 * Only the coalescing timer stays per-mount (a ref, below) — the undo
 * HISTORY belongs to the session, but "were these two edits part of the
 * same burst of typing?" is a question about one continuous editing
 * session at the keyboard. Starting fresh on mount means the first
 * keystroke after switching back opens a new undo step instead of
 * silently rewriting the last step from before the switch.
 */
export function useSessionDraft(sessionId: string, coalesceMs = DEFAULT_COALESCE_MS) {
  const value = useDraftStore((state) => {
    const entry = state.drafts[sessionId];
    return entry ? (entry.stack[entry.index] ?? '') : '';
  });
  const lastEditAtRef = useRef(0);

  // The store's actions are stable for the store's lifetime, so reading
  // them through getState() instead of subscribing to them keeps this
  // component's only subscription the one above — the derived string,
  // which is a primitive and so re-renders only on an actual text change.
  const set = useCallback(
    (nextOrUpdater: string | ((prev: string) => string), options?: { coalesce?: boolean }) => {
      const now = Date.now();
      // Edits within `coalesceMs` of each other collapse into one undo
      // step, so normal typing undoes in word-ish chunks rather than one
      // keystroke at a time; `coalesce: false` (used for programmatic
      // insertions) always starts a fresh step.
      const coalesce = options?.coalesce !== false && now - lastEditAtRef.current < coalesceMs;
      lastEditAtRef.current = now;
      useDraftStore.getState().setValue(sessionId, nextOrUpdater, coalesce);
    },
    [sessionId, coalesceMs],
  );

  const reset = useCallback(
    (next: string) => {
      // Zeroing the timer is what stops the next keystroke from coalescing
      // into — and thereby overwriting — the fresh base step this just
      // created, which would make the pre-edit value unreachable by undo.
      lastEditAtRef.current = 0;
      useDraftStore.getState().reset(sessionId, next);
    },
    [sessionId],
  );

  const undo = useCallback(() => {
    lastEditAtRef.current = 0;
    useDraftStore.getState().undo(sessionId);
  }, [sessionId]);

  const redo = useCallback(() => {
    lastEditAtRef.current = 0;
    useDraftStore.getState().redo(sessionId);
  }, [sessionId]);

  return { value, set, reset, undo, redo };
}
