import { useEffect, useRef, useState } from 'react';
import { LuPlus } from 'react-icons/lu';
import { useT } from '../lib/i18n';

interface McpServerStatus {
  name: string;
  status: string;
}

interface ComposerPlusMenuProps {
  slashCommands: string[];
  mcpServers: McpServerStatus[];
  onInsertSlashCommand: (command: string) => void;
  onAttachFile: () => void;
}

/**
 * "+" menu next to the composer. File attachment writes straight to
 * `.claude/happy-<timestamp>/` on the session's own machine via the
 * machine-scoped writeFile RPC (see lib/attachments.ts) rather than
 * Happy's own end-to-end-encrypted blob-upload protocol — that protocol's
 * reference implementation (packages/happy-app/sources/sync/
 * apiAttachments.ts) isn't present in this repo, while the machine RPC
 * path was already fully available and works cross-machine without SSH.
 */
export function ComposerPlusMenu({ slashCommands, mcpServers, onInsertSlashCommand, onAttachFile }: ComposerPlusMenuProps) {
  const t = useT();
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
    <div className="session-menu composer-plus" ref={rootRef}>
      {/* An icon, not a literal "+" character: a text glyph in a <button>
          picks up the UA stylesheet's own control font (Arial under
          Chromium/WebView2, the system font under WebKit), so the "+"
          rendered in a DIFFERENT font from the placeholder beside it — and
          two fonts' optical centres don't line up, which is what read as
          "the placeholder is vertically off" on Windows specifically.
          An SVG has no font metrics and centres geometrically in the
          flex box, identically on every platform. */}
      <button type="button" className="composer-plus-trigger" title={t('composerPlusTitle')} onClick={() => setOpen((v) => !v)}>
        <LuPlus size={16} strokeWidth={2} />
      </button>

      {open && (
        <div className="session-menu-popover composer-plus-popover" onClick={(event) => event.stopPropagation()}>
          <div className="agent-settings-section">
            <button
              type="button"
              className="agent-settings-row"
              onClick={() => {
                onAttachFile();
                setOpen(false);
              }}
            >
              {t('attachFile')}
            </button>
          </div>
          <div className="session-menu-divider" />
          <div className="agent-settings-section">
            <span className="session-menu-label">{t('slashCommands')}</span>
            {slashCommands.length === 0 && <p className="composer-plus-empty">{t('slashCommandsNoneAvailable')}</p>}
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
            <span className="session-menu-label">{t('mcpServers')}</span>
            {mcpServers.length === 0 && <p className="composer-plus-empty">{t('mcpServersNoneConnected')}</p>}
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
