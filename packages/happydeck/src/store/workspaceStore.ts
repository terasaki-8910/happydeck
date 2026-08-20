import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createTauriFileStorage } from '../lib/tauriStorage';

export interface Workspace {
  id: string;
  name: string;
  sessionIds: string[];
}

interface WorkspaceState {
  workspaces: Workspace[];
  /** null = the built-in "All" view (every session, not a stored workspace). */
  activeWorkspaceId: string | null;
  setActiveWorkspace: (id: string | null) => void;
  createWorkspace: (name: string) => void;
  deleteWorkspace: (id: string) => void;
  addSessionToWorkspace: (workspaceId: string, sessionId: string) => void;
  removeSessionFromWorkspace: (workspaceId: string, sessionId: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      workspaces: [],
      activeWorkspaceId: null,

      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),

      createWorkspace: (name) =>
        set((state) => {
          const workspace: Workspace = { id: crypto.randomUUID(), name, sessionIds: [] };
          return { workspaces: [...state.workspaces, workspace], activeWorkspaceId: workspace.id };
        }),

      deleteWorkspace: (id) =>
        set((state) => ({
          workspaces: state.workspaces.filter((w) => w.id !== id),
          activeWorkspaceId: state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
        })),

      addSessionToWorkspace: (workspaceId, sessionId) =>
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === workspaceId && !w.sessionIds.includes(sessionId)
              ? { ...w, sessionIds: [...w.sessionIds, sessionId] }
              : w,
          ),
        })),

      removeSessionFromWorkspace: (workspaceId, sessionId) =>
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === workspaceId ? { ...w, sessionIds: w.sessionIds.filter((id) => id !== sessionId) } : w,
          ),
        })),
    }),
    { name: 'happydeck-workspaces', storage: createJSONStorage(() => createTauriFileStorage('workspaces.json')) },
  ),
);
