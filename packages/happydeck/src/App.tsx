import { type DragEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, type PanelImperativeHandle, Separator } from 'react-resizable-panels';
import './App.css';
import { BulkActionBar } from './components/BulkActionBar';
import { LinkDeviceView } from './components/LinkDeviceView';
import { SessionTile } from './components/SessionTile';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { SESSION_DRAG_MIME } from './lib/dnd';
import { mostRecentSession } from './lib/sessionOrder';
import { useHappyStore } from './store/happyStore';
import { FONT_STACKS, useSettingsStore } from './store/settingsStore';
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
  const sidebarCollapsed = useViewStore((s) => s.sidebarCollapsed);
  const settingsOpen = useViewStore((s) => s.settingsOpen);
  const focusSession = useViewStore((s) => s.focusSession);
  const addPane = useViewStore((s) => s.addPane);
  const removePane = useViewStore((s) => s.removePane);
  const setSidebarCollapsed = useViewStore((s) => s.setSidebarCollapsed);
  const toggleSettings = useViewStore((s) => s.toggleSettings);
  const setSettingsOpen = useViewStore((s) => s.setSettingsOpen);

  const [dragOverPanes, setDragOverPanes] = useState(false);
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const font = useSettingsStore((s) => s.font);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-ui', FONT_STACKS[font]);
  }, [font]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ',' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSettings();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSettings]);

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

  const renderTile = (session: (typeof paneSessions)[number]) => (
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
  );

  return (
    <>
      <Group orientation="horizontal" className="app-shell">
        <Panel
          id="sidebar"
          panelRef={sidebarPanelRef}
          defaultSize={sidebarCollapsed ? 52 : 220}
          minSize={180}
          maxSize={420}
          collapsible
          collapsedSize={52}
          onResize={(size) => setSidebarCollapsed(size.inPixels <= 54)}
        >
          <Sidebar sessions={sessions} focusedSessionId={focusedSessionId} panelRef={sidebarPanelRef} />
        </Panel>

        <Separator className="app-shell-separator" />

        <Panel id="main" minSize={360}>
          <main className="app-main">
            {mode.type === 'grid' && <BulkActionBar />}

            {status === 'loading' && <p className="app-message">connecting…</p>}

            {status === 'linking-required' && <LinkDeviceView />}

            {status === 'error' && <p className="app-message app-message-error">{error}</p>}

            {status === 'ready' && sessions.length === 0 && <p className="app-message">No sessions found.</p>}

            {status === 'ready' && sessions.length > 0 && mode.type === 'panes' && (
              <Group
                orientation="horizontal"
                className="panes"
                onDragOver={acceptPaneDrag}
                onDragEnter={() => setDragOverPanes(true)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverPanes(false);
                }}
                onDrop={dropOntoPanes}
              >
                {paneSessions.length === 0 && !dragOverPanes && (
                  <Panel id="empty">
                    <p className="app-message">That session is gone. Pick another from the sidebar, or drag one in.</p>
                  </Panel>
                )}
                {paneSessions.map((session, index) => (
                  <Fragment key={session.id}>
                    {index > 0 && <Separator className="pane-separator" />}
                    <Panel id={session.id} minSize={240}>
                      {renderTile(session)}
                    </Panel>
                  </Fragment>
                ))}
                {/* A real Panel, not a CSS overlay — shows exactly how much
                    space the dropped session will take, live, using the
                    same proportional layout the drop will actually produce. */}
                {dragOverPanes && (
                  <>
                    {paneSessions.length > 0 && <Separator className="pane-separator" />}
                    <Panel id="drop-preview" minSize={160} defaultSize={paneSessions.length === 0 ? 100 : undefined}>
                      <div className="pane-drop-preview">drop here to split</div>
                    </Panel>
                  </>
                )}
              </Group>
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
        </Panel>
      </Group>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

export default App;
