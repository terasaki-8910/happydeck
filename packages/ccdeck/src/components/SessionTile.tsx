import { type FormEvent, useState } from 'react';
import { CLAUDE_EFFORT_LEVELS, CLAUDE_MODEL_MODES, CLAUDE_PERMISSION_MODES } from '../lib/agentOptions';
import { messageRole, summarizeMessageContent } from '../lib/formatMessage';
import { type AgentState, type LiveSession, useHappyStore } from '../store/happyStore';
import { useSelectionStore } from '../store/selectionStore';
import type { Workspace } from '../store/workspaceStore';

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
  const sendMessage = useHappyStore((s) => s.sendMessage);
  const setAgentModes = useHappyStore((s) => s.setAgentModes);
  const allowRequest = useHappyStore((s) => s.allowRequest);
  const denyRequest = useHappyStore((s) => s.denyRequest);
  const abortSession = useHappyStore((s) => s.abortSession);
  const killSession = useHappyStore((s) => s.killSession);
  const isSelected = useSelectionStore((s) => s.selected.has(session.id));
  const toggleSelected = useSelectionStore((s) => s.toggle);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const status = statusOf(session);
  const metadata = session.metadata as { path?: string; host?: string; permissionMode?: string; modelMode?: string; effortLevel?: string } | null;
  const path = metadata?.path ?? session.id;
  const agentState = session.agentState as AgentState | null;
  const pendingRequests = Object.entries(agentState?.requests ?? {});

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleSend = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    runAction(() => sendMessage(session.id, text));
  };

  const handleKill = () => {
    if (!window.confirm(`Kill this session's process? This cannot be undone.\n\n${path}`)) {
      return;
    }
    runAction(() => killSession(session.id));
  };

  return (
    <section className={`tile ${isSelected ? 'tile-selected' : ''}`}>
      <header className="tile-header">
        <input
          type="checkbox"
          className="tile-select"
          checked={isSelected}
          onChange={() => toggleSelected(session.id)}
          title="Select for bulk actions"
        />
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

      <div className="tile-controls">
        <select
          value={metadata?.permissionMode ?? 'default'}
          disabled={busy}
          onChange={(event) => runAction(() => setAgentModes(session.id, { permissionMode: event.target.value }))}
        >
          {CLAUDE_PERMISSION_MODES.map((mode) => (
            <option key={mode.key} value={mode.key}>
              {mode.name}
            </option>
          ))}
        </select>
        <select
          value={metadata?.modelMode ?? 'default'}
          disabled={busy}
          onChange={(event) => runAction(() => setAgentModes(session.id, { modelMode: event.target.value }))}
        >
          {CLAUDE_MODEL_MODES.map((model) => (
            <option key={model.key} value={model.key}>
              {model.name}
            </option>
          ))}
        </select>
        <select
          value={metadata?.effortLevel ?? 'medium'}
          disabled={busy}
          onChange={(event) => runAction(() => setAgentModes(session.id, { effortLevel: event.target.value }))}
        >
          {CLAUDE_EFFORT_LEVELS.map((effort) => (
            <option key={effort.key} value={effort.key}>
              {effort.name}
            </option>
          ))}
        </select>
        <button type="button" disabled={busy} onClick={() => runAction(() => abortSession(session.id))}>
          abort
        </button>
        <button type="button" className="tile-kill" disabled={busy} onClick={handleKill}>
          kill
        </button>
      </div>

      {pendingRequests.length > 0 && (
        <div className="tile-permissions">
          {pendingRequests.map(([id, request]) => (
            <div key={id} className="permission-request">
              <span className="permission-tool">{request.tool}</span>
              <button type="button" disabled={busy} onClick={() => runAction(() => allowRequest(session.id, id))}>
                allow
              </button>
              <button type="button" disabled={busy} onClick={() => runAction(() => denyRequest(session.id, id))}>
                deny
              </button>
            </div>
          ))}
        </div>
      )}

      {actionError && <p className="tile-action-error">{actionError}</p>}

      <div className="tile-messages">
        {session.messages.length === 0 && <p className="tile-empty">(no messages)</p>}
        {session.messages.map((message) => (
          <p key={message.id} className={`tile-message role-${messageRole(message.content)}`}>
            {summarizeMessageContent(message.content)}
          </p>
        ))}
      </div>

      <form className="tile-composer" onSubmit={handleSend}>
        <input
          className="tile-composer-input"
          value={draft}
          disabled={busy}
          placeholder="message this session…"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          send
        </button>
      </form>
    </section>
  );
}
