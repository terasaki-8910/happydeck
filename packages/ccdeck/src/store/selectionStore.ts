import { create } from 'zustand';

interface SelectionState {
  selected: Set<string>;
  toggle: (sessionId: string) => void;
  clear: () => void;
  isSelected: (sessionId: string) => boolean;
}

/** Ephemeral (not persisted) cross-tile selection, used for bulk send/approve. */
export const useSelectionStore = create<SelectionState>((set, get) => ({
  selected: new Set(),

  toggle: (sessionId) =>
    set((state) => {
      const next = new Set(state.selected);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return { selected: next };
    }),

  clear: () => set({ selected: new Set() }),

  isSelected: (sessionId) => get().selected.has(sessionId),
}));
