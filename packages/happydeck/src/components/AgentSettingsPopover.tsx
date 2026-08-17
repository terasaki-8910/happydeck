import { useEffect, useRef, useState } from 'react';
import { CLAUDE_EFFORT_LEVELS, CLAUDE_MODEL_MODES, CLAUDE_PERMISSION_MODES, type ModeOption } from '../lib/agentOptions';

interface AgentSettingsPopoverProps {
  permissionMode: string;
  modelMode: string;
  effortLevel: string;
  busy: boolean;
  onChange: (patch: { permissionMode?: string; modelMode?: string; effortLevel?: string }) => void;
}

function labelOf(options: ModeOption[], key: string): string {
  return options.find((o) => o.key === key)?.name ?? key;
}

/** Replaces 3 separate <select>s with one popover (model/effort/permission), Claude-app style. */
export function AgentSettingsPopover({ permissionMode, modelMode, effortLevel, busy, onChange }: AgentSettingsPopoverProps) {
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

  const summary = `${labelOf(CLAUDE_MODEL_MODES, modelMode)} · ${labelOf(CLAUDE_EFFORT_LEVELS, effortLevel)} · ${labelOf(CLAUDE_PERMISSION_MODES, permissionMode)}`;

  const section = (title: string, options: ModeOption[], current: string, key: 'permissionMode' | 'modelMode' | 'effortLevel') => (
    <div className="agent-settings-section">
      <span className="session-menu-label">{title}</span>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className="agent-settings-row"
          disabled={busy}
          onClick={() => {
            onChange({ [key]: option.key });
            setOpen(false);
          }}
        >
          <span>{option.name}</span>
          {option.key === current && <span className="agent-settings-check">✓</span>}
        </button>
      ))}
    </div>
  );

  return (
    <div className="session-menu agent-settings" ref={rootRef}>
      <button type="button" className="agent-settings-trigger" disabled={busy} onClick={() => setOpen((v) => !v)}>
        {summary}
      </button>

      {open && (
        <div className="session-menu-popover agent-settings-popover" onClick={(event) => event.stopPropagation()}>
          {section('Model', CLAUDE_MODEL_MODES, modelMode, 'modelMode')}
          <div className="session-menu-divider" />
          {section('Effort', CLAUDE_EFFORT_LEVELS, effortLevel, 'effortLevel')}
          <div className="session-menu-divider" />
          {section('Permission', CLAUDE_PERMISSION_MODES, permissionMode, 'permissionMode')}
        </div>
      )}
    </div>
  );
}
