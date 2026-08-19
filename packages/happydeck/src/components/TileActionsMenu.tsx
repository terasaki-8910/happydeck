import { useEffect, useRef, useState } from 'react';
import { LuDownload, LuOctagonPause, LuPlay, LuSkull, LuTerminal } from 'react-icons/lu';
import { useT } from '../lib/i18n';
import { ConfirmDialog } from './ConfirmDialog';

interface TileActionsMenuProps {
  title: string;
  busy: boolean;
  onAbort: () => void;
  onResume: () => void;
  onDownload: () => void;
  onKill: () => void;
  /** Present only when this session is running on this machine — opening a real terminal window only makes sense for a path that actually exists locally. Undefined hides the option. Routed through the parent's runAction so a failure (e.g. Terminal.app missing) surfaces in the tile's error banner instead of failing silently. */
  onOpenTerminal?: () => void;
}

/** The "⋮" menu in a session tile's header: abort/resume / download / open-in-terminal / kill. Kill needs its own confirm. */
export function TileActionsMenu({ title, busy, onAbort, onResume, onDownload, onKill, onOpenTerminal }: TileActionsMenuProps) {
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
        <div className="session-menu-popover action-menu-popover" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="action-menu-warn"
            disabled={busy}
            title="Stop the current tool use and have the agent wait — the session process keeps running."
            onClick={() => {
              onAbort();
              setOpen(false);
            }}
          >
            <LuOctagonPause size={14} />
            {t('abort')}
          </button>
          <button
            type="button"
            disabled={busy}
            title="Wake a waiting session back up."
            onClick={() => {
              onResume();
              setOpen(false);
            }}
          >
            <LuPlay size={14} />
            {t('resume')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onDownload();
              setOpen(false);
            }}
          >
            <LuDownload size={14} />
            {t('downloadTranscript')}
          </button>
          {onOpenTerminal && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onOpenTerminal();
                setOpen(false);
              }}
            >
              <LuTerminal size={14} />
              {t('openInTerminal')}
            </button>
          )}
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
        </div>
      )}

      {confirmingKill && (
        <ConfirmDialog
          title={t('killConfirmTitle')}
          body={`${t('killConfirmBody')}\n\n${title}`}
          confirmLabel={t('killProcess')}
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
