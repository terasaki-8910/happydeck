import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect } from 'react';
import type { LiveSession } from '../store/happyStore';
import { byRecency } from '../lib/sessionOrder';
import { useViewStore } from '../store/viewStore';

// No repo remote is configured for this project yet — this points at the
// upstream Happy protocol this app talks to. Swap for this project's own
// repo URL once it has one.
const GITHUB_URL = 'https://github.com/slopus/happy';

const NARROW_BREAKPOINT = 640;

function statusClassOf(session: LiveSession): string {
  if (!session.active) return 'status-offline';
  if (session.thinking) return 'status-thinking';
  return 'status-online';
}

interface SidebarProps {
  sessions: LiveSession[];
  focusedSessionId: string | null;
}

export function Sidebar({ sessions, focusedSessionId }: SidebarProps) {
  const collapsed = useViewStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useViewStore((s) => s.setSidebarCollapsed);
  const toggleSidebar = useViewStore((s) => s.toggleSidebar);
  const focusSession = useViewStore((s) => s.focusSession);

  // Auto-collapse only fires at the moment the breakpoint is crossed, so it
  // never fights a manual toggle made while already narrow (or already wide).
  useEffect(() => {
    let wasNarrow = window.innerWidth < NARROW_BREAKPOINT;
    const onResize = () => {
      const isNarrow = window.innerWidth < NARROW_BREAKPOINT;
      if (isNarrow !== wasNarrow) {
        wasNarrow = isNarrow;
        setSidebarCollapsed(isNarrow);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setSidebarCollapsed]);

  const ordered = byRecency(sessions);

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">◆</span>
        {!collapsed && <span className="sidebar-brand-name">happydeck</span>}
        <button
          type="button"
          className="sidebar-collapse-toggle"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={toggleSidebar}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <nav className="sidebar-sessions">
        {ordered.map((session) => {
          const metadata = session.metadata as { path?: string; host?: string } | null;
          const path = metadata?.path ?? session.id;
          const label = session.title ?? path;
          return (
            <button
              key={session.id}
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-happydeck-session-id', session.id);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              className={`sidebar-session ${session.id === focusedSessionId ? 'sidebar-session-active' : ''}`}
              title={collapsed ? label : path}
              onClick={() => focusSession(session.id)}
            >
              <span className={`status-dot ${statusClassOf(session)}`} title={`status: ${statusClassOf(session).replace('status-', '')}`} />
              {!collapsed && (
                <span className="sidebar-session-label">
                  {metadata?.host && <span className="sidebar-session-host">{metadata.host}</span>}
                  <span className="sidebar-session-title">{label}</span>
                </span>
              )}
            </button>
          );
        })}
        {ordered.length === 0 && !collapsed && <p className="sidebar-empty">no sessions</p>}
      </nav>

      <div className="sidebar-footer">
        <button
          type="button"
          className="sidebar-github"
          title="Open the Happy protocol repo on GitHub"
          onClick={() => openUrl(GITHUB_URL)}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
          {!collapsed && <span>GitHub</span>}
        </button>
      </div>
    </aside>
  );
}
