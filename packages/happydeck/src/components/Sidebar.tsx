import { openUrl } from '@tauri-apps/plugin-opener';
import { type RefObject, useEffect, useRef } from 'react';
import { LuPin } from 'react-icons/lu';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import happydeckMarkDark from '../assets/happydeck-mark.svg';
import happydeckMarkLight from '../assets/happydeck-mark-light.svg';
import { type LiveSession, useHappyStore } from '../store/happyStore';
import { SESSION_DRAG_MIME } from '../lib/dnd';
import { downloadTranscript } from '../lib/exportTranscript';
import { messageRole, renderablePart } from '../lib/formatMessage';
import { useT } from '../lib/i18n';
import { resolveOpenTerminalAction } from '../lib/openTerminal';
import { basename } from '../lib/paths';
import { byRecency } from '../lib/sessionOrder';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { deriveTitle } from '../lib/sessionTitle';
import { useEffectiveTheme } from '../lib/useEffectiveTheme';
import { usePinStore } from '../store/pinStore';
import { useSettingsStore } from '../store/settingsStore';
import { useViewStore } from '../store/viewStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { SessionMenu, type SessionMenuHandle } from './SessionMenu';
import { SpawnPanel } from './SpawnPanel';
import { TabBar } from './TabBar';

function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M6.4 1.2h3.2l.4 1.87c.4.15.78.35 1.13.58l1.8-.62 1.6 2.77-1.44 1.24c.03.2.05.4.05.6s-.02.4-.05.6l1.44 1.24-1.6 2.77-1.8-.62c-.35.23-.73.43-1.13.58l-.4 1.87H6.4l-.4-1.87a5.6 5.6 0 0 1-1.13-.58l-1.8.62-1.6-2.77 1.44-1.24A5.1 5.1 0 0 1 2.86 8c0-.2.02-.4.05-.6L1.47 6.16l1.6-2.77 1.8.62c.35-.23.73-.43 1.13-.58L6.4 1.2ZM8 10.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z" />
    </svg>
  );
}

const GITHUB_URL = 'https://github.com/terasaki-8910/happydeck';

const NARROW_BREAKPOINT = 640;

function statusClassOf(session: LiveSession): string {
  if (!session.active) return 'status-offline';
  if (session.thinking) return 'status-thinking';
  return 'status-online';
}

/**
 * The sidebar's second line: the agent's own most recent reply, so "what is
 * this session actually doing right now" is visible at a glance without
 * opening it or sending anything — purely reads data already fetched for
 * the transcript. Falls back to the working directory when no agent text
 * exists yet (a brand-new session).
 *
 * There was briefly a button here that PUSHED a "summarize your progress"
 * prompt into every online session on demand — removed. It clobbered text
 * the user was actively typing directly into a session's own terminal at
 * the time, because sending a message to a live CLI process races with
 * local keyboard input on the same stdin. Real work was lost. Don't rebuild
 * this as "send a live message" again — read-only derivation from already-
 * fetched messages (like this function does) is the safe shape; a future
 * version should summarize a downloaded transcript instead, never inject
 * anything into a running session.
 */
// Combined "host: title" is one line now (was host above, title below), so
// a long default mDNS hostname (MacBook-Air.local) was eating most of the
// row's width before the title even started — ".local" carries no
// information worth that space.
function shortHost(host: string): string {
  return host.replace(/\.local$/i, '');
}

function deriveStatusLine(session: LiveSession, path: string): string {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i];
    if (messageRole(message.content) !== 'agent') continue;
    const part = renderablePart(message.content);
    if (part?.kind === 'text') {
      const oneLine = part.text.trim().replace(/\s+/g, ' ');
      return oneLine.length > 90 ? `${oneLine.slice(0, 90)}…` : oneLine;
    }
  }
  return path;
}

interface SessionRowProps {
  session: LiveSession;
  collapsed: boolean;
  active: boolean;
}

