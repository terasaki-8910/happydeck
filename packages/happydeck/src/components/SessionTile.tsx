import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LuLoaderCircle, LuSendHorizontal } from 'react-icons/lu';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildAttachmentDir, buildAttachmentPath, extensionForMimeType, relativeAttachmentPath } from '../lib/attachments';
import { writeAttachmentFile } from '../lib/chunkedFileWrite';
import { downloadTranscript } from '../lib/exportTranscript';
import { attachDisconnectedError, cwdNotKnownError, unknownAttachMachineError } from '../lib/errorMessages';
import { messageRole, type RenderablePart, renderablePart } from '../lib/formatMessage';
import { type TranslationKey, useT } from '../lib/i18n';
import { resolveOpenTerminalAction } from '../lib/openTerminal';
import { explainResumeError } from '../lib/resumeError';
import { deriveTitle } from '../lib/sessionTitle';
import { useUndoableState } from '../lib/useUndoableState';
import { type AgentState, type LiveSession, useHappyStore } from '../store/happyStore';
import { useSelectionStore } from '../store/selectionStore';
import { useSettingsStore } from '../store/settingsStore';
import type { Workspace } from '../store/workspaceStore';
import { AgentSettingsCaption, AgentSettingsPopover } from './AgentSettingsPopover';
import { AskUserQuestionCard, type AskUserQuestionQuestion } from './AskUserQuestionCard';
import { ComposerPlusMenu } from './ComposerPlusMenu';
import { SlashCommandAutocomplete } from './SlashCommandAutocomplete';
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
  const language = useSettingsStore((s) => s.language);
  const localMachineId = useHappyStore((s) => s.localMachineId);
  const machines = useHappyStore((s) => s.machines);
  const sendMessage = useHappyStore((s) => s.sendMessage);
  const setAgentModes = useHappyStore((s) => s.setAgentModes);
  const renameSession = useHappyStore((s) => s.renameSession);
  const allowRequest = useHappyStore((s) => s.allowRequest);
  const denyRequest = useHappyStore((s) => s.denyRequest);
  const abortSession = useHappyStore((s) => s.abortSession);
  const resumeSession = useHappyStore((s) => s.resumeSession);
  const loadOlderMessages = useHappyStore((s) => s.loadOlderMessages);
  const killSession = useHappyStore((s) => s.killSession);
  const createMachineDirectory = useHappyStore((s) => s.createMachineDirectory);
  const writeMachineBinaryFile = useHappyStore((s) => s.writeMachineBinaryFile);
  const isSelected = useSelectionStore((s) => s.selected.has(session.id));
  const toggleSelected = useSelectionStore((s) => s.toggle);
  const terminalApp = useSettingsStore((s) => s.terminalApp);
  const terminalWindowMode = useSettingsStore((s) => s.terminalWindowMode);
  const sshTargets = useSettingsStore((s) => s.sshTargets);
  const runMachineBash = useHappyStore((s) => s.runMachineBash);

  const { value: draft, set: setDraft, reset: resetDraft, undo: undoDraft, redo: redoDraft } = useUndoableState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [slashHighlight, setSlashHighlight] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const pendingOlderLoadScrollHeightRef = useRef<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  // "Open in Terminal" is local-only when the session's machine IS this
  // machine; otherwise it SSHes out to that machine (see openTerminal.ts) —
  // still shown, not hidden, when no SSH target is configured yet, so the
  // menu item stays discoverable and the error names the fix (Settings).
  const openTerminalAction = resolveOpenTerminalAction(metadata ?? null, {
    localMachineId,
    machines,
    terminalApp,
    terminalWindowMode,
    sshTargets,
    runMachineBash,
    language,
  });
  const agentState = session.agentState as AgentState | null;
  const pendingRequests = Object.entries(agentState?.requests ?? {});
  const visibleMessages = session.messages
    .map((message) => ({ message, part: renderablePart(message.content) }))
    .filter((entry) => entry.part !== null) as { message: (typeof session.messages)[number]; part: RenderablePart }[];

  // Follow new output as it streams in, but only if the user hasn't scrolled
  // up to read history — never yank them back down mid-read. isNearBottomRef
  // reflects scroll position as of BEFORE this update (kept live by
  // onScroll below), not the post-append state. useLayoutEffect (not
  // useEffect) so this runs before paint — a plain useEffect fires AFTER
  // the browser has already shown the frame, so opening a session visibly
  // flashed at the top and then jumped to the bottom instead of just
  // appearing there.
  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (el && isNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [visibleMessages.length]);

  // Prepending older messages grows the content ABOVE the current scroll
  // position — without this, the browser leaves scrollTop's pixel value
  // unchanged, which visually jumps the reader to different content
  // (everything they were looking at shifts down by the height of what
  // just got inserted above it). Runs before paint so there's no visible
  // flash of the wrong scroll position.
  useLayoutEffect(() => {
    const el = messagesRef.current;
    const prevHeight = pendingOlderLoadScrollHeightRef.current;
    if (el && prevHeight !== null) {
      el.scrollTop += el.scrollHeight - prevHeight;
      pendingOlderLoadScrollHeightRef.current = null;
    }
  }, [visibleMessages.length]);

  const handleLoadOlder = async () => {
    const el = messagesRef.current;
    pendingOlderLoadScrollHeightRef.current = el?.scrollHeight ?? null;
    setLoadingOlder(true);
    try {
      await loadOlderMessages(session.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Grows the composer with the draft's content (multi-line pasted/typed
  // text), capped by max-height in CSS where it starts scrolling internally
  // instead of pushing the rest of the tile around indefinitely.
  useEffect(() => {
    const el = composerInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  // A pane created via drag-split can run the effect above while
  // react-resizable-panels is still mid-transition sizing the new split —
  // scrollHeight gets measured against a transient width, baking in a
  // wrong height that then never self-corrects for an empty composer,
  // since draft never changes again to re-trigger the effect. Confirmed
  // live: an empty textarea in a freshly-split pane stuck at max-height
  // instead of collapsing to its single-line minimum. Re-fit whenever the
  // element's own box actually resizes, independent of draft.
  useEffect(() => {
    const el = composerInputRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  const submitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    resetDraft('');
    runAction(() => sendMessage(session.id, text));
  };

  // Writes straight to the session's own machine via the machine-scoped
  // file RPC (works cross-machine over Happy's relay already — no SSH
  // needed) instead of Happy's own E2E-encrypted blob-upload protocol,
  // whose reference implementation isn't available in this repo. One
  // fresh `.claude/happy-<timestamp>/` directory per attach action, so a
  // file-picker batch and a later paste never collide.
  const attachFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (!metadata?.path || !metadata.machineId) throw new Error(cwdNotKnownError(language));
    const cwd = metadata.path;
    const machineId = metadata.machineId;
    const targetMachine = machines.find((m) => m.id === machineId);
    const platform = (targetMachine?.metadata as { platform?: string } | null)?.platform;
    if (!platform) throw new Error(unknownAttachMachineError(language, metadata.host ?? machineId));

    setAttaching(true);
    try {
      const attachDir = buildAttachmentDir(cwd, Date.now());
      const mkdirResult = await createMachineDirectory(machineId, attachDir, platform);
      if (!mkdirResult.success) throw new Error(mkdirResult.error);

      const relativePaths: string[] = [];
      for (const [index, file] of files.entries()) {
        const fileName = file.name || `pasted-${index + 1}.${extensionForMimeType(file.type)}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        await writeAttachmentFile(runMachineBash, writeMachineBinaryFile, machineId, platform, buildAttachmentPath(attachDir, fileName), bytes);
        relativePaths.push(relativeAttachmentPath(cwd, attachDir, fileName));
      }

      setDraft((prev) => `${prev}${relativePaths.map((p) => `[Attached file: ${p}]`).join(' ')} `, { coalesce: false });
    } catch (error) {
      // Already retried transparently a couple of times if the connection
      // to that machine merely blipped mid-call (see withDisconnectRetry) —
      // reaching here means it stayed down longer than that, most likely on
      // a cross-machine attachment over a slower/less stable connection.
      if (error instanceof Error && error.message === 'socket has been disconnected') {
        throw new Error(attachDisconnectedError(language, metadata.host ?? machineId));
      }
      throw error;
    } finally {
      setAttaching(false);
    }
  };

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleFileInputChange = (event: FormEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length > 0) runAction(() => attachFiles(files));
  };

  // Especially valuable for a session on a remote machine — there's no
  // other way to get a screenshot onto that machine's filesystem short of
  // manually copying it over yourself.
  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageFiles = items
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (imageFiles.length === 0) return;
    event.preventDefault();
    runAction(() => attachFiles(imageFiles));
  };

  const handleSend = (event: FormEvent) => {
    event.preventDefault();
    submitDraft();
  };

  // Slash-command autocomplete: only while the draft is still exactly
  // "/" + a partial command name (no space typed yet) — matches whatever
  // this specific session's own running CLI has actually registered,
  // never a hardcoded list.
  const slashQuery = draft.startsWith('/') && !draft.includes(' ') ? draft.slice(1) : null;
  const slashMatches = slashDismissed || slashQuery === null ? [] : (metadata?.slashCommands ?? []).filter((c) => c.toLowerCase().startsWith(slashQuery.toLowerCase()));

  const selectSlashCommand = (command: string) => {
    setDraft(`/${command} `, { coalesce: false });
    setSlashDismissed(true);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // While an IME composition is active (converting kana to kanji, etc.),
    // Enter confirms the selected candidate — it isn't "the user pressed
    // Enter to send" at all. Every keydown handler below assumed plain
    // Enter always meant submit, which made it impossible to convert text
    // without accidentally sending mid-conversion. isComposing is the
    // standard signal for this (set by the browser for the whole
    // composition, including the confirming Enter itself).
    if (event.nativeEvent.isComposing) return;
    // Bypasses the browser's own native undo stack (see useUndoableState for
    // why: it desyncs whenever the draft is set programmatically, e.g. a
    // slash command or attachment reference). Cmd+Shift+Z is the Mac
    // convention for redo; Cmd+Y is also bound since that's what was asked
    // for and costs nothing to support alongside it.
    const key = event.key.toLowerCase();
    if (event.metaKey && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoDraft();
      else undoDraft();
      return;
    }
    if (event.metaKey && key === 'y') {
      event.preventDefault();
      redoDraft();
      return;
    }
    if (slashMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashHighlight((i) => (i + 1) % slashMatches.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashHighlight((i) => (i - 1 + slashMatches.length) % slashMatches.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectSlashCommand(slashMatches[Math.min(slashHighlight, slashMatches.length - 1)]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setSlashDismissed(true);
      }
      return;
    }
    // Enter sends; Shift+Enter (or any other modifier) inserts a newline like every other chat composer.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
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
          onResume={() =>
            runAction(async () => {
              const result = await resumeSession(session.id);
              if (result.type === 'success') return;
              // resumeSession resolves (doesn't throw) on a business-logic
              // failure — was silently swallowed here before, since
              // runAction only surfaces thrown errors.
              const raw = result.type === 'error' ? result.errorMessage : result.type;
              throw new Error(explainResumeError(raw, language));
            })
          }
          onDownload={() => runAction(() => downloadTranscript(session))}
          onKill={() => runAction(() => killSession(session.id))}
          onOpenTerminal={openTerminalAction ? () => runAction(openTerminalAction) : undefined}
        />
      </header>

      {pendingRequests.length > 0 && (
        <div className="tile-permissions">
          {pendingRequests.map(([id, request]) => {
            const questionInput = request.tool === 'AskUserQuestion' ? (request.arguments as { questions?: AskUserQuestionQuestion[] } | undefined) : undefined;
            if (questionInput?.questions && questionInput.questions.length > 0) {
              return (
                <AskUserQuestionCard
                  key={id}
                  questions={questionInput.questions}
                  busy={busy}
                  onSubmit={(answers) => runAction(() => allowRequest(session.id, id, { answers }))}
                />
              );
            }
            return (
              <div key={id} className="permission-request">
                <span className="permission-tool">{request.tool}</span>
                <button type="button" disabled={busy} onClick={() => runAction(() => allowRequest(session.id, id))}>
                  allow
                </button>
                <button type="button" disabled={busy} onClick={() => runAction(() => denyRequest(session.id, id))}>
                  deny
                </button>
              </div>
            );
          })}
        </div>
      )}

      {actionError && <p className="tile-action-error">{actionError}</p>}

      <div className="tile-messages" ref={messagesRef} onScroll={handleMessagesScroll}>
        {session.hasMoreMessages && (
          <button type="button" className="tile-load-older" disabled={loadingOlder} onClick={handleLoadOlder}>
            {loadingOlder ? t('loadingOlder') : t('loadOlderMessages')}
          </button>
        )}
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
        <form className="tile-composer" onSubmit={handleSend}>
          <SlashCommandAutocomplete matches={slashMatches} highlightedIndex={slashHighlight} onSelect={selectSlashCommand} />
          <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileInputChange} />
          <ComposerPlusMenu
            slashCommands={metadata?.slashCommands ?? []}
            mcpServers={metadata?.mcpServers ?? []}
            onInsertSlashCommand={(command) => setDraft((d) => `${d}/${command} `, { coalesce: false })}
            onAttachFile={handleAttachClick}
          />
          <div className="tile-composer-input-wrap">
            <textarea
              ref={composerInputRef}
              className="tile-composer-input"
              rows={1}
              value={draft}
              disabled={busy}
              placeholder={t('messagePlaceholder')}
              onChange={(event) => {
                setDraft(event.target.value);
                setSlashDismissed(false);
                setSlashHighlight(0);
              }}
              onKeyDown={handleComposerKeyDown}
              onPaste={handleComposerPaste}
            />
            {attaching && (
              <span className="tile-composer-attaching">
                <LuLoaderCircle size={13} className="tile-composer-spinner" />
                {t('attachingFile')}
              </span>
            )}
          </div>
          <AgentSettingsPopover
            permissionMode={metadata?.permissionMode ?? 'default'}
            modelMode={metadata?.modelMode ?? 'default'}
            effortLevel={metadata?.effortLevel ?? 'medium'}
            busy={busy}
            onChange={(patch) => runAction(() => setAgentModes(session.id, patch))}
          />
          <button type="submit" className="tile-composer-send" disabled={busy || !draft.trim()} title={t('send')} aria-label={t('send')}>
            <LuSendHorizontal size={16} strokeWidth={2.25} />
          </button>
        </form>
        <AgentSettingsCaption
          path={path}
          permissionMode={metadata?.permissionMode ?? 'default'}
          modelMode={metadata?.modelMode ?? 'default'}
          effortLevel={metadata?.effortLevel ?? 'medium'}
        />
      </div>
    </section>
  );
}
