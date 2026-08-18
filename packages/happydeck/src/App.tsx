import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, type PanelImperativeHandle, Separator } from 'react-resizable-panels';
import './App.css';
import { BulkActionBar } from './components/BulkActionBar';
import { LinkDeviceView } from './components/LinkDeviceView';
import { PaneTreeView } from './components/PaneTreeView';
import { SessionTile } from './components/SessionTile';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { SESSION_DRAG_MIME } from './lib/dnd';
import { type DropZone, insertAtGap, insertAtOuterEdge, insertAtZone, type OuterEdge, paneTreeSessionIds, zoneFromPointer } from './lib/paneTree';
import { mostRecentSession } from './lib/sessionOrder';
import { useHappyStore } from './store/happyStore';
import { FONT_STACKS, useSettingsStore } from './store/settingsStore';
import { useViewStore } from './store/viewStore';
import { useWorkspaceStore } from './store/workspaceStore';

// Placeholder sessionId standing in for whatever's being dragged, while
// it's being dragged. dataTransfer.getData() only returns the real payload
// on 'drop' (browsers withhold it during dragover for security), so the
// live preview can't know which real session is coming — it doesn't need
// to, since the ghost pane never reads session data.
const DROP_PREVIEW_ID = '__drop_preview__';

// How close to the whole pane area's own outer boundary (not any single
// pane's edge zone) counts as "drag to the outer edge" — the even-N-way
// gesture, distinct from a single pane's own irregular-split zone.
const OUTER_EDGE_BAND = 28;
// Extra hit-radius around a divider's thin line, so aiming for it doesn't
// require pixel-perfect precision.
const GAP_HIT_PADDING = 10;

type PaneHover = { kind: 'zone'; targetId: string; zone: DropZone } | { kind: 'gap'; splitPath: string; gapIndex: number } | { kind: 'outerEdge'; edge: OuterEdge };

