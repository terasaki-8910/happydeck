import { useEffect } from 'react';
import './App.css';
import { SessionTile } from './components/SessionTile';
import { useHappyStore } from './store/happyStore';

function App() {
  const status = useHappyStore((s) => s.status);
  const error = useHappyStore((s) => s.error);
  const sessions = useHappyStore((s) => s.sessions);
  const bootstrap = useHappyStore((s) => s.bootstrap);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  return (
    <main className="app">
      <header className="app-header">
        <h1>ccdeck</h1>
        <span className="app-subtitle">
          {sessions.length} session{sessions.length === 1 ? '' : 's'} on this machine
        </span>
      </header>

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
          {sessions.length === 0 && <p className="app-message">No sessions found for this machine.</p>}
          {sessions.map((session) => (
            <SessionTile key={session.id} session={session} />
          ))}
        </div>
      )}
    </main>
  );
}

export default App;