function SessionRow({ session, collapsed, active }: SessionRowProps) {
  const focusSession = useViewStore((s) => s.focusSession);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const addSessionToWorkspace = useWorkspaceStore((s) => s.addSessionToWorkspace);
  const pinned = usePinStore((s) => s.isPinned(session.id));
  const togglePin = usePinStore((s) => s.togglePin);
  const renameSession = useHappyStore((s) => s.renameSession);
  const deleteSession = useHappyStore((s) => s.deleteSession);
  const resumeSession = useHappyStore((s) => s.resumeSession);
  const abortSession = useHappyStore((s) => s.abortSession);
  const killSession = useHappyStore((s) => s.killSession);
  const localMachineId = useHappyStore((s) => s.localMachineId);
  const machines = useHappyStore((s) => s.machines);
  const runMachineBash = useHappyStore((s) => s.runMachineBash);
  const terminalApp = useSettingsStore((s) => s.terminalApp);
  const terminalWindowMode = useSettingsStore((s) => s.terminalWindowMode);
  const sshTargets = useSettingsStore((s) => s.sshTargets);
  const language = useSettingsStore((s) => s.language);
  const menuRef = useRef<SessionMenuHandle>(null);

  const metadata = session.metadata as { path?: string; host?: string; machineId?: string } | null;
  const path = metadata?.path ?? session.id;
  // The sidebar row is narrow — the full absolute path was just getting
  // arbitrarily cut off by the ellipsis anyway. The last segment is the
  // meaningful part (the project/directory name); the full path is still
  // available in the row's own title tooltip.
  const label = deriveTitle(session.metadata, session.messages) ?? basename(path);
  const statusLine = deriveStatusLine(session, basename(path));
  const openTerminalAction = resolveOpenTerminalAction(metadata, {
    localMachineId,
    machines,
    terminalApp,
    terminalWindowMode,
    sshTargets,
    runMachineBash,
    language,
  });

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(SESSION_DRAG_MIME, session.id);
        event.dataTransfer.effectAllowed = 'copy';
      }}
      className={`sidebar-session ${active ? 'sidebar-session-active' : ''}`}
      title={collapsed ? label : `${path}\n\n${statusLine}`}
      onClick={() => focusSession(session.id)}
      onContextMenu={(event) => {
        if (collapsed) return;
        event.preventDefault();
        menuRef.current?.openAt({ x: event.clientX, y: event.clientY });
      }}
    >
      <span className={`status-dot ${statusClassOf(session)}`} title={`status: ${statusClassOf(session).replace('status-', '')}`} />
      {!collapsed && (
        <span className="sidebar-session-label">
          <span className="sidebar-session-title-row">
            <span className="sidebar-session-title">{label}</span>
            {metadata?.host && <span className="sidebar-session-host">{shortHost(metadata.host)}</span>}
          </span>
          <span className="sidebar-session-status">{statusLine}</span>
        </span>
      )}
      {!collapsed && (
        <SessionMenu
          ref={menuRef}
          session={session}
          title={label}
          pinned={pinned}
          workspaces={workspaces}
          onTogglePin={() => togglePin(session.id)}
          onAddToWorkspace={(workspaceId) => addSessionToWorkspace(workspaceId, session.id)}
          onRename={(title) => renameSession(session.id, title)}
          onDelete={() => deleteSession(session.id)}
          onResume={() => resumeSession(session.id)}
          onAbort={() => abortSession(session.id)}
          onDownload={() => downloadTranscript(session)}
          onKill={() => killSession(session.id)}
          onOpenTerminal={openTerminalAction}
        />
      )}
    </div>
  );
}

interface SidebarProps {
  sessions: LiveSession[];
  focusedSessionId: string | null;
  /**
   * Owned by App.tsx, which renders the actual <Panel> wrapping this
   * component — Group/Panel/Separator from react-resizable-panels only
   * recognize Panel/Separator as DIRECT JSX children, so the Panel can't
   * live inside this component (it would be invisible to the parent
   * Group's layout algorithm and break sizing for every other panel).
   */
  panelRef: RefObject<PanelImperativeHandle | null>;
}

