import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PinState {
  pinnedIds: string[];
  isPinned: (id: string) => boolean;
  togglePin: (id: string) => void;
}

export const usePinStore = create<PinState>()(
  persist(
    (set, get) => ({
      pinnedIds: [],
      isPinned: (id) => get().pinnedIds.includes(id),
      togglePin: (id) =>
        set((state) => ({
          pinnedIds: state.pinnedIds.includes(id) ? state.pinnedIds.filter((x) => x !== id) : [...state.pinnedIds, id],
        })),
    }),
    { name: 'happydeck-pins' },
  ),
);
