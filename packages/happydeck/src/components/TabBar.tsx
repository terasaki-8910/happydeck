import { type DragEvent, useState } from 'react';
import { SESSION_DRAG_MIME } from '../lib/dnd';
import { useViewStore } from '../store/viewStore';
import { useWorkspaceStore } from '../store/workspaceStore';

export function TabBar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const addSessionToWorkspace = useWorkspaceStore((s) => s.addSessionToWorkspace);
  const showGrid = useViewStore((s) => s.showGrid);

  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const submitNewWorkspace = () => {
    const name = draftName.trim();
    if (name) {
      createWorkspace(name);
    }
    setDraftName('');
    setCreating(false);
  };

  const acceptDrag = (event: DragEvent) => {
    if (event.dataTransfer.types.includes(SESSION_DRAG_MIME)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  const dropOntoWorkspace = (event: DragEvent, workspaceId: string) => {
    event.preventDefault();
    setDragOverId(null);
    const sessionId = event.dataTransfer.getData(SESSION_DRAG_MIME);
    if (sessionId) {
      addSessionToWorkspace(workspaceId, sessionId);
      setActiveWorkspace(workspaceId);
      showGrid();
    }
  };

  return (
    <nav className="tab-bar">
      <button
        type="button"
        className={`tab ${activeWorkspaceId === null ? 'tab-active' : ''}`}
        onClick={() => {
          setActiveWorkspace(null);
          showGrid();
        }}
      >
        All
      </button>

      {workspaces.map((workspace) => (
        <div
          key={workspace.id}
          className={`tab tab-workspace ${activeWorkspaceId === workspace.id ? 'tab-active' : ''} ${dragOverId === workspace.id ? 'tab-drop-target' : ''}`}
          onDragOver={acceptDrag}
          onDragEnter={() => setDragOverId(workspace.id)}
          onDragLeave={() => setDragOverId((current) => (current === workspace.id ? null : current))}
          onDrop={(event) => dropOntoWorkspace(event, workspace.id)}
        >
          <button
            type="button"
            className="tab-label"
            title="Click to view. Drag a session here from the sidebar to add it."
            onClick={() => {
              setActiveWorkspace(workspace.id);
              showGrid();
            }}
          >
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
