import { useEffect, useState } from 'react';
import type { DirectoryEntry } from 'happy-client';
import { joinPath, parentPath } from '../lib/paths';
import { useHappyStore } from '../store/happyStore';

interface DirectoryBrowserProps {
  machineId: string;
  /** Needed to pick the right shell syntax for "New folder" — `mkdir` differs between Windows and everything else. */
  platform: string;
  startPath: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}

/**
 * Browses the machine daemon's filesystem (machineListDirectory — NOT
 * sandboxed to any session's cwd, so this works with zero sessions running
 * on the target machine yet). Used to pick a directory for a brand new
 * session without having to already know the remote layout.
 */
export function DirectoryBrowser({ machineId, platform, startPath, onSelect, onCancel }: DirectoryBrowserProps) {
  const listMachineDirectory = useHappyStore((s) => s.listMachineDirectory);
  const createMachineDirectory = useHappyStore((s) => s.createMachineDirectory);
  const [path, setPath] = useState(startPath);
  const [entries, setEntries] = useState<DirectoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingBusy, setCreatingBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMachineDirectory(machineId, path).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.success) {
        setEntries([...result.entries].filter((e) => e.type === 'directory').sort((a, b) => a.name.localeCompare(b.name)));
      } else {
        setEntries(null);
        setError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [machineId, path, listMachineDirectory]);

  const submitNewFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      setCreatingFolder(false);
      return;
    }
    setCreatingBusy(true);
    setError(null);
    const result = await createMachineDirectory(machineId, joinPath(path, name), platform);
    setCreatingBusy(false);
    if (result.success) {
      setCreatingFolder(false);
      setNewFolderName('');
      setPath(joinPath(path, name));
    } else {
      setError(result.error);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape backs out of the new-folder input first, not the whole dialog.
      if (creatingFolder) setCreatingFolder(false);
      else onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, creatingFolder]);

  return (
    <div className="confirm-backdrop" onClick={onCancel}>
      <div className="browser-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="browser-path-row">
          <button type="button" className="browser-up" title="Up one level" onClick={() => setPath(parentPath(path))}>
            ↑
          </button>
          <input
            className="browser-path-input"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setPath(path);
            }}
          />
          <button type="button" className="browser-new-folder" title="New folder" onClick={() => setCreatingFolder(true)}>
            + new folder
          </button>
        </div>

        {creatingFolder && (
          // A plain div, not <form> — DirectoryBrowser renders inside
          // SpawnPanel's own <form>, and nested <form> elements are
          // invalid HTML (React warns, and submit-event bubbling between
          // the two gets unpredictable).
          <div className="browser-new-folder-row">
            <input
              autoFocus
              className="browser-path-input"
              value={newFolderName}
              placeholder="folder name"
              disabled={creatingBusy}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submitNewFolder();
                }
              }}
            />
            <button type="button" className="browser-new-folder-create" disabled={creatingBusy || !newFolderName.trim()} onClick={submitNewFolder}>
              create
            </button>
            <button type="button" onClick={() => setCreatingFolder(false)}>
              cancel
            </button>
          </div>
        )}

        <div className="browser-entries">
          {loading && <p className="app-message">loading…</p>}
          {error && <p className="app-message app-message-error">{error}</p>}
          {!loading && !error && entries?.length === 0 && <p className="app-message">(no subdirectories)</p>}
          {!loading &&
            entries?.map((entry) => (
              <button key={entry.name} type="button" className="browser-entry" onClick={() => setPath(joinPath(path, entry.name))}>
                <svg className="browser-entry-icon" viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
                  <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.379a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 3.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V3Z" />
                </svg>
                {entry.name}
              </button>
            ))}
        </div>

        <div className="confirm-actions">
          <button type="button" className="confirm-cancel" onClick={onCancel}>
            cancel
          </button>
          <button type="button" className="confirm-ok" onClick={() => onSelect(path)}>
            select this folder
          </button>
        </div>
      </div>
    </div>
  );
}
