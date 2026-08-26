import { type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LuFileUp, LuLoaderCircle, LuSendHorizontal } from 'react-icons/lu';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildAgentMessageMeta } from '../lib/agentMessageMeta';
import { attachmentReferenceText, buildAttachmentDir, buildAttachmentPath, extensionForMimeType, relativeAttachmentPath } from '../lib/attachments';
import { AttachmentCancelledError, writeAttachmentFile } from '../lib/chunkedFileWrite';
import { downloadTranscript } from '../lib/exportTranscript';
import { DetailedError, splitError } from '../lib/detailedError';
import {
  attachDisconnectedError,
  attachmentCommandRejectedError,
  attachmentTimedOutError,
  attachmentWriteFailedError,
  cwdNotKnownError,
  unknownAttachMachineError,
} from '../lib/errorMessages';
import { logError } from '../lib/errorLog';
import { messageRole, type RenderablePart, renderablePart } from '../lib/formatMessage';
import { type TranslationKey, useT } from '../lib/i18n';
import { markdownComponents } from '../lib/markdownComponents';
import { resolveOpenTerminalAction } from '../lib/openTerminal';
import { explainResumeError } from '../lib/resumeError';
import { deriveTitle } from '../lib/sessionTitle';
import { useSessionDraft } from '../lib/useSessionDraft';
import { type AgentState, type LiveSession, useHappyStore } from '../store/happyStore';
import { useSelectionStore } from '../store/selectionStore';
import { useSettingsStore } from '../store/settingsStore';
import type { Workspace } from '../store/workspaceStore';
import { AgentSettingsCaption, AgentSettingsPopover } from './AgentSettingsPopover';
import { AskUserQuestionCard, type AskUserQuestionQuestion } from './AskUserQuestionCard';
import { AttachmentFile } from './AttachmentFile';
import { ComposerPlusMenu } from './ComposerPlusMenu';
import { mergePendingAttachments, type PendingAttachment, PendingAttachments } from './PendingAttachments';
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
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const hasMore = Boolean(part.detail || part.description);

  return (
    <div className={`tile-message tile-tool-call ${expanded ? 'tile-tool-call-expanded' : ''}`}>
      <button
        type="button"
        className="tile-tool-call-toggle"
        onClick={() => setExpanded((v) => !v)}
        disabled={!hasMore}
        title={hasMore ? (expanded ? t('collapse') : t('expand')) : undefined}
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

const TASK_NOTIFICATION_STATUS_ICON: Record<NonNullable<Extract<RenderablePart, { kind: 'task-notification' }>['status']>, string> = {
  completed: '✓',
  failed: '✕',
  killed: '✕',
  stopped: '⏸',
};

/**
 * A background-task completion notice (Agent/Workflow/Monitor/background-
 * Bash) — same collapsed-row treatment as ToolCallLine (reuses its CSS
 * classes) since it's the same shape of thing: secondary activity, headline
 * first, detail on demand. Unlike a tool call it's never grouped into a
 * ToolCallGroup burst (see groupToolCalls) — each one names a different,
 * individually meaningful piece of work, not a batch of the same kind of
 * step.
 */
function TaskNotificationLine({ part }: { part: Extract<RenderablePart, { kind: 'task-notification' }> }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const hasMore = Boolean(part.body);

  return (
    <div className={`tile-message tile-tool-call ${expanded ? 'tile-tool-call-expanded' : ''}`}>
      <button
        type="button"
        className="tile-tool-call-toggle"
        onClick={() => setExpanded((v) => !v)}
        disabled={!hasMore}
        title={hasMore ? (expanded ? t('collapse') : t('expand')) : undefined}
      >
        {hasMore && <span className="tile-tool-call-caret">{expanded ? '▾' : '▸'}</span>}
        {part.status && <span className="tile-tool-call-caret">{TASK_NOTIFICATION_STATUS_ICON[part.status]}</span>}
        <span className="tile-tool-call-label">
          {part.headline}
          {part.metrics.length > 0 && <span className="tile-tool-call-metrics"> · {part.metrics.join(' · ')}</span>}
        </span>
      </button>
      {expanded && part.body && (
        <div className="tile-tool-call-body">
          <div className="tile-message-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{part.body}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

type MessageEntry = { message: LiveSession['messages'][number]; part: RenderablePart };
type MessageSegment = { kind: 'single'; entry: MessageEntry } | { kind: 'tool-group'; entries: MessageEntry[] };

/** A run of 2+ consecutive tool-calls collapses to one summary line ("▸ 3 tool calls · Read, Bash, Write") instead of a still-visible-even-collapsed row each — this is what a tool-call burst actually is, one activity, not several turns to scan past. A lone tool-call stays exactly as ToolCallLine renders it on its own, unwrapped. */
function groupToolCalls(entries: MessageEntry[]): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let run: MessageEntry[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    segments.push(run.length === 1 ? { kind: 'single', entry: run[0] } : { kind: 'tool-group', entries: run });
    run = [];
  };
  for (const entry of entries) {
    if (entry.part.kind === 'tool-call') {
      run.push(entry);
    } else {
      flushRun();
      segments.push({ kind: 'single', entry });
    }
  }
  flushRun();
  return segments;
}

function ToolCallGroup({ entries }: { entries: MessageEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const labels = entries.map(({ part }) => (part.kind === 'tool-call' ? part.label : '')).join(', ');

  return (
    <div className={`tile-message tile-tool-call tile-tool-group ${expanded ? 'tile-tool-call-expanded' : ''}`}>
      <button
        type="button"
        className="tile-tool-call-toggle"
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        <span className="tile-tool-call-caret">{expanded ? '▾' : '▸'}</span>
        <span className="tile-tool-call-label tile-tool-group-label">
          {entries.length} tool calls · {labels}
        </span>
      </button>
      {expanded && (
        <div className="tile-tool-group-items">
          {entries.map(
            ({ message, part }) => part.kind === 'tool-call' && <ToolCallLine key={message.id} part={part} />,
          )}
        </div>
      )}
    </div>
  );
}

// See lastCompositionEndAtRef's own comment (inside SessionTile) for why
// this grace window exists at all.
const COMPOSITION_GRACE_MS = 50;

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
  const refreshMessages = useHappyStore((s) => s.refreshMessages);
  const killSession = useHappyStore((s) => s.killSession);
  const createMachineDirectory = useHappyStore((s) => s.createMachineDirectory);
  const writeMachineBinaryFile = useHappyStore((s) => s.writeMachineBinaryFile);
  const isSelected = useSelectionStore((s) => s.selected.has(session.id));
  const toggleSelected = useSelectionStore((s) => s.toggle);
  const terminalApp = useSettingsStore((s) => s.terminalApp);
  const terminalWindowMode = useSettingsStore((s) => s.terminalWindowMode);
  const sshTargets = useSettingsStore((s) => s.sshTargets);
  const runMachineBash = useHappyStore((s) => s.runMachineBash);

  const { value: draft, set: setDraft, reset: resetDraft, undo: undoDraft, redo: redoDraft } = useSessionDraft(session.id);
  const [busy, setBusy] = useState(false);
  // A held/repeating Enter key fires several keydown events before React
  // commits the `busy`-driven `disabled` state to the DOM — state updates
  // are batched, not synchronous, so a few rapid keydowns can each read the
  // same pre-clear `draft` value and each call sendMessage before any of
  // them takes effect. Confirmed live: an offline session (slow to resume,
  // giving the user more time to impatiently re-press Enter) sent the same
  // text 5 times in a row. A plain ref updates immediately, so this closes
  // the race the state-only guard couldn't.
  const sendingRef = useRef(false);
  // What submitDraft last sent, so pressing Stop can hand it back — Claude
  // Desktop's own stop control doesn't do this, but losing the prompt you
  // were mid-edit on when you only meant to interrupt a bad response was
  // the actual complaint. Cleared once restored so a second Stop (on a
  // later message) doesn't hand back stale text, and never overwrites
  // anything the user has already started typing since sending.
  const lastSentDraftRef = useRef<string | null>(null);
  // Belt-and-suspenders behind the isComposing/keyCode===229 checks in
  // handleComposerKeyDown below: those catch the documented WebKit case
  // where compositionend fires before the confirming Enter's keydown but
  // that keydown still carries keyCode 229. Other editors (e.g.
  // slab/quill#4134, still open) report a rarer WebKit variant where the
  // event around composition-end carries NEITHER signal — indistinguishable
  // from a real keystroke by any single event's own flags. A short window
  // after compositionend catches that case for Enter specifically: nobody
  // deliberately sends a message by pressing Enter within ~50ms of the
  // Enter that just confirmed a conversion, so it's safe to swallow.
  const lastCompositionEndAtRef = useRef(0);
  const [actionError, setActionError] = useState<{ message: string; detail?: string } | null>(null);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [slashHighlight, setSlashHighlight] = useState(0);
  // Starts dismissed, not open. `draft` used to be unconditionally '' on
  // mount, so slashQuery below was always null on the first render and
  // this flag's initial value never mattered. Now that the draft is
  // restored from useDraftStore, switching back to a session whose draft
  // is a half-typed "/rev" would otherwise pop the autocomplete overlay
  // open over a composer the user hasn't touched — and populate it from a
  // slashCommands list that may have changed while the tile was
  // unmounted. Every onChange clears this, so actually typing "/" still
  // opens it.
  const [slashDismissed, setSlashDismissed] = useState(true);
  const messagesRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const pendingOlderLoadScrollHeightRef = useRef<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [attaching, setAttaching] = useState(false);
  // Polled between chunk uploads (see writeAttachmentFile) — a ref, not
  // state, because the upload loop closes over it once and needs to see
  // the CURRENT value on every iteration, not the value from the render
  // that started it.
  const attachCancelledRef = useRef(false);
  // Files already written to the session's machine but not yet referenced
  // in a sent message. This list — NOT any text in the textarea — is the
  // single source of truth for what the next message will attach; see
  // submitDraft for why the `[Attached file: …]` text is materialised only
  // at send time.
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  // Handed back by Stop alongside the text (see handleStop) so an
  // interrupt doesn't force a re-upload of every attached byte.
  const lastSentAttachmentsRef = useRef<PendingAttachment[] | null>(null);
  const [fileDragOver, setFileDragOver] = useState(false);
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
      setActionError(splitError(error));
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

  // Escape cancels an in-progress attachment. Bound on window, NOT on the
  // composer textarea: while attaching, the textarea carries disabled={busy},
  // and a disabled form control receives no key events at all — an Escape
  // handler there could never fire, which is exactly the state the user
  // needs to escape from.
  useEffect(() => {
    if (!attaching) return;
    // globalThis.KeyboardEvent, not the bare name: this file imports
    // React's own KeyboardEvent type, which shadows the DOM one.
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      attachCancelledRef.current = true;
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [attaching]);

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      // Every action failure lands in the persistent debug log, in full —
      // the in-app error banner can only ever show a short summary (see
      // attachmentWriteFailedError for why that's not enough on its own).
      logError('runAction', error);
      setActionError(splitError(error));
    } finally {
      setBusy(false);
    }
  };

  // The chips ARE the attachment state; the `[Attached file: …]` text is
  // built here, at send time, and never exists in the textarea at all.
  // The obvious alternative — keep appending the text to the draft (what
  // shipped before) and render chips by parsing it back out — was
  // rejected because it makes one fact editable in two places: delete the
  // chip but not the text and the message still ships a path the user
  // believes they removed; delete the text but not the chip and a chip
  // stands for a file the agent is never told about. With the text alive
  // only for the duration of this function, neither state is
  // representable. The cost is that draft undo (Cmd+Z) no longer undoes an
  // attachment — the chip's own "×" is the affordance for that instead,
  // which is also how Claude Desktop and ChatGPT behave.
  const submitDraft = () => {
    const text = draft.trim();
    const references = pendingAttachments.map((attachment) => attachmentReferenceText(attachment.relativePath)).join(' ');
    // Attachments alone, with no typed text, is a legitimate message —
    // the same as dropping a file into Claude Desktop and hitting enter.
    if ((!text && !references) || sendingRef.current) return;
    // References first, then the typed text, mirroring the chip strip
    // sitting above the input: the transcript then reads in the same
    // order the composer did. (The old code appended them after whatever
    // was typed, but that was an artefact of appending onto a draft
    // string, not a deliberate ordering choice.)
    const message = references && text ? `${references}\n${text}` : references || text;
    sendingRef.current = true;
    lastSentDraftRef.current = text;
    const sent = pendingAttachments;
    lastSentAttachmentsRef.current = sent;
    resetDraft('');
    // Unmounts every chip, which is what revokes their object URLs — see
    // PendingAttachments.
    setPendingAttachments([]);
    runAction(async () => {
      try {
        // The mode/model badges only write session metadata, which no
        // happy-cli code path reads back — restating them here is what
        // actually reaches the running agent. See buildAgentMessageMeta for
        // why this is a per-message restatement rather than a one-shot push
        // at change time.
        await sendMessage(session.id, message, buildAgentMessageMeta(metadata));
      } catch (error) {
        // Clearing optimistically is fine for the draft — a failed send
        // costs the user a retype. It is NOT fine for the chips: they are
        // the only place these paths are ever shown, and the bytes are
        // already sitting on a possibly-remote machine inside a
        // millisecond-stamped `.claude/happy-<ts>/` directory (see
        // formatTimestampForDirName) that appears nowhere else in the UI.
        // Losing them means the upload has to be redone over the same
        // relay that just failed. Merged, not assigned, so an attach that
        // landed while this send was in flight isn't clobbered. Re-thrown
        // so runAction still logs it and raises the error banner; the
        // draft text is deliberately left alone here, since restoring it
        // would change existing, unrelated behaviour.
        setPendingAttachments((prev) => mergePendingAttachments(sent, prev));
        throw error;
      }
    }).finally(() => {
      sendingRef.current = false;
    });
  };

  // Drops the reference ONLY; the copy already written to the session's
  // machine is deliberately left where it is. Deleting it would mean
  // another RPC to a machine that may have gone away since the upload
  // (exactly the failure attachDisconnectedError exists for), and a
  // deletion we report as done but which silently failed is worse than a
  // stray file: the destination is a fresh, timestamped
  // `.claude/happy-<ts>/` directory (already gitignored in this user's
  // projects — see buildAttachmentDir), so nothing there is ever
  // overwritten or collides. Nothing can dangle in the other direction
  // either: submitDraft builds the reference text FROM this list, so a
  // removed chip leaves no path behind to send.
  const removePendingAttachment = (id: string) => {
    // Functional update rather than filtering the captured array: an
    // attachFiles upload started earlier can resolve and append to this
    // same list at any moment, and a stale closure would silently drop
    // the file it had just finished uploading.
    setPendingAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    // The clicked button is about to unmount, which drops focus to
    // <body>. In the grid view that means the next Tab restarts at the
    // top of the document and walks through every earlier tile before
    // coming back to the composer the user was standing right next to.
    // The "×" is the only keyboard route to removing a chip, so it can't
    // be a focus trap-door.
    composerInputRef.current?.focus();
  };

  // The stop button only shows while session.thinking is true (see its
  // render site), so this is only ever reachable mid-turn. Interrupting
  // fires immediately rather than waiting on abortSession's round-trip —
  // this needs to feel as instant as Claude Desktop's own stop button, and
  // runAction's error banner still surfaces a failure if the RPC itself
  // fails. Only restores into an EMPTY draft: if the user already started
  // typing something else while the agent was thinking, that draft wins.
  const handleStop = () => {
    const restore = lastSentDraftRef.current;
    const restoreAttachments = lastSentAttachmentsRef.current;
    lastSentDraftRef.current = null;
    lastSentAttachmentsRef.current = null;
    if (restore && !draft.trim()) setDraft(restore, { coalesce: false });
    // Chips come back for the same reason the text does, only more so:
    // re-attaching means re-uploading every byte to a possibly-remote
    // machine again. The written files are untouched by any of this, so
    // the restored chips' paths are still valid.
    //
    // Note this does NOT copy the text's "only into an empty draft" rule.
    // That rule exists because there is exactly one draft string, so a
    // draft the user started while the agent was thinking genuinely
    // conflicts with the restored one. Two attachment lists don't
    // conflict — they concatenate. Gating on `pendingAttachments.length
    // === 0` would mean: send 2 files, drop in a 3rd while the agent
    // works, hit Stop, and the first 2 are gone for good.
    if (restoreAttachments && restoreAttachments.length > 0) setPendingAttachments((prev) => mergePendingAttachments(restoreAttachments, prev));
    runAction(() => abortSession(session.id));
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
    attachCancelledRef.current = false;
    try {
      const attachDir = buildAttachmentDir(cwd, Date.now());
      const mkdirResult = await createMachineDirectory(machineId, attachDir, platform);
      if (!mkdirResult.success) throw new Error(mkdirResult.error);

      const attached: PendingAttachment[] = [];
      for (const [index, file] of files.entries()) {
        if (attachCancelledRef.current) throw new AttachmentCancelledError();
        const fileName = file.name || `pasted-${index + 1}.${extensionForMimeType(file.type)}`;
        const bytes = new Uint8Array(await file.arrayBuffer());
        await writeAttachmentFile(
          runMachineBash,
          writeMachineBinaryFile,
          machineId,
          platform,
          buildAttachmentPath(attachDir, fileName),
          bytes,
          () => attachCancelledRef.current,
        );
        attached.push({ id: crypto.randomUUID(), file, relativePath: relativeAttachmentPath(cwd, attachDir, fileName) });
      }

      // Chips appear only here, once every write in the batch has landed —
      // never optimistically per file. A cancel (Escape / the overlay's
      // Cancel button) throws out of the loop above before reaching this
      // line, so a half-uploaded batch leaves no chips at all, exactly as
      // it previously left no reference text. Functional update for the
      // same reason removePendingAttachment uses one: a second attach
      // action, or a removal, can have run while these writes were in
      // flight.
      setPendingAttachments((prev) => [...prev, ...attached]);
    } catch (error) {
      // A cancel is the user getting what they asked for, not a failure —
      // swallow it rather than surfacing an error banner. Any partially
      // written remote temp file is left behind deliberately: it's in the
      // machine's own tmp dir under a uuid name, so the OS reclaims it,
      // and chasing it would mean another RPC on a connection we may have
      // just given up on.
      if (error instanceof AttachmentCancelledError) return;
      // Already retried transparently a couple of times if the connection
      // to that machine merely blipped mid-call (see withDisconnectRetry) —
      // reaching here means it stayed down longer than that, most likely on
      // a cross-machine attachment over a slower/less stable connection.
      if (error instanceof Error && error.message === 'socket has been disconnected') {
        throw new Error(attachDisconnectedError(language, metadata.host ?? machineId));
      }
      // Whatever's left here is a raw failure from the write pipeline
      // itself (a failed mkdir, or the machine-bash RPC used for large
      // attachments — see chunkedFileWrite.ts) — e.g. a shell command that
      // doesn't work the same on every OS. That's exactly the kind of
      // detail worth keeping in full for debugging, just not as the ONLY
      // thing shown to the user with no context for what was happening.
      const detail = error instanceof Error ? error.message : String(error);
      logError('attachFiles', error);
      const host = metadata.host ?? machineId;
      // Pick the most specific summary the raw text supports. Everything
      // unrecognised falls back to the generic "the write failed" line —
      // the raw text is still one click away either way, so guessing
      // wrong here costs nothing but a slightly vaguer sentence.
      let summary: string;
      if (/timed out/i.test(detail)) {
        summary = attachmentTimedOutError(language, host);
      } else if (/usage:|invalid argument|unrecognized option|not recognized as an internal/i.test(detail)) {
        // The remote shell printed its own usage/complaint rather than
        // running the command — see attachmentCommandRejectedError.
        summary = attachmentCommandRejectedError(language, host);
      } else {
        summary = attachmentWriteFailedError(language, host);
      }
      throw new DetailedError(summary, detail);
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

  // Dropped straight onto this tile — attaches to THIS session specifically,
  // not some ambient "currently focused" one, so dragging a file onto a
  // different pane in a split view targets that pane's own session. The
  // pane-reorder drag (dragging a sidebar row to split/rearrange panes,
  // see App.tsx's onPanesDragOver/onPanesDrop) already ignores anything
  // that isn't its own SESSION_DRAG_MIME type, so this coexists with it
  // without needing stopPropagation.
  const handleTileDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setFileDragOver(true);
  };

  const handleTileDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setFileDragOver(false);
  };

  const handleTileDrop = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setFileDragOver(false);
    const files = Array.from(event.dataTransfer.files);
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
    // composition) — but on WebKit (Safari/WKWebView, and WebKitGTK on
    // Linux, which shares the same WebCore composition code) compositionend
    // fires and isComposing flips to false BEFORE the keydown for the very
    // Enter press that confirmed the composition, unlike Chromium/WebView2
    // which keeps isComposing true on that keydown. isComposing alone
    // therefore misses exactly the one keystroke this guard exists for on
    // macOS/Linux. keyCode 229 is the legacy IME sentinel WebKit still
    // reports on that same keydown despite isComposing already being false
    // — MDN's own documented workaround for this gap. No real key reports
    // 229, and a deliberate, fast second Enter (send-for-real, right after
    // confirming) is a distinct keydown that doesn't carry it, so this
    // doesn't risk swallowing that second press.
    //
    // A rarer WebKit variant (reported against other editors even after
    // they shipped this same isComposing/229 guard — e.g. slab/quill#4134)
    // has the confirming Enter carry NEITHER signal, indistinguishable
    // from a real keystroke on its own. lastCompositionEndAtRef is the
    // backstop for that: see its own comment for why the short window is
    // safe.
    if (
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      (event.key === 'Enter' && performance.now() - lastCompositionEndAtRef.current < COMPOSITION_GRACE_MS)
    ) {
      return;
    }
    // Bypasses the browser's own native undo stack (see useSessionDraft for
    // why: it desyncs whenever the draft is set programmatically, e.g. a
    // slash command or handleStop's restore of an interrupted message).
    // Cmd+Shift+Z is the Mac
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
    <section
      className={`tile tile-${variant} ${isSelected ? 'tile-selected' : ''} ${fileDragOver ? 'tile-file-drag-over' : ''}`}
      onDragOver={handleTileDragOver}
      onDragLeave={handleTileDragLeave}
      onDrop={handleTileDrop}
    >
      {fileDragOver && (
        <div className="tile-drop-overlay">
          <LuFileUp size={28} strokeWidth={1.5} />
          <span>{t('dropFileToAttach')}</span>
        </div>
      )}
      <header className="tile-header">
        {variant === 'grid' && (
          <input
            type="checkbox"
            className="tile-select"
            checked={isSelected}
            onChange={() => toggleSelected(session.id)}
            title={t('selectForBulkActions')}
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
            title={t('removeFromTab')}
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

      {actionError && (
        <div className="tile-action-error">
          <p className="tile-action-error-message">{actionError.message}</p>
          {/* Raw technical text stays available but out of the way — it
              used to be concatenated into the sentence above, which meant
              a remote shell's usage dump buried the one actionable line. */}
          {actionError.detail && (
            <details className="tile-action-error-details">
              <summary>{t('showDetails')}</summary>
              <pre>{actionError.detail}</pre>
            </details>
          )}
        </div>
      )}

      <div className="tile-messages" ref={messagesRef} onScroll={handleMessagesScroll}>
        {session.hasMoreMessages && (
          <button type="button" className="tile-load-older" disabled={loadingOlder} onClick={handleLoadOlder}>
            {loadingOlder ? t('loadingOlder') : t('loadOlderMessages')}
          </button>
        )}
        {session.messagesError ? (
          <div className="tile-messages-error">
            <p className="tile-empty">
              {t('messagesLoadFailed')}: {session.messagesError}
            </p>
            <button type="button" onClick={() => refreshMessages(session.id)}>
              {t('retry')}
            </button>
          </div>
        ) : (
          visibleMessages.length === 0 && <p className="tile-empty">{t('noMessages')}</p>
        )}
        {groupToolCalls(visibleMessages).map((segment) => {
          if (segment.kind === 'tool-group') {
            return (
              <div key={segment.entries[0].message.id} className="message-row role-agent">
                <ToolCallGroup entries={segment.entries} />
              </div>
            );
          }
          const { message, part } = segment.entry;
          const role = messageRole(message.content);
          return (
            <div key={message.id} className={`message-row role-${role}`}>
              {part.kind === 'text' ? (
                <div className="tile-message tile-message-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{part.text}</ReactMarkdown>
                </div>
              ) : part.kind === 'tool-call' ? (
                <ToolCallLine part={part} />
              ) : part.kind === 'file' ? (
                <AttachmentFile sessionId={session.id} name={part.name} ref={part.ref} size={part.size} mimeType={part.mimeType} />
              ) : part.kind === 'task-notification' ? (
                <TaskNotificationLine part={part} />
              ) : (
                <p className="tile-message">{part.text}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="tile-bottom-bar">
        {/* Above the composer pill rather than inside its row: that row is
            already crowded (+ menu, mode pills, the growing textarea,
            send) and a chip strip inside it would fight the textarea for
            width on a narrow grid tile. Full width above is also where
            Claude Desktop and ChatGPT put theirs, which is what was
            asked for. */}
        <PendingAttachments items={pendingAttachments} onRemove={removePendingAttachment} />
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
              onCompositionEnd={() => {
                lastCompositionEndAtRef.current = performance.now();
              }}
              onKeyDown={handleComposerKeyDown}
              onPaste={handleComposerPaste}
            />
            {attaching && (
              <span className="tile-composer-attaching">
                <LuLoaderCircle size={13} className="tile-composer-spinner" />
                {t('attachingFile')}
                <button type="button" className="tile-composer-attaching-cancel" onClick={() => (attachCancelledRef.current = true)}>
                  {t('cancel')}
                </button>
              </span>
            )}
          </div>
          {/* Deliberately NOT defaulted to 'default'/'default'/'medium'
              here any more. Nothing in happy-cli writes these fields into
              session metadata, so their absence means "unknown", and the
              old fallbacks turned that into three confident but unfounded
              claims — the reason a session spawned with opusplan/max/
              acceptEdits still showed デフォルト + opus + 中. A session
              this app spawned now gets them written for real right after
              the spawn RPC (see spawnSession in happyStore). */}
          <AgentSettingsPopover
            permissionMode={metadata?.permissionMode}
            modelMode={metadata?.modelMode}
            effortLevel={metadata?.effortLevel}
            busy={busy}
            onChange={(patch) => runAction(() => setAgentModes(session.id, patch))}
          />
          {session.thinking ? (
            <button type="button" className="tile-composer-stop" onClick={handleStop} title={t('stop')} aria-label={t('stop')}>
              <span className="tile-composer-stop-icon" />
            </button>
          ) : (
            <button type="submit" className="tile-composer-send" disabled={busy || (!draft.trim() && pendingAttachments.length === 0)} title={t('send')} aria-label={t('send')}>
              <LuSendHorizontal size={16} strokeWidth={2.25} />
            </button>
          )}
        </form>
        <AgentSettingsCaption
          path={path}
          permissionMode={metadata?.permissionMode}
          modelMode={metadata?.modelMode}
          effortLevel={metadata?.effortLevel}
        />
      </div>
    </section>
  );
}
