import { useEffect, useMemo } from 'react';
import './App.css';
import { BulkActionBar } from './components/BulkActionBar';
import { SessionTile } from './components/SessionTile';
import { Sidebar } from './components/Sidebar';
import { SpawnPanel } from './components/SpawnPanel';
import { TabBar } from './components/TabBar';
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

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Land on the most-recently-active session's solo view by default, once —
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

  const focusedSessionId = mode.type === 'solo' ? mode.sessionId : null;
  const focusedSession = focusedSessionId ? (sessions.find((s) => s.id === focusedSessionId) ?? null) : null;

  return (
    <div className="app-shell">
      <Sidebar sessions={sessions} focusedSessionId={focusedSessionId} />

      <main className="app-main">
        <div className="toolbar">
          <TabBar />
          <SpawnPanel />
        </div>

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

        {status === 'ready' && sessions.length > 0 && mode.type === 'solo' && (
          <div className="solo">
            {focusedSession ? (
              <SessionTile
                key={focusedSession.id}
                session={focusedSession}
                workspaces={workspaces}
                activeWorkspaceId={activeWorkspaceId}
                onAddToWorkspace={addSessionToWorkspace}
                onRemoveFromWorkspace={removeSessionFromWorkspace}
                variant="solo"
              />
            ) : (
              <p className="app-message">That session is gone. Pick another from the sidebar.</p>
            )}
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
