import { create } from 'zustand';

// 'panes': the main content area shows one or more sessions, chosen by
// clicking (replaces the set) or dragging from the sidebar (adds to it).
// 'grid': a workspace tab's full grid (existing tab/workspace behavior),
// unrelated to panes.
export type ViewMode = { type: 'panes'; sessionIds: string[] } | { type: 'grid' };

interface ViewState {
  mode: ViewMode;
  /** Set once auto-focus has picked (or explicitly deferred) an initial session, so it never fights a later manual choice. */
  initialized: boolean;
  sidebarCollapsed: boolean;
  settingsOpen: boolean;
  /** Click a sidebar session: jump to viewing just that one. */
  focusSession: (sessionId: string) => void;
  /** Drag a sidebar session into the panes area: add it alongside whatever's already open. */
  addPane: (sessionId: string) => void;
  removePane: (sessionId: string) => void;
  showGrid: () => void;
  markInitialized: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSettings: () => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  mode: { type: 'grid' },
  initialized: false,
  sidebarCollapsed: typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  settingsOpen: false,

  focusSession: (sessionId) => set({ mode: { type: 'panes', sessionIds: [sessionId] }, initialized: true }),

  addPane: (sessionId) =>
    set((state) => {
      if (state.mode.type !== 'panes') {
        return { mode: { type: 'panes', sessionIds: [sessionId] }, initialized: true };
      }
      if (state.mode.sessionIds.includes(sessionId)) {
        return state;
      }
      return { mode: { type: 'panes', sessionIds: [...state.mode.sessionIds, sessionId] } };
    }),

  removePane: (sessionId) =>
    set((state) => {
      if (state.mode.type !== 'panes') return state;
      return { mode: { type: 'panes', sessionIds: state.mode.sessionIds.filter((id) => id !== sessionId) } };
    }),

  showGrid: () => set({ mode: { type: 'grid' }, initialized: true }),
  markInitialized: () => set({ initialized: true }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));
