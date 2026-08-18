import { create } from 'zustand';
import {
  appendAsRootSibling,
  type DropZone,
  insertAtGap,
  insertAtOuterEdge,
  insertAtZone,
  leaf,
  type OuterEdge,
  type PaneNode,
  paneTreeHas,
  paneTreeSessionIds,
  removeFromPaneTree,
  replaceLeaf,
} from '../lib/paneTree';

// 'panes': the main content area shows one or more sessions laid out as a
// binary split tree (see lib/paneTree.ts). Clicking a sidebar session
// replaces the active pane in place; dragging one onto a pane's edge
// splits it there. 'grid': a workspace tab's full grid (existing
// tab/workspace behavior), unrelated to panes.
export type ViewMode = { type: 'panes'; tree: PaneNode } | { type: 'grid' };

interface ViewState {
  mode: ViewMode;
  /** Which pane a sidebar click replaces. Follows whichever pane was most recently added or clicked into. */
  activePaneSessionId: string | null;
  /** Set once auto-focus has picked (or explicitly deferred) an initial session, so it never fights a later manual choice. */
  initialized: boolean;
  sidebarCollapsed: boolean;
  settingsOpen: boolean;
  searchOpen: boolean;
  /**
   * Click a sidebar session. If a split is already open, this replaces the
   * active pane in place (like clicking a file in an IDE's active editor
   * group) instead of collapsing the whole split down to just this one —
   * that collapsing was the exact behavior flagged as "disappointing".
   */
  focusSession: (sessionId: string) => void;
  /** Drag a sidebar session onto an existing pane's edge/corner: split that pane, placing the new session on the named side. 'center' replaces it in place instead of splitting. Irregular/unequal — the deliberately-kept-as-is nested-split gesture. */
  addPaneAtZone: (targetSessionId: string, zone: DropZone, sessionId: string) => void;
  /** Drag to the outer edge of the whole pane area: adds a new pane there and evenly rebalances every top-level sibling on that axis. */
  addPaneAtOuterEdge: (edge: OuterEdge, sessionId: string) => void;
  /** Drop directly on a divider: inserts a new pane at that gap and evenly rebalances every child of the split that divider belongs to. */
  addPaneAtGap: (splitPath: string, gapIndex: number, sessionId: string) => void;
  /** Drag a sidebar session onto empty space (only reachable when no pane is open yet). */
  addPaneToRoot: (sessionId: string) => void;
  /** Mark a pane as the one sidebar clicks will replace — called when a pane is clicked/focused directly. */
  setActivePane: (sessionId: string) => void;
  removePane: (sessionId: string) => void;
  showGrid: () => void;
  markInitialized: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSettings: () => void;
  setSettingsOpen: (open: boolean) => void;
  toggleSearch: () => void;
  setSearchOpen: (open: boolean) => void;
}

export const useViewStore = create<ViewState>((set, get) => ({
  mode: { type: 'grid' },
  activePaneSessionId: null,
  initialized: false,
  sidebarCollapsed: typeof window !== 'undefined' ? window.innerWidth < 640 : false,
  settingsOpen: false,
  searchOpen: false,

  focusSession: (sessionId) =>
    set((state) => {
      if (state.mode.type !== 'panes') {
        return { mode: { type: 'panes', tree: leaf(sessionId) }, activePaneSessionId: sessionId, initialized: true };
      }
      // Already visible in some pane — just make that pane active instead
      // of replacing a *different* pane with a second copy of it.
      if (paneTreeHas(state.mode.tree, sessionId)) {
        return { activePaneSessionId: sessionId, initialized: true };
      }
      const ids = paneTreeSessionIds(state.mode.tree);
      const target = state.activePaneSessionId && paneTreeHas(state.mode.tree, state.activePaneSessionId) ? state.activePaneSessionId : ids[ids.length - 1];
      return { mode: { type: 'panes', tree: replaceLeaf(state.mode.tree, target, sessionId) }, activePaneSessionId: sessionId, initialized: true };
    }),

  addPaneAtZone: (targetSessionId, zone, sessionId) =>
    set((state) => {
      if (state.mode.type !== 'panes' || !paneTreeHas(state.mode.tree, targetSessionId) || targetSessionId === sessionId) {
        return state;
      }
      const tree = paneTreeHas(state.mode.tree, sessionId) ? removeFromPaneTree(state.mode.tree, sessionId) : state.mode.tree;
      if (!tree) return state;
      return { mode: { type: 'panes', tree: insertAtZone(tree, targetSessionId, zone, sessionId) }, activePaneSessionId: sessionId };
    }),

  addPaneAtOuterEdge: (edge, sessionId) =>
    set((state) => {
      if (state.mode.type !== 'panes') return state;
      const tree = paneTreeHas(state.mode.tree, sessionId) ? removeFromPaneTree(state.mode.tree, sessionId) : state.mode.tree;
      return { mode: { type: 'panes', tree: insertAtOuterEdge(tree, edge, sessionId) }, activePaneSessionId: sessionId };
    }),

  addPaneAtGap: (splitPath, gapIndex, sessionId) =>
    set((state) => {
      if (state.mode.type !== 'panes') return state;
      const tree = paneTreeHas(state.mode.tree, sessionId) ? removeFromPaneTree(state.mode.tree, sessionId) : state.mode.tree;
      if (!tree) return state;
      return { mode: { type: 'panes', tree: insertAtGap(tree, splitPath, gapIndex, sessionId) }, activePaneSessionId: sessionId };
    }),

  addPaneToRoot: (sessionId) =>
    set((state) => {
      if (state.mode.type === 'panes' && paneTreeHas(state.mode.tree, sessionId)) return state;
      const tree = state.mode.type === 'panes' ? state.mode.tree : null;
      return { mode: { type: 'panes', tree: appendAsRootSibling(tree, sessionId) }, activePaneSessionId: sessionId, initialized: true };
    }),

  setActivePane: (sessionId) => set({ activePaneSessionId: sessionId }),

  removePane: (sessionId) =>
    set((state) => {
      if (state.mode.type !== 'panes') return state;
      const tree = removeFromPaneTree(state.mode.tree, sessionId);
      const remainingIds = tree ? paneTreeSessionIds(tree) : [];
      const activePaneSessionId = get().activePaneSessionId === sessionId ? (remainingIds.length > 0 ? remainingIds[remainingIds.length - 1] : null) : get().activePaneSessionId;
      return { mode: tree ? { type: 'panes', tree } : { type: 'grid' }, activePaneSessionId };
    }),

  showGrid: () => set({ mode: { type: 'grid' }, initialized: true }),
  markInitialized: () => set({ initialized: true }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  toggleSearch: () => set((state) => ({ searchOpen: !state.searchOpen })),
  setSearchOpen: (open) => set({ searchOpen: open }),
}));
