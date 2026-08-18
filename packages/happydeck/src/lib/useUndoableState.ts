import { useCallback, useRef, useState } from 'react';

const DEFAULT_COALESCE_MS = 500;

/**
 * Text-editing undo/redo independent of the browser's own native undo
 * stack. Needed because the composer's value gets overwritten
 * programmatically in a few places (slash-command insertion, attachment
 * references) — those assignments don't go through real keyboard input, so
 * they silently desync the native undo stack from what's on screen (native
 * undo either does nothing or jumps to a stale state). Edits within
 * `coalesceMs` of each other collapse into one undo step, so normal typing
 * undoes in word-ish chunks rather than one keystroke at a time; pass
 * `coalesce: false` (used for programmatic insertions) to always start a
 * fresh step.
 */
export function useUndoableState(initial: string, coalesceMs = DEFAULT_COALESCE_MS) {
  const [value, setValue] = useState(initial);
  const stackRef = useRef<string[]>([initial]);
  const indexRef = useRef(0);
  const lastEditAtRef = useRef(0);

  const set = useCallback(
    (nextOrUpdater: string | ((prev: string) => string), options?: { coalesce?: boolean }) => {
      // stackRef.current[indexRef.current] (not React `value`, which only
      // updates on next render) is the true current value — reading it here
      // lets a caller mid-await (e.g. attachFiles, which appends a
      // reference only after its writes resolve) append onto whatever the
      // user typed in the meantime instead of clobbering it with a stale
      // closure, the same class of bug that caused the original data-loss
      // incident with the old summarize button.
      const prev = stackRef.current[indexRef.current];
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;
      setValue(next);
      const now = Date.now();
      const atTopOfStack = indexRef.current === stackRef.current.length - 1;
      const shouldCoalesce = options?.coalesce !== false && atTopOfStack && now - lastEditAtRef.current < coalesceMs;
      lastEditAtRef.current = now;
      if (shouldCoalesce) {
        stackRef.current[indexRef.current] = next;
        return;
      }
      // Typing after undoing forks the stack here, discarding the
      // now-stale redo entries — standard editor undo-stack behavior.
      const truncated = stackRef.current.slice(0, indexRef.current + 1);
      truncated.push(next);
      stackRef.current = truncated;
      indexRef.current = truncated.length - 1;
    },
    [coalesceMs],
  );

  // For "this value is no longer meaningfully undoable" points (e.g. right
  // after sending — nothing to undo back TO once the message is gone over
  // the wire): starts a brand new stack instead of pushing onto the old one.
  const reset = useCallback((next: string) => {
    setValue(next);
    stackRef.current = [next];
    indexRef.current = 0;
    lastEditAtRef.current = 0;
  }, []);

  const undo = useCallback(() => {
    if (indexRef.current <= 0) return;
    indexRef.current -= 1;
    lastEditAtRef.current = 0;
    setValue(stackRef.current[indexRef.current]);
  }, []);

  const redo = useCallback(() => {
    if (indexRef.current >= stackRef.current.length - 1) return;
    indexRef.current += 1;
    lastEditAtRef.current = 0;
    setValue(stackRef.current[indexRef.current]);
  }, []);

  return { value, set, reset, undo, redo };
}
