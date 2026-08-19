import { useEffect } from 'react';
import { useT } from '../lib/i18n';

interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * window.confirm()/alert() don't reliably render in this app's Tauri
 * webview (native dialog suppression, cause unconfirmed) — this is a
 * regular in-DOM modal instead, so it's guaranteed visible.
 */
export function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  const t = useT();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="confirm-backdrop" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <h2 className="confirm-title">{title}</h2>
        <p className="confirm-body">{body}</p>
        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button type="button" className={danger ? 'confirm-danger' : 'confirm-ok'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
