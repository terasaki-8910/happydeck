import { useState } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';

export function TabBar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');

  const submitNewWorkspace = () => {
    const name = draftName.trim();
    if (name) {
      createWorkspace(name);
    }
    setDraftName('');
    setCreating(false);
  };

  return (
    <nav className="tab-bar">
      <button type="button" className={`tab ${activeWorkspaceId === null ? 'tab-active' : ''}`} onClick={() => setActiveWorkspace(null)}>
        All
      </button>

      {workspaces.map((workspace) => (
        <div key={workspace.id} className={`tab tab-workspace ${activeWorkspaceId === workspace.id ? 'tab-active' : ''}`}>
          <button type="button" className="tab-label" onClick={() => setActiveWorkspace(workspace.id)}>
            {workspace.name}
          </button>
          <button
            type="button"
            className="tab-delete"
            title={`Delete "${workspace.name}"`}
            onClick={(event) => {
              event.stopPropagation();
              deleteWorkspace(workspace.id);
            }}
          >
            ×
          </button>
        </div>
      ))}

      {creating ? (
        <input
          autoFocus
          className="tab-new-input"
          value={draftName}
          placeholder="workspace name"
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitNewWorkspace();
            if (event.key === 'Escape') {
              setDraftName('');
              setCreating(false);
            }
          }}
          onBlur={submitNewWorkspace}
        />
      ) : (
        <button type="button" className="tab tab-new" onClick={() => setCreating(true)}>
          + new tab
        </button>
      )}
    </nav>
  );
}