function DropPreviewGhost({ hover }: { hover: PaneHover }) {
  const label =
    hover.kind === 'zone'
      ? hover.zone === 'center'
        ? 'drop to replace this pane'
        : `drop to split · ${hover.zone}`
      : hover.kind === 'gap'
        ? 'drop to insert here · even split'
        : `drop to add an even ${hover.edge === 'left' || hover.edge === 'right' ? 'column' : 'row'}`;
  return <div className={`pane-drop-preview ${hover.kind === 'zone' && hover.zone === 'center' ? 'pane-drop-preview-center' : ''}`}>{label}</div>;
}

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
  const activePaneSessionId = useViewStore((s) => s.activePaneSessionId);
  const sidebarCollapsed = useViewStore((s) => s.sidebarCollapsed);
  const settingsOpen = useViewStore((s) => s.settingsOpen);
  const focusSession = useViewStore((s) => s.focusSession);
  const addPaneAtZone = useViewStore((s) => s.addPaneAtZone);
  const addPaneAtOuterEdge = useViewStore((s) => s.addPaneAtOuterEdge);
  const addPaneAtGap = useViewStore((s) => s.addPaneAtGap);
  const addPaneToRoot = useViewStore((s) => s.addPaneToRoot);
  const setActivePane = useViewStore((s) => s.setActivePane);
  const removePane = useViewStore((s) => s.removePane);
  const setSidebarCollapsed = useViewStore((s) => s.setSidebarCollapsed);
  const toggleSettings = useViewStore((s) => s.toggleSettings);
  const setSettingsOpen = useViewStore((s) => s.setSettingsOpen);

  const [hover, setHover] = useState<PaneHover | null>(null);
  const leafElsRef = useRef(new Map<string, HTMLElement>());
  const gapElsRef = useRef(new Map<string, HTMLElement>());
  const panesRef = useRef<HTMLDivElement>(null);
  const rectsSnapshotRef = useRef<{ leaves: Map<string, DOMRect>; gaps: Map<string, DOMRect> } | null>(null);
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

  const tree = mode.type === 'panes' ? mode.tree : null;
  const paneSessionIds = paneTreeSessionIds(tree);
  const displayTree =
    tree && hover
      ? hover.kind === 'zone'
        ? insertAtZone(tree, hover.targetId, hover.zone, DROP_PREVIEW_ID)
        : hover.kind === 'gap'
          ? insertAtGap(tree, hover.splitPath, hover.gapIndex, DROP_PREVIEW_ID)
          : insertAtOuterEdge(tree, hover.edge, DROP_PREVIEW_ID)
      : tree;

  const onPanesDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes(SESSION_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    // Snapshot every pane's and divider's rect once per drag gesture, the
    // moment it first hovers the pane area — never re-measure afterward.
    // Once a phantom preview pane is inserted the real DOM shrinks/shifts
    // to make room for it, and measuring against that live (already-
    // distorted) rect would make the hover target flip-flop as the
    // pointer sits still. The snapshot is the ground truth for the whole
    // gesture; only clientX/clientY move. (The outer .panes container's
    // OWN rect doesn't need snapshotting — inserting panes inside it never
    // changes its own outer size, so reading it live is safe.)
    if (!rectsSnapshotRef.current) {
      rectsSnapshotRef.current = {
        leaves: new Map([...leafElsRef.current.entries()].map(([id, el]) => [id, el.getBoundingClientRect()])),
        gaps: new Map([...gapElsRef.current.entries()].map(([key, el]) => [key, el.getBoundingClientRect()])),
      };
    }
    const { leaves, gaps } = rectsSnapshotRef.current;
    const sameHover = (a: PaneHover | null, b: PaneHover): boolean =>
      !!a && a.kind === b.kind && (a.kind === 'zone' && b.kind === 'zone' ? a.targetId === b.targetId && a.zone === b.zone : a.kind === 'gap' && b.kind === 'gap' ? a.splitPath === b.splitPath && a.gapIndex === b.gapIndex : a.kind === 'outerEdge' && b.kind === 'outerEdge' ? a.edge === b.edge : false);
    const set = (next: PaneHover) => setHover((prev) => (sameHover(prev, next) ? prev : next));

    // Priority 1: a divider, hit-tested with generous padding — the most
    // deliberate, precise target, so it wins over the broader zones below.
    const gapHit = [...gaps.entries()].find(
      ([, r]) => event.clientX >= r.left - GAP_HIT_PADDING && event.clientX <= r.right + GAP_HIT_PADDING && event.clientY >= r.top - GAP_HIT_PADDING && event.clientY <= r.bottom + GAP_HIT_PADDING,
    );
    if (gapHit) {
      const [key] = gapHit;
      const sep = key.indexOf(':');
      set({ kind: 'gap', splitPath: key.slice(0, sep), gapIndex: Number(key.slice(sep + 1)) });
      return;
    }

    // Priority 2: the whole pane area's own outer boundary — the even-N-way gesture.
    const panesRect = panesRef.current?.getBoundingClientRect();
    if (panesRect) {
      if (event.clientX <= panesRect.left + OUTER_EDGE_BAND) return set({ kind: 'outerEdge', edge: 'left' });
      if (event.clientX >= panesRect.right - OUTER_EDGE_BAND) return set({ kind: 'outerEdge', edge: 'right' });
      if (event.clientY <= panesRect.top + OUTER_EDGE_BAND) return set({ kind: 'outerEdge', edge: 'top' });
      if (event.clientY >= panesRect.bottom - OUTER_EDGE_BAND) return set({ kind: 'outerEdge', edge: 'bottom' });
    }

    // Priority 3: which individual pane the pointer is over, and where within it.
    const targetEntry = [...leaves.entries()].find(
      ([, rect]) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom,
    );
    if (!targetEntry) {
      setHover(null);
      return;
    }
    const [targetId, rect] = targetEntry;
    const zone = zoneFromPointer((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
    set({ kind: 'zone', targetId, zone });
  };

  const onPanesDragLeave = (event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setHover(null);
      rectsSnapshotRef.current = null;
    }
  };

  const onPanesDrop = (event: DragEvent) => {
    event.preventDefault();
    const sessionId = event.dataTransfer.getData(SESSION_DRAG_MIME);
    const dropHover = hover;
    setHover(null);
    rectsSnapshotRef.current = null;
    if (!sessionId) return;
    if (!dropHover) {
      addPaneToRoot(sessionId);
    } else if (dropHover.kind === 'zone') {
      addPaneAtZone(dropHover.targetId, dropHover.zone, sessionId);
    } else if (dropHover.kind === 'gap') {
      addPaneAtGap(dropHover.splitPath, dropHover.gapIndex, sessionId);
    } else {
      addPaneAtOuterEdge(dropHover.edge, sessionId);
    }
  };

  const registerLeafRef = (sessionId: string, el: HTMLElement | null) => {
    if (sessionId === DROP_PREVIEW_ID) return;
    if (el) leafElsRef.current.set(sessionId, el);
    else leafElsRef.current.delete(sessionId);
  };

  const registerGapRef = (splitPath: string, gapIndex: number, el: HTMLDivElement | null) => {
    const key = `${splitPath}:${gapIndex}`;
    if (el) gapElsRef.current.set(key, el);
    else gapElsRef.current.delete(key);
  };

  const renderLeaf = (sessionId: string) => {
    if (sessionId === DROP_PREVIEW_ID) return hover ? <DropPreviewGhost hover={hover} /> : null;
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return <p className="app-message">That session is gone.</p>;
    return (
      <div className="pane-leaf-inner" onMouseDownCapture={() => setActivePane(sessionId)}>
        <SessionTile
          session={session}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onAddToWorkspace={addSessionToWorkspace}
          onRemoveFromWorkspace={removeSessionFromWorkspace}
          variant="solo"
          onClosePane={paneSessionIds.length > 1 ? () => removePane(sessionId) : undefined}
        />
      </div>
    );
  };

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
          <Sidebar sessions={sessions} focusedSessionId={mode.type === 'panes' ? activePaneSessionId : null} panelRef={sidebarPanelRef} />
        </Panel>

        <Separator className="app-shell-separator" />

        <Panel id="main" minSize={360}>
          <main className="app-main">
            {mode.type === 'grid' && <BulkActionBar />}

            {status === 'loading' && <p className="app-message">connecting…</p>}

            {status === 'linking-required' && <LinkDeviceView />}

            {status === 'error' && <p className="app-message app-message-error">{error}</p>}

            {status === 'ready' && sessions.length === 0 && <p className="app-message">No sessions found.</p>}

            {status === 'ready' && sessions.length > 0 && mode.type === 'panes' && displayTree && (
              <div className="panes" ref={panesRef} onDragOver={onPanesDragOver} onDragLeave={onPanesDragLeave} onDrop={onPanesDrop}>
                <PaneTreeView node={displayTree} renderLeaf={renderLeaf} registerLeafRef={registerLeafRef} registerGapRef={registerGapRef} />
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
        </Panel>
      </Group>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

export default App;
