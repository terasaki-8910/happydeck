/** Windows paths (`D:\gta5-modding`) show up alongside POSIX ones (`/Users/...`) across the 4 machines — detect per-path, not globally. */
function separatorOf(path: string): '/' | '\\' {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

export function joinPath(path: string, name: string): string {
  const sep = separatorOf(path);
  return path.endsWith(sep) ? `${path}${name}` : `${path}${sep}${name}`;
}

/** Last path segment (`/Users/dev/project/multiMonitor` -> `multiMonitor`) — for a display label that fits a narrow sidebar row; the full path stays available in the row's title tooltip. */
export function basename(path: string): string {
  const sep = separatorOf(path);
  const trimmed = path.replace(/[/\\]+$/, '');
  const idx = trimmed.lastIndexOf(sep);
  return idx === -1 ? trimmed : trimmed.slice(idx + 1) || trimmed;
}

export function parentPath(path: string): string {
  const sep = separatorOf(path);
  const trimmed = path.replace(/[/\\]+$/, '');
  const idx = trimmed.lastIndexOf(sep);
  if (idx <= 0) {
    if (sep === '\\' && /^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\`;
    return sep === '\\' ? trimmed : '/';
  }
  return trimmed.slice(0, idx) || sep;
}
