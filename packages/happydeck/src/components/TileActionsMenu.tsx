import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/i18n';
import { ConfirmDialog } from './ConfirmDialog';

interface TileActionsMenuProps {
  title: string;
  busy: boolean;
  onAbort: () => void;
  onDownload: () => void;
  onKill: () => void;
}

/** The "⋮" menu in a session tile's header: abort / download / kill. Kill needs its own confirm. */
export function TileActionsMenu({ title, busy, onAbort, onDownload, onKill }: TileActionsMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirmingKill, setConfirmingKill] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    window.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      window.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  return (
    <div className="session-menu" ref={rootRef}>
      <button
        type="button"
        className="session-menu-trigger"
        title="Session actions"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋮
      </button>

      {open && (
        <div className="session-menu-popover" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            disabled={busy}
            title="Stop the current tool use and have the agent wait — the session process keeps running."
            onClick={() => {
              onAbort();
              setOpen(false);
            }}
          >
            {t('abort')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onDownload();
              setOpen(false);
            }}
          >
            {t('downloadTranscript')}
          </button>
          <div className="session-menu-divider" />
          <button
            type="button"
            className="session-menu-delete"
            disabled={busy}
            onClick={() => {
              setConfirmingKill(true);
              setOpen(false);
            }}
          >
            {t('killProcess')}
          </button>
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
            onKill();
          }}
          onCancel={() => setConfirmingKill(false)}
        />
      )}
    </div>
  );
}
