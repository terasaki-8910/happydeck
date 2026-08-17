import type { LiveSession } from '../store/happyStore';
import type { Workspace } from '../store/workspaceStore';
import { messageRole, summarizeMessageContent } from '../lib/formatMessage';

interface SessionTileProps {
  session: LiveSession;
  workspaces: Workspace[];
  /** null when viewing "All" — every session is shown and can be assigned to a workspace. */
  activeWorkspaceId: string | null;
  onAddToWorkspace: (workspaceId: string, sessionId: string) => void;
  onRemoveFromWorkspace: (workspaceId: string, sessionId: string) => void;
}

function statusOf(session: LiveSession): { label: string; className: string } {
  if (!session.active) {
    return { label: 'offline', className: 'status-offline' };
  }
  if (session.thinking) {
    return { label: 'thinking', className: 'status-thinking' };
  }
  return { label: 'online', className: 'status-online' };
}

export function SessionTile({ session, workspaces, activeWorkspaceId, onAddToWorkspace, onRemoveFromWorkspace }: SessionTileProps) {
  const status = statusOf(session);
  const metadata = session.metadata as { path?: string; host?: string } | null;
  const path = metadata?.path ?? session.id;

  return (
    <section className="tile">
      <header className="tile-header">
        <span className={`status-dot ${status.className}`} />
        {metadata?.host && <span className="tile-host">{metadata.host}</span>}
        <span className="tile-path" title={path}>
          {path}
        </span>
        <span className="tile-status-label">{status.label}</span>
        {activeWorkspaceId ? (
          <button
            type="button"
            className="tile-workspace-remove"
            title="Remove from this tab"
            onClick={() => onRemoveFromWorkspace(activeWorkspaceId, session.id)}
          >
            ×
          </button>
        ) : (
          workspaces.length > 0 && (
            <select
              className="tile-workspace-add"
              value=""
              onChange={(event) => {
                if (event.target.value) {
                  onAddToWorkspace(event.target.value, session.id);
                }
              }}
            >
              <option value="" disabled>
                + add to tab
              </option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          )
        )}
      </header>
      <div className="tile-messages">
        {session.messages.length === 0 && <p className="tile-empty">(no messages)</p>}
        {session.messages.map((message) => (
          <p key={message.id} className={`tile-message role-${messageRole(message.content)}`}>
            {summarizeMessageContent(message.content)}
          </p>
        ))}
      </div>
    </section>
  );
}
