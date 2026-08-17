import { useEffect, useRef, useState } from 'react';

interface McpServerStatus {
  name: string;
  status: string;
}

interface ComposerPlusMenuProps {
  slashCommands: string[];
  mcpServers: McpServerStatus[];
  onInsertSlashCommand: (command: string) => void;
}

/**
 * "+" menu next to the composer. File attachment isn't wired up yet — the
 * upload protocol (2-step: request a blob upload slot, then PUT the
 * encrypted bytes) isn't fully recoverable from the reference client
 * source in this repo (packages/happy-app/sources/sync/apiAttachments.ts
 * is referenced but missing), so it needs live protocol probing before
 * it can be built safely. Slash commands and MCP status are both already
 * in session metadata happydeck fetches, so those work today.
 */
export function ComposerPlusMenu({ slashCommands, mcpServers, onInsertSlashCommand }: ComposerPlusMenuProps) {
  const [open, setOpen] = useState(false);
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
    <div className="session-menu composer-plus" ref={rootRef}>
      <button type="button" className="composer-plus-trigger" title="Slash commands, MCP status" onClick={() => setOpen((v) => !v)}>
        +
      </button>

      {open && (
        <div className="session-menu-popover composer-plus-popover" onClick={(event) => event.stopPropagation()}>
          <div className="agent-settings-section">
            <span className="session-menu-label">Slash commands</span>
            {slashCommands.length === 0 && <p className="composer-plus-empty">none available for this session</p>}
            {slashCommands.map((command) => (
              <button
                key={command}
                type="button"
                className="agent-settings-row"
                onClick={() => {
                  onInsertSlashCommand(command);
                  setOpen(false);
                }}
              >
                /{command}
              </button>
            ))}
          </div>
          <div className="session-menu-divider" />
          <div className="agent-settings-section">
            <span className="session-menu-label">MCP servers</span>
            {mcpServers.length === 0 && <p className="composer-plus-empty">none connected</p>}
            {mcpServers.map((server) => (
              <div key={server.name} className="composer-plus-mcp-row">
                <span>{server.name}</span>
                <span className="composer-plus-mcp-status">{server.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
