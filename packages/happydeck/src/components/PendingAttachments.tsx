import { useEffect, useState } from 'react';
import { LuFile, LuX } from 'react-icons/lu';
import { formatFileSize } from '../lib/attachments';
import { useT } from '../lib/i18n';
import { basename } from '../lib/paths';

/**
 * One file that has already been written to the session's own machine but
 * whose `[Attached file: …]` reference has NOT been sent yet.
 *
 * `file` is kept alongside the path on purpose: the copy that matters to
 * the agent lives on a possibly-DIFFERENT machine, reachable only through
 * Happy's relay (see attachFiles in SessionTile), so there is no cheap way
 * to read it back for a thumbnail — no URL to point an <img> at, and
 * fetching it would mean a second round-trip of every byte we just
 * uploaded. The local File the user picked/dropped/pasted is the same
 * bytes, already here, so the preview comes from it.
 */
export interface PendingAttachment {
  /**
   * Own identity rather than keying on `relativePath`: two files with the
   * same name attached in a SINGLE action (possible via drag-and-drop from
   * two different folders) produce the same path today — a pre-existing
   * collision in attachFiles, where the second write overwrites the first.
   * Keying removal on the path would then delete both chips at once and
   * make that bug worse; a uuid keeps chip removal correct whatever the
   * paths do.
   */
  id: string;
  file: File;
  /** Exactly what goes into the message text — see attachmentReferenceText. */
  relativePath: string;
}

/**
 * Puts chips that were taken away and are being handed back — by Stop, or
 * by a failed send — in FRONT of anything attached since, minus anything
 * already there.
 *
 * Identity here is `relativePath`, NOT the uuid: a restored chip and a
 * live chip denote the same remote file exactly when they name the same
 * path, and after a restore-then-restore the uuids would no longer line
 * up anyway. Merging rather than replacing matters because two attachment
 * LISTS never actually conflict the way two draft strings do — they
 * concatenate — so "the newer one wins" (correct for the draft, see
 * handleStop) would silently throw away files whose bytes are already on
 * a possibly-remote machine, under a millisecond-timestamped directory
 * name the UI shows nowhere else.
 */
export function mergePendingAttachments(restored: PendingAttachment[], current: PendingAttachment[]): PendingAttachment[] {
  const existing = new Set(current.map((attachment) => attachment.relativePath));
  return [...restored.filter((attachment) => !existing.has(attachment.relativePath)), ...current];
}

interface PendingAttachmentsProps {
  items: PendingAttachment[];
  onRemove: (id: string) => void;
}

function PendingAttachmentChip({ item, onRemove }: { item: PendingAttachment; onRemove: (id: string) => void }) {
  const t = useT();
  // The remote file's real name, taken from the path rather than from
  // File.name: attachFiles substitutes `pasted-N.<ext>` when File.name is
  // empty, and sanitizeFileName rewrites anything separator-like in the
  // rest — so the path's last segment is the only string guaranteed to
  // match what the agent will actually find on disk.
  const name = basename(item.relativePath);
  const isImage = item.file.type.startsWith('image/');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  // Created INSIDE the effect and stored in state, not derived with
  // useMemo the way AttachmentFile does it. Under React.StrictMode (which
  // main.tsx enables) every effect runs → cleans up → runs again on mount:
  // with a useMemo'd URL the memo is not recomputed on that second run, so
  // the first cleanup's revoke would leave the <img> pointing at a URL
  // that is already dead — a blank chip in dev only. Creating the URL in
  // the effect body means the re-run makes a fresh one. (AttachmentFile
  // gets away with the memo because its URL only comes into existence
  // after an async fetch resolves, long after StrictMode's double-invoke.)
  //
  // Revoking matters more here than it looks: an un-revoked object URL
  // pins the whole Blob for the lifetime of the document, so a few pasted
  // screenshots would be held in memory forever. This cleanup covers every
  // way a chip goes away — removed by the user, cleared on send, or the
  // tile itself unmounting — because all three unmount this component.
  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(item.file);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setPreviewUrl(null);
    };
  }, [item.file, isImage]);

  const removeLabel = `${t('removeAttachment')}: ${name}`;

  return (
    <li className="tile-pending-chip">
      {isImage && previewUrl && !previewFailed ? (
        // alt="" deliberately: the file name is right next to it as real
        // text, so an alt would just make a screen reader say it twice.
        // onError is not theoretical — a picked/dropped File is a handle
        // to a path on disk, and if that file is moved or deleted between
        // the attach and the send the object URL fails to load. Falling
        // back to the generic icon chip keeps a broken-image glyph out of
        // the composer.
        <img src={previewUrl} alt="" className="tile-pending-chip-thumb" onError={() => setPreviewFailed(true)} />
      ) : (
        <LuFile size={14} className="tile-pending-chip-icon" />
      )}
      <span className="tile-pending-chip-text">
        {/* title carries the full relative path — the name alone can be
            ellipsised in a narrow tile, and the path is what the user has
            to type if they ever want to reference the file again. */}
        <span className="tile-pending-chip-name" title={item.relativePath}>
          {name}
        </span>
        <span className="tile-pending-chip-size">{formatFileSize(item.file.size)}</span>
      </span>
      <button type="button" className="tile-pending-chip-remove" onClick={() => onRemove(item.id)} title={removeLabel} aria-label={removeLabel}>
        <LuX size={12} />
      </button>
    </li>
  );
}

/**
 * The chip strip above the composer — files staged for the next message,
 * the way Claude Desktop and ChatGPT show attachments above their input.
 *
 * Not to be confused with AttachmentFile, which renders a file that is
 * already IN the transcript (a session-protocol `t:'file'` event, fetched
 * and decrypted through Happy's own blob protocol). These chips are the
 * opposite end of the lifecycle: purely local state, gone the moment the
 * message is sent, and never fetched from anywhere.
 */
export function PendingAttachments({ items, onRemove }: PendingAttachmentsProps) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    // role="list" is NOT redundant. This app ships a WKWebView build on
    // macOS, and WebKit deliberately strips the list role from any <ul>
    // whose list-style is none (which .tile-pending-attachments sets, and
    // has to — see the CSS). Without this attribute the aria-label below
    // would sit on a role-less generic container and VoiceOver would
    // announce neither the label nor the item count, while WebView2 on
    // Windows announced both. First <ul> in this codebase, so there was
    // no existing example to copy the workaround from.
    <ul role="list" className="tile-pending-attachments" aria-label={t('pendingAttachments')}>
      {items.map((item) => (
        <PendingAttachmentChip key={item.id} item={item} onRemove={onRemove} />
      ))}
    </ul>
  );
}
