import { type FormEvent, useEffect, useRef, useState } from 'react';
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
}

/** The "⋮" menu on a sidebar session row: pin, rename, add to a workspace, resume (offline only), delete. */
export function SessionMenu({ session, title, pinned, workspaces, onTogglePin, onAddToWorkspace, onRename, onDelete, onResume }: SessionMenuProps) {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(title);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('keydown', onEscape);
    };
  }, [open]);

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

  return (
    <div className="session-menu" ref={rootRef}>
      <button
        type="button"
        className="session-menu-trigger"
        title="Session actions"
        onClick={(event) => {
          event.stopPropagation();
          setDraftName(title);
          setOpen((v) => !v);
        }}
      >
        ⋮
      </button>

      {open && (
        <div className="session-menu-popover" onClick={(event) => event.stopPropagation()}>
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
              <button type="button" onClick={() => onTogglePin()}>
                {pinned ? t('unpin') : t('pin')}
              </button>
              <button type="button" onClick={() => setRenaming(true)}>
                {t('rename')}
              </button>
              {!session.active && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction(async () => {
                      const result = (await onResume()) as { type: string; errorMessage?: string } | undefined;
                      if (result && result.type !== 'success') {
                        const raw = result.errorMessage || `Resume failed: ${result.type}`;
                        throw new Error(explainResumeError(raw, language));
                      }
                    }).then((ok) => ok && setOpen(false))
                  }
                >
                  {t('resume')}
                </button>
              )}
              {workspaces.length > 0 && (
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
              )}
              {error && <p className="session-menu-error">{error}</p>}
              <div className="session-menu-divider" />
              <button
                type="button"
                className="session-menu-delete"
                onClick={() => {
                  setConfirmingDelete(true);
                  setOpen(false);
                }}
              >
                {t('delete')}
              </button>
            </>
          )}
        </div>
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
}
