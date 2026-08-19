import { useEffect, useMemo, useState } from 'react';
import { LuDownload, LuFile, LuLoaderCircle, LuRefreshCw, LuX } from 'react-icons/lu';
import { useT } from '../lib/i18n';
import { saveAttachmentToDisk } from '../lib/downloadAttachment';
import { useHappyStore } from '../store/happyStore';

function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface AttachmentFileProps {
  sessionId: string;
  name: string;
  ref: string | null;
  size: number | null;
  mimeType: string | null;
}

/**
 * Renders a session-protocol file event (happy-wire's sessionFileEventSchema
 * — a pasted-into-the-terminal image uploaded via Happy's own blob
 * protocol, not this app's own [Attached file: path] text convention,
 * which stays plain text and isn't handled here). Images fetch+decrypt
 * eagerly for an inline thumbnail (click to enlarge); anything else (or
 * an image with `ref` missing — an event predating this feature) gets a
 * plain file row with a download button.
 */
export function AttachmentFile({ sessionId, name, ref, size, mimeType }: AttachmentFileProps) {
  const t = useT();
  const downloadAttachment = useHappyStore((s) => s.downloadAttachment);
  const isImage = mimeType?.startsWith('image/') ?? false;

  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Bumping this re-runs the fetch effect below — the retry button's only job.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isImage || !ref) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    downloadAttachment(sessionId, ref)
      .then((result) => {
        if (!cancelled) setBytes(result);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, ref, isImage, downloadAttachment, attempt]);

  const objectUrl = useMemo(() => {
    if (!bytes) return null;
    return URL.createObjectURL(new Blob([bytes], { type: mimeType ?? 'application/octet-stream' }));
  }, [bytes, mimeType]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen]);

  const handleDownload = async () => {
    if (!ref || downloading) return;
    setDownloading(true);
    try {
      // Reuse the already-decrypted bytes from the preview fetch when we
      // have them (images) instead of re-downloading+re-decrypting.
      const data = bytes ?? (await downloadAttachment(sessionId, ref));
      await saveAttachmentToDisk(name, data);
    } catch {
      setError(true);
    } finally {
      setDownloading(false);
    }
  };

  if (isImage && ref) {
    return (
      <div className="tile-message tile-attachment-image">
        {loading && (
          <div className="tile-attachment-loading">
            <LuLoaderCircle size={14} className="tile-composer-spinner" />
          </div>
        )}
        {!loading && error && (
          <div className="tile-attachment-error">
            <span>{t('attachmentLoadFailed')}</span>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} title={t('attachmentRetry')}>
              <LuRefreshCw size={13} />
            </button>
          </div>
        )}
        {!loading && !error && objectUrl && (
          <button type="button" className="tile-attachment-thumb-trigger" onClick={() => setLightboxOpen(true)}>
            <img src={objectUrl} alt={name} className="tile-attachment-thumb" />
          </button>
        )}
        <div className="tile-attachment-caption">
          <span className="tile-attachment-name">{name}</span>
          {size !== null && <span className="tile-attachment-size">{formatSize(size)}</span>}
          <button type="button" className="tile-attachment-download" disabled={downloading} onClick={handleDownload} title={t('attachmentDownload')}>
            <LuDownload size={13} />
          </button>
        </div>

        {lightboxOpen && objectUrl && (
          <div className="attachment-lightbox-backdrop" onClick={() => setLightboxOpen(false)}>
            <button type="button" className="attachment-lightbox-close" onClick={() => setLightboxOpen(false)} title={t('close')}>
              <LuX size={18} />
            </button>
            <img src={objectUrl} alt={name} className="attachment-lightbox-image" onClick={(event) => event.stopPropagation()} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tile-message tile-attachment-file">
      <LuFile size={14} className="tile-attachment-file-icon" />
      <span className="tile-attachment-name">{name}</span>
      {size !== null && <span className="tile-attachment-size">{formatSize(size)}</span>}
      <button type="button" className="tile-attachment-download" disabled={!ref || downloading} onClick={handleDownload} title={t('attachmentDownload')}>
        <LuDownload size={13} />
      </button>
    </div>
  );
}
