import { type FormEvent, useEffect, useRef, useState } from 'react';
import { FiSend } from 'react-icons/fi';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { downloadTranscript } from '../lib/exportTranscript';
import { messageRole, type RenderablePart, renderablePart } from '../lib/formatMessage';
import { type TranslationKey, useT } from '../lib/i18n';
import { deriveTitle } from '../lib/sessionTitle';
import { type AgentState, type LiveSession, useHappyStore } from '../store/happyStore';
import { useSelectionStore } from '../store/selectionStore';
import type { Workspace } from '../store/workspaceStore';
import { AgentSettingsPopover } from './AgentSettingsPopover';
import { ComposerPlusMenu } from './ComposerPlusMenu';
import { TileActionsMenu } from './TileActionsMenu';

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

function statusOf(session: LiveSession): { labelKey: TranslationKey; className: string } {
  if (!session.active) {
    return { labelKey: 'statusOffline', className: 'status-offline' };
  }
  if (session.thinking) {
    return { labelKey: 'statusThinking', className: 'status-thinking' };
  }
  return { labelKey: 'statusOnline', className: 'status-online' };
}

/** A tool-call line collapses to just its label by default — text is the point, tool activity is secondary. */
function ToolCallLine({ part }: { part: Extract<RenderablePart, { kind: 'tool-call' }> }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = Boolean(part.detail || part.description);

  return (
    <div className={`tile-message tile-tool-call ${expanded ? 'tile-tool-call-expanded' : ''}`}>
      <button
        type="button"
        className="tile-tool-call-toggle"
        onClick={() => setExpanded((v) => !v)}
        disabled={!hasMore}
        title={hasMore ? (expanded ? 'Collapse' : 'Expand') : undefined}
      >
        {hasMore && <span className="tile-tool-call-caret">{expanded ? '▾' : '▸'}</span>}
        <span className="tile-tool-call-label">{part.label}</span>
      </button>
      {expanded && (
        <div className="tile-tool-call-body">
          {part.detail && <div className="tile-tool-call-detail">{part.detail}</div>}
          {part.description && <div className="tile-tool-call-description">{part.description}</div>}
        </div>
      )}
    </div>
  );
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
  const t = useT();
  const localMachineId = useHappyStore((s) => s.localMachineId);
  const sendMessage = useHappyStore((s) => s.sendMessage);
  const setAgentModes = useHappyStore((s) => s.setAgentModes);
  const renameSession = useHappyStore((s) => s.renameSession);
  const allowRequest = useHappyStore((s) => s.allowRequest);
  const denyRequest = useHappyStore((s) => s.denyRequest);
  const abortSession = useHappyStore((s) => s.abortSession);
  const killSession = useHappyStore((s) => s.killSession);
  const isSelected = useSelectionStore((s) => s.selected.has(session.id));
  const toggleSelected = useSelectionStore((s) => s.toggle);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const status = statusOf(session);
  const metadata = session.metadata as
    | {
        path?: string;
        host?: string;
        machineId?: string;
        permissionMode?: string;
        modelMode?: string;
        effortLevel?: string;
        slashCommands?: string[];
        mcpServers?: { name: string; status: string }[];
      }
    | null;
  const path = metadata?.path ?? session.id;
  const title = deriveTitle(session.metadata, session.messages) ?? path;
  // Opening a real Terminal/iTerm window only makes sense for a path that
  // exists on this machine — a remote session's path lives on its own box.
  const localPath = metadata?.path && metadata.machineId === localMachineId ? metadata.path : undefined;
  const agentState = session.agentState as AgentState | null;
  const pendingRequests = Object.entries(agentState?.requests ?? {});
  const visibleMessages = session.messages
    .map((message) => ({ message, part: renderablePart(message.content) }))
    .filter((entry) => entry.part !== null) as { message: (typeof session.messages)[number]; part: RenderablePart }[];

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

  const submitTitleRename = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== title) {
      runAction(() => renameSession(session.id, trimmed)).then(() => setRenamingTitle(false));
    } else {
      setRenamingTitle(false);
    }
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
        <span className={`status-dot ${status.className}`} title={t(status.labelKey)} />
        {metadata?.host && <span className="tile-host">{metadata.host}</span>}
        {renamingTitle ? (
          <form className="tile-title-rename" onSubmit={submitTitleRename}>
            <input
              autoFocus
              value={titleDraft}
              disabled={busy}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={submitTitleRename}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRenamingTitle(false);
              }}
            />
          </form>
        ) : (
          <span
            className="tile-title"
            title={`${path} (click to rename)`}
            onClick={() => {
              setTitleDraft(title);
              setRenamingTitle(true);
            }}
          >
            {title}
          </span>
        )}
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
        <TileActionsMenu
          title={title}
          busy={busy}
          onAbort={() => runAction(() => abortSession(session.id))}
          onDownload={() => runAction(() => downloadTranscript(session))}
          onKill={() => runAction(() => killSession(session.id))}
          localPath={localPath}
        />
      </header>

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
        {visibleMessages.length === 0 && <p className="tile-empty">{t('noMessages')}</p>}
        {visibleMessages.map(({ message, part }) => {
          const role = messageRole(message.content);
          return (
            <div key={message.id} className={`message-row role-${role}`}>
              {part.kind === 'text' ? (
                <div className="tile-message tile-message-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                </div>
              ) : part.kind === 'tool-call' ? (
                <ToolCallLine part={part} />
              ) : part.kind === 'file' ? (
                <p className="tile-message tile-message-code">[file] {part.name}</p>
              ) : (
                <p className="tile-message">{part.text}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="tile-bottom-bar">
        <AgentSettingsPopover
          permissionMode={metadata?.permissionMode ?? 'default'}
          modelMode={metadata?.modelMode ?? 'default'}
          effortLevel={metadata?.effortLevel ?? 'medium'}
          busy={busy}
          onChange={(patch) => runAction(() => setAgentModes(session.id, patch))}
        />
        <form className="tile-composer" onSubmit={handleSend}>
          <ComposerPlusMenu
            slashCommands={metadata?.slashCommands ?? []}
            mcpServers={metadata?.mcpServers ?? []}
            onInsertSlashCommand={(command) => setDraft((d) => `${d}/${command} `)}
          />
          <input
            className="tile-composer-input"
            value={draft}
            disabled={busy}
            placeholder={t('messagePlaceholder')}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="tile-composer-send" disabled={busy || !draft.trim()} title={t('send')} aria-label={t('send')}>
            <FiSend size={17} strokeWidth={2.25} />
          </button>
        </form>
      </div>
    </section>
  );
}
