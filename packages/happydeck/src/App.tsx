import { type DragEvent, useEffect, useMemo, useState } from 'react';
import './App.css';
import { BulkActionBar } from './components/BulkActionBar';
import { SessionTile } from './components/SessionTile';
import { Sidebar } from './components/Sidebar';
import { SESSION_DRAG_MIME } from './lib/dnd';
import { mostRecentSession } from './lib/sessionOrder';
import { useHappyStore } from './store/happyStore';
import { useViewStore } from './store/viewStore';
import { useWorkspaceStore } from './store/workspaceStore';

function App() {
  const status = useHappyStore((s) => s.status);
  const error = useHappyStore((s) => s.error);
  const sessions = useHappyStore((s) => s.sessions);
  const bootstrap = useHappyStore((s) => s.bootstrap);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const addSessionToWorkspace = useWorkspaceStore((s) => s.addSessionToWorkspace);
  const removeSessionFromWorkspace = useWorkspaceStore((s) => s.removeSessionFromWorkspace);

  const mode = useViewStore((s) => s.mode);
  const initialized = useViewStore((s) => s.initialized);
  const focusSession = useViewStore((s) => s.focusSession);
  const addPane = useViewStore((s) => s.addPane);
  const removePane = useViewStore((s) => s.removePane);

  const [dragOverPanes, setDragOverPanes] = useState(false);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Land on the most-recently-active session's panes view by default, once —
  // this never runs again after the user (or a tab click) picks a view.
  useEffect(() => {
    if (status === 'ready' && !initialized && sessions.length > 0) {
      const recent = mostRecentSession(sessions);
      if (recent) focusSession(recent.id);
    }
  }, [status, initialized, sessions, focusSession]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const visibleSessions = useMemo(() => {
    if (!activeWorkspace) {
      return sessions;
    }
    const memberIds = new Set(activeWorkspace.sessionIds);
    return sessions.filter((s) => memberIds.has(s.id));
  }, [sessions, activeWorkspace]);

  const paneSessionIds = mode.type === 'panes' ? mode.sessionIds : [];
  const paneSessions = paneSessionIds.map((id) => sessions.find((s) => s.id === id)).filter((s) => s !== undefined);
  const focusedSessionId = paneSessionIds.length === 1 ? paneSessionIds[0] : null;

  const acceptPaneDrag = (event: DragEvent) => {
    if (event.dataTransfer.types.includes(SESSION_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const dropOntoPanes = (event: DragEvent) => {
    event.preventDefault();
    setDragOverPanes(false);
    const sessionId = event.dataTransfer.getData(SESSION_DRAG_MIME);
    if (sessionId) addPane(sessionId);
  };

  return (
    <div className="app-shell">
      <Sidebar sessions={sessions} focusedSessionId={focusedSessionId} />

      <main className="app-main">
        {mode.type === 'grid' && <BulkActionBar />}

        {status === 'loading' && <p className="app-message">connecting…</p>}

        {status === 'linking-required' && (
          <p className="app-message">
            No Happy account linked yet. Run <code>pnpm --filter happy-client run link</code> and scan the QR with the
            Happy app on your phone, then reload.
          </p>
        )}

        {status === 'error' && <p className="app-message app-message-error">{error}</p>}

        {status === 'ready' && sessions.length === 0 && <p className="app-message">No sessions found.</p>}

        {status === 'ready' && sessions.length > 0 && mode.type === 'panes' && (
          <div
            className={`panes ${dragOverPanes ? 'panes-drop-target' : ''}`}
            onDragOver={acceptPaneDrag}
            onDragEnter={() => setDragOverPanes(true)}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverPanes(false);
            }}
            onDrop={dropOntoPanes}
          >
            {paneSessions.length === 0 && (
              <p className="app-message">That session is gone. Pick another from the sidebar, or drag one in.</p>
            )}
            {paneSessions.map((session) => (
              <SessionTile
                key={session.id}
                session={session}
                workspaces={workspaces}
                activeWorkspaceId={activeWorkspaceId}
                onAddToWorkspace={addSessionToWorkspace}
                onRemoveFromWorkspace={removeSessionFromWorkspace}
                variant="solo"
                onClosePane={paneSessions.length > 1 ? () => removePane(session.id) : undefined}
              />
            ))}
          </div>
        )}

        {status === 'ready' && sessions.length > 0 && mode.type === 'grid' && (
          <div className="grid">
            {visibleSessions.length === 0 && <p className="app-message">No sessions assigned to this tab yet.</p>}
            {visibleSessions.map((session) => (
              <SessionTile
                key={session.id}
                session={session}
                workspaces={workspaces}
                activeWorkspaceId={activeWorkspaceId}
                onAddToWorkspace={addSessionToWorkspace}
                onRemoveFromWorkspace={removeSessionFromWorkspace}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
