import { useEffect, useMemo } from 'react';
import './App.css';
import { SessionTile } from './components/SessionTile';
import { TabBar } from './components/TabBar';
import { useHappyStore } from './store/happyStore';
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

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
  const visibleSessions = useMemo(() => {
    if (!activeWorkspace) {
      return sessions;
    }
    const memberIds = new Set(activeWorkspace.sessionIds);
    return sessions.filter((s) => memberIds.has(s.id));
  }, [sessions, activeWorkspace]);

  return (
    <main className="app">
      <header className="app-header">
        <h1>ccdeck</h1>
        <span className="app-subtitle">
          {visibleSessions.length} session{visibleSessions.length === 1 ? '' : 's'}
          {activeWorkspace ? ` in "${activeWorkspace.name}"` : ' across all machines'}
        </span>
      </header>

      <TabBar />

      {status === 'loading' && <p className="app-message">connecting…</p>}

      {status === 'linking-required' && (
        <p className="app-message">
          No Happy account linked yet. Run <code>pnpm --filter happy-client run link</code> and scan the QR with the
          Happy app on your phone, then reload.
        </p>
      )}

      {status === 'error' && <p className="app-message app-message-error">{error}</p>}

      {status === 'ready' && (
        <div className="grid">
          {visibleSessions.length === 0 && (
            <p className="app-message">{activeWorkspace ? 'No sessions assigned to this tab yet.' : 'No sessions found.'}</p>
          )}
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
  );
}

export default App;
