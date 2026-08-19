import { forwardRef, type FormEvent, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { LuDownload, LuOctagonPause, LuPencilLine, LuPin, LuPinOff, LuPlay, LuSkull, LuTerminal, LuTrash2 } from 'react-icons/lu';
import { useT } from '../lib/i18n';
import { explainResumeError } from '../lib/resumeError';
import type { LiveSession } from '../store/happyStore';
import { useSettingsStore } from '../store/settingsStore';
import type { Workspace } from '../store/workspaceStore';
import { ConfirmDialog } from './ConfirmDialog';

interface SessionMenuProps {
  session: LiveSession;
  title: string;
  pinned: boolean;
  workspaces: Workspace[];
  onTogglePin: () => void;
  onAddToWorkspace: (workspaceId: string) => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onResume: () => Promise<unknown>;
  onAbort: () => Promise<unknown>;
  onDownload: () => Promise<unknown>;
  onKill: () => Promise<unknown>;
  /** Undefined hides the item — only eligible once this machine's own id is known. */
  onOpenTerminal?: () => Promise<unknown>;
}

export interface SessionMenuHandle {
  /** Lets a parent (the sidebar row's onContextMenu) open this menu imperatively at a specific screen position — the "⋮" trigger still opens it anchored to itself via a plain click. */
  openAt: (position: { x: number; y: number }) => void;
}

/**
 * The full action menu for a session — reachable via the sidebar row's "⋮"
 * button (anchored under it, as before) or a right-click anywhere on the
 * row (opens at the cursor instead). Combines what used to be two separate
 * menus in two different places (this one: pin/rename/workspace/delete; the
 * session tile's own header menu: abort/resume/download/terminal/kill) into
 * one, since a user reaching for either one from the sidebar wants the
 * whole set, not half of it depending on which button they happened to
 * click.
 */
export const SessionMenu = forwardRef<SessionMenuHandle, SessionMenuProps>(function SessionMenu(
  { session, title, pinned, workspaces, onTogglePin, onAddToWorkspace, onRename, onDelete, onResume, onAbort, onDownload, onKill, onOpenTerminal },
  ref,
) {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const [open, setOpen] = useState(false);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingKill, setConfirmingKill] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    openAt: (position) => {
      setCursorPosition(position);
      setDraftName(title);
      setOpen(true);
    },
  }));

  const runAction = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setRenaming(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setRenaming(false);
      }
    };
    // Capture phase — Tauri's own drag-region mousedown listener
    // (data-tauri-drag-region, the titlebar) calls stopImmediatePropagation
    // for clicks landing there, which would otherwise swallow this before
    // a bubble-phase document listener ever saw it.
    document.addEventListener('mousedown', onOutside, true);
    window.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside, true);
      window.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  // Right-click can land anywhere on the row, including near the bottom of a
  // long sidebar list — clamp the cursor-anchored popover to stay fully
  // within the viewport instead of running off the bottom/right edge.
  useLayoutEffect(() => {
    if (!open || !popoverRef.current) return;
    const el = popoverRef.current;

    if (cursorPosition) {
      const rect = el.getBoundingClientRect();
      const maxLeft = window.innerWidth - rect.width - 8;
      const maxTop = window.innerHeight - rect.height - 8;
      el.style.left = `${Math.min(cursorPosition.x, Math.max(8, maxLeft))}px`;
      el.style.top = `${Math.min(cursorPosition.y, Math.max(8, maxTop))}px`;
      return;
    }

    // Reset any earlier overflow correction before re-measuring — otherwise
    // a leftover inline fixed-position from a wider previous render (e.g.
    // renaming just turned back off) would make this measurement reflect
    // that stale override instead of the current natural CSS position.
    el.style.position = '';
    el.style.right = '';
    el.style.left = '';
    el.style.top = '';
    const rect = el.getBoundingClientRect();
    // The default "⋮"-anchored popover (top:100%; right:4px in CSS) handles
    // the common case fine on its own — only override when it actually runs
    // off the left edge, e.g. the rename input widening the popover past
    // the sidebar's own left edge on a row near the window's left side.
    if (rect.left < 8) {
      el.style.position = 'fixed';
      el.style.right = 'auto';
      el.style.left = '8px';
      el.style.top = `${rect.top}px`;
    }
  }, [open, cursorPosition, renaming]);

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === title) {
      setRenaming(false);
      return;
    }
    runAction(() => onRename(trimmed)).then((ok) => {
      if (ok) {
        setRenaming(false);
        setOpen(false);
      }
    });
  };

  const runAndClose = (action: () => Promise<unknown>) => runAction(action).then((ok) => ok && setOpen(false));

  return (
    <div className="session-menu" ref={rootRef}>
      <button
        type="button"
        className="session-menu-trigger"
        title="Session actions"
        onClick={(event) => {
          event.stopPropagation();
          setCursorPosition(null);
          setDraftName(title);
          setOpen((v) => !v);
        }}
      >
        ⋮
      </button>

      {open && (
        <div
          ref={popoverRef}
          className={`session-menu-popover action-menu-popover ${cursorPosition ? 'session-menu-popover-cursor' : ''}`}
          style={cursorPosition ? { left: cursorPosition.x, top: cursorPosition.y } : undefined}
          onClick={(event) => event.stopPropagation()}
        >
          {renaming ? (
            <form className="session-menu-rename" onSubmit={submitRename}>
              <input
                autoFocus
                value={draftName}
                disabled={busy}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setRenaming(false);
                }}
              />
              <button type="submit" disabled={busy}>
                save
              </button>
            </form>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => runAndClose(async () => onTogglePin())}>
                {pinned ? <LuPinOff size={14} /> : <LuPin size={14} />}
                {pinned ? t('unpin') : t('pin')}
              </button>
              <button type="button" disabled={busy} onClick={() => setRenaming(true)}>
                <LuPencilLine size={14} />
                {t('rename')}
              </button>
              {session.active && (
                <button
                  type="button"
                  className="action-menu-warn"
                  disabled={busy}
                  title="Stop the current tool use and have the agent wait — the session process keeps running."
                  onClick={() => runAndClose(onAbort)}
                >
                  <LuOctagonPause size={14} />
                  {t('abort')}
                </button>
              )}
              {!session.active && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAndClose(async () => {
                      const result = (await onResume()) as { type: string; errorMessage?: string } | undefined;
                      if (result && result.type !== 'success') {
                        const raw = result.errorMessage || `Resume failed: ${result.type}`;
                        throw new Error(explainResumeError(raw, language));
                      }
                    })
                  }
                >
                  <LuPlay size={14} />
                  {t('resume')}
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => runAndClose(onDownload)}>
                <LuDownload size={14} />
                {t('downloadTranscript')}
              </button>
              {onOpenTerminal && (
                <button type="button" disabled={busy} onClick={() => runAndClose(onOpenTerminal)}>
                  <LuTerminal size={14} />
                  {t('openInTerminal')}
                </button>
              )}
              {workspaces.length > 0 && (
                <>
                  <div className="session-menu-divider" />
                  <div className="session-menu-section">
                    <span className="session-menu-label">{t('addToProject')}</span>
                    {workspaces.map((workspace) => (
                      <button
                        key={workspace.id}
                        type="button"
                        onClick={() => {
                          onAddToWorkspace(workspace.id);
                          setOpen(false);
                        }}
                      >
                        {workspace.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {error && <p className="session-menu-error">{error}</p>}
              <div className="session-menu-divider" />
              <button
                type="button"
                className="action-menu-danger"
                disabled={busy}
                onClick={() => {
                  setConfirmingKill(true);
                  setOpen(false);
                }}
              >
                <LuSkull size={14} />
                {t('killProcess')}
              </button>
              <button
                type="button"
                className="session-menu-delete"
                disabled={busy}
                onClick={() => {
                  setConfirmingDelete(true);
                  setOpen(false);
                }}
              >
                <LuTrash2 size={14} />
                {t('delete')}
              </button>
            </>
          )}
        </div>
      )}

      {confirmingKill && (
        <ConfirmDialog
          title="Kill this session?"
          body={`This immediately terminates the CLI process on the machine it's running on — not an interrupt, the process is gone. Cannot be undone.\n\n${title}`}
          confirmLabel="kill process"
          danger
          onConfirm={() => {
            setConfirmingKill(false);
            runAction(onKill);
          }}
          onCancel={() => setConfirmingKill(false)}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this session?"
          body={`Permanently removes it from the account on every device — not the same as kill (which only stops the process). Cannot be undone.\n\n${title}`}
          confirmLabel="delete"
          danger
          onConfirm={() => {
            setConfirmingDelete(false);
            runAction(onDelete);
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
});
