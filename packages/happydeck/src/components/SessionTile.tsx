import { type FormEvent, useEffect, useRef, useState } from 'react';
import { CLAUDE_EFFORT_LEVELS, CLAUDE_MODEL_MODES, CLAUDE_PERMISSION_MODES } from '../lib/agentOptions';
import { downloadTranscript } from '../lib/exportTranscript';
import { isCodeLikeMessage, isRenderableMessage, messageRole, summarizeMessageContent } from '../lib/formatMessage';
import { deriveTitle } from '../lib/sessionTitle';
import { type AgentState, type LiveSession, useHappyStore } from '../store/happyStore';
import { useSelectionStore } from '../store/selectionStore';
import type { Workspace } from '../store/workspaceStore';
import { ConfirmDialog } from './ConfirmDialog';

interface SessionTileProps {
  session: LiveSession;
  workspaces: Workspace[];
  /** null when viewing "All" — every session is shown and can be assigned to a workspace. */
  activeWorkspaceId: string | null;
  onAddToWorkspace: (workspaceId: string, sessionId: string) => void;
  onRemoveFromWorkspace: (workspaceId: string, sessionId: string) => void;
  /** 'solo' renders larger, as one of the focused panes (see App.tsx / Sidebar.tsx). Defaults to 'grid'. */
  variant?: 'grid' | 'solo';
  /** When set, shows a close button for this pane (multi-pane view only — a single pane is closed by navigating away instead). */
  onClosePane?: () => void;
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

export function SessionTile({
  session,
  workspaces,
  activeWorkspaceId,
  onAddToWorkspace,
  onRemoveFromWorkspace,
  variant = 'grid',
  onClosePane,
}: SessionTileProps) {
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
  const [confirmingKill, setConfirmingKill] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const status = statusOf(session);
  const metadata = session.metadata as { path?: string; host?: string; permissionMode?: string; modelMode?: string; effortLevel?: string } | null;
  const path = metadata?.path ?? session.id;
  const title = deriveTitle(session.metadata, session.messages) ?? path;
  const agentState = session.agentState as AgentState | null;
  const pendingRequests = Object.entries(agentState?.requests ?? {});
  const visibleMessages = session.messages.filter((m) => isRenderableMessage(m.content));

  // Follow new output as it streams in, but only if the user hasn't scrolled
  // up to read history — never yank them back down mid-read. isNearBottomRef
  // reflects scroll position as of BEFORE this update (kept live by
  // onScroll below), not the post-append state.
  useEffect(() => {
    const el = messagesRef.current;
    if (el && isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleMessages.length]);

  const handleMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

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

  const handleKillConfirmed = () => {
    setConfirmingKill(false);
    runAction(() => killSession(session.id));
  };

  return (
    <section className={`tile tile-${variant} ${isSelected ? 'tile-selected' : ''}`}>
      <header className="tile-header">
        {variant === 'grid' && (
          <input
            type="checkbox"
            className="tile-select"
            checked={isSelected}
            onChange={() => toggleSelected(session.id)}
            title="Select for bulk actions"
          />
        )}
        <span className={`status-dot ${status.className}`} title={`status: ${status.label}`} />
        {metadata?.host && <span className="tile-host">{metadata.host}</span>}
        <span className="tile-title" title={path}>
          {title}
        </span>
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
        {onClosePane && (
          <button type="button" className="tile-pane-close" title="Close this pane" onClick={onClosePane}>
            ×
          </button>
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
        <button
          type="button"
          disabled={busy}
          title="Download this session's transcript as a text file"
          onClick={() => runAction(() => downloadTranscript(session))}
        >
          download
        </button>
        <button
          type="button"
          disabled={busy}
          title="Stop the current tool use and have the agent wait for you — the session process keeps running."
          onClick={() => runAction(() => abortSession(session.id))}
        >
          abort
        </button>
        <button
          type="button"
          className="tile-kill"
          disabled={busy}
          title="Kill the session's CLI process immediately — irreversible, not just an interrupt."
          onClick={() => setConfirmingKill(true)}
        >
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

      <div className="tile-messages" ref={messagesRef} onScroll={handleMessagesScroll}>
        {visibleMessages.length === 0 && <p className="tile-empty">(no messages)</p>}
        {visibleMessages.map((message) => {
          const role = messageRole(message.content);
          return (
            <div key={message.id} className={`message-row role-${role}`}>
              <p className={`tile-message ${isCodeLikeMessage(message.content) ? 'tile-message-code' : ''}`}>
                {summarizeMessageContent(message.content)}
              </p>
            </div>
          );
        })}
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

      {confirmingKill && (
        <ConfirmDialog
          title="Kill this session?"
          body={`This immediately terminates the CLI process on the machine it's running on — not an interrupt, the process is gone. Cannot be undone.\n\n${title}`}
          confirmLabel="kill process"
          danger
          onConfirm={handleKillConfirmed}
          onCancel={() => setConfirmingKill(false)}
        />
      )}
    </section>
  );
}
