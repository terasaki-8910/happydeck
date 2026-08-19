import { joinPath } from './paths';

// Clipboard-pasted images generally arrive as a File with no useful name
// (browsers commonly hand back "image.png" regardless of source, or an
// empty string) — the extension still has to come from the MIME type.
const EXTENSION_FOR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export function extensionForMimeType(mime: string): string {
  return EXTENSION_FOR_MIME[mime] ?? 'bin';
}

// File-picker names come from the OS's own dialog, already filesystem-safe.
// Clipboard-derived names are less trustworthy — strip anything that could
// act as a path separator or otherwise escape the target directory.
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[/\\]+/g, '_').trim();
  return cleaned || 'file';
}

// Human-readable, still sortable, still millisecond-unique (this Mac's own
// local clock — happydeck computes it client-side, not on whichever remote
// machine the attachment actually lands on) — a raw Date.now() here read as
// "the folder name is wrong" when actually inspected on disk, since there's
// no way to tell at a glance that a 13-digit number is an epoch ms value.
function formatTimestampForDirName(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}

/**
 * Where an attachment lands: `.claude/happy-<timestamp>/<filename>` under
 * the session's own working directory — the user's own explicit choice
 * (`.claude` is already gitignored in their projects; `.happy` likely
 * isn't). One fresh timestamped directory per attach action (file picks
 * and a paste each get their own), so concurrent attachments never
 * collide and nothing needs cleanup/collision handling.
 */
export function buildAttachmentDir(cwd: string, timestamp: number): string {
  return joinPath(joinPath(cwd, '.claude'), `happy-${formatTimestampForDirName(timestamp)}`);
}

export function buildAttachmentPath(attachDir: string, fileName: string): string {
  return joinPath(attachDir, sanitizeFileName(fileName));
}

/** Relative form (attachDir already lives under cwd) — what actually gets referenced in the message text, shorter and still unambiguous to the agent's own file tools. */
export function relativeAttachmentPath(cwd: string, attachDir: string, fileName: string): string {
  const dirName = attachDir.slice(cwd.length).replace(/^[/\\]+/, '');
  return joinPath(dirName, sanitizeFileName(fileName));
}
