import { create } from 'zustand';

export type ViewMode = { type: 'solo'; sessionId: string } | { type: 'grid' };

interface ViewState {
  mode: ViewMode;
  /** Set once auto-focus has picked (or explicitly deferred) an initial session, so it never fights a later manual choice. */
  initialized: boolean;
  sidebarCollapsed: boolean;
  focusSession: (sessionId: string) => void;
  showGrid: () => void;
  markInitialized: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
}

export const useViewStore = create<ViewState>((set) => ({
  mode: { type: 'grid' },
  initialized: false,
  sidebarCollapsed: typeof window !== 'undefined' ? window.innerWidth < 640 : false,

  focusSession: (sessionId) => set({ mode: { type: 'solo', sessionId }, initialized: true }),
  showGrid: () => set({ mode: { type: 'grid' }, initialized: true }),
  markInitialized: () => set({ initialized: true }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