export function Sidebar({ sessions, focusedSessionId, panelRef }: SidebarProps) {
  const t = useT();
  const collapsed = useViewStore((s) => s.sidebarCollapsed);
  const setSettingsOpen = useViewStore((s) => s.setSettingsOpen);
  const pinnedIds = usePinStore((s) => s.pinnedIds);
  const localMachineId = useHappyStore((s) => s.localMachineId);
  const machines = useHappyStore((s) => s.machines);
  const localHost = (machines.find((m) => m.id === localMachineId)?.metadata as { host?: string } | null)?.host;
  const effectiveTheme = useEffectiveTheme();
  const brandMark = effectiveTheme === 'light' ? happydeckMarkLight : happydeckMarkDark;

  // Auto-collapse only fires at the moment the breakpoint is crossed, so it
  // never fights a manual toggle (or a manual drag-resize) made while
  // already narrow (or already wide).
  useEffect(() => {
    let wasNarrow = window.innerWidth < NARROW_BREAKPOINT;
    const onResize = () => {
      const isNarrow = window.innerWidth < NARROW_BREAKPOINT;
      if (isNarrow !== wasNarrow) {
        wasNarrow = isNarrow;
        if (isNarrow) panelRef.current?.collapse();
        else panelRef.current?.expand();
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [panelRef]);

  // Right after connecting, catch-up live-update events for several
  // sessions can land within milliseconds of each other, each one
  // re-sorting the list — visibly shuffling rows around before things
  // settle. Debouncing the ORDER (not the row content, which stays live)
  // smooths that into one settled arrangement. Adding/removing a session
  // still shows immediately — only pure reordering among the same set of
  // sessions gets smoothed, so a brand new session is never delayed or a
  // deleted one left showing.
  const liveOrdered = byRecency(sessions);
  const liveKey = liveOrdered.map((s) => s.id).join(',');
  const debouncedKey = useDebouncedValue(liveKey, 500);
  const liveSetKey = [...liveOrdered.map((s) => s.id)].sort().join(',');
  const debouncedSetKey = [...debouncedKey.split(',')].filter(Boolean).sort().join(',');
  const orderedIds = liveSetKey === debouncedSetKey ? debouncedKey.split(',').filter(Boolean) : liveOrdered.map((s) => s.id);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const ordered = orderedIds.map((id) => sessionById.get(id)).filter((s): s is LiveSession => s !== undefined);
  const pinnedSet = new Set(pinnedIds);
  const pinned = ordered.filter((s) => pinnedSet.has(s.id));
  const rest = ordered.filter((s) => !pinnedSet.has(s.id));

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-brand">
        <img className="sidebar-brand-mark" src={brandMark} alt="" />
        {!collapsed && <span className="sidebar-brand-name">happydeck</span>}
      </div>

      {!collapsed && (
        <div className="sidebar-spawn">
          <SpawnPanel />
        </div>
      )}

      {!collapsed && (
        <div className="sidebar-tabs">
          <span className="sidebar-section-label">{t('workspaces')}</span>
          <TabBar />
        </div>
      )}

      <nav className="sidebar-sessions">
        {pinned.length > 0 && (
          <>
            {!collapsed && (
              <span className="sidebar-section-label sidebar-section-label-inline">
                <LuPin size={10} strokeWidth={2.5} />
                {t('pinned')}
              </span>
            )}
            {pinned.map((session) => (
              <SessionRow key={session.id} session={session} collapsed={collapsed} active={session.id === focusedSessionId} />
            ))}
            <div className="sidebar-divider" />
            {!collapsed && rest.length > 0 && <span className="sidebar-section-label sidebar-section-label-inline">{t('chats')}</span>}
          </>
        )}
        {rest.map((session) => (
          <SessionRow key={session.id} session={session} collapsed={collapsed} active={session.id === focusedSessionId} />
        ))}
        {ordered.length === 0 && !collapsed && <p className="sidebar-empty">{t('noSessions')}</p>}
      </nav>

      {!collapsed && (
        <div className="sidebar-footer">
          {localHost && (
            <span className="sidebar-local-device" title={localHost}>
              {localHost}
            </span>
          )}
          <button type="button" className="sidebar-footer-icon" title={`${t('settings')} (⌘,)`} onClick={() => setSettingsOpen(true)}>
            <GearIcon />
          </button>
          <button
            type="button"
            className="sidebar-footer-icon"
            title={t('openOnGithub')}
            onClick={() => openUrl(GITHUB_URL)}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </button>
        </div>
      )}
    </aside>
  );
}
