import { useEffect, useRef, useState } from 'react';
import { CLAUDE_EFFORT_LEVELS, CLAUDE_MODEL_MODES, CLAUDE_PERMISSION_MODES, compactModelLabel, permissionColorVar, type ModeOption } from '../lib/agentOptions';

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

/**
 * Compact composer-row trigger, right edge (left of send) — two separately
 * boxed badges (permission mode, model), each opening the same full
 * Model/Effort/Permission popover upward. Two distinct badges, not one
 * button with two spans next to each other: concatenated as "default
 * ·opus" it read as if "default" were describing the model. The model
 * badge NEVER shows the literal word "default" (see compactModelLabel) —
 * the verbose "model · effort · permission" summary lives separately,
 * below the composer box (see SessionTile), not crowded in here.
 */
export function AgentSettingsPopover({ permissionMode, modelMode, effortLevel, busy, onChange }: AgentSettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [customModel, setCustomModel] = useState('');
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

  const submitCustomModel = () => {
    const trimmed = customModel.trim();
    if (!trimmed) return;
    onChange({ modelMode: trimmed });
    setCustomModel('');
    setOpen(false);
  };

  const section = (title: string, options: ModeOption[], current: string, key: 'permissionMode' | 'modelMode' | 'effortLevel') => (
    <div className="agent-settings-section">
      <span className="session-menu-label">{title}</span>
      {options.map((option) => {
        const colorVar = key === 'permissionMode' ? permissionColorVar(option.key) : null;
        return (
          <button
            key={option.key}
            type="button"
            className="agent-settings-row"
            disabled={busy}
            style={colorVar ? { color: `var(${colorVar})` } : undefined}
            onClick={() => {
              onChange({ [key]: option.key });
              setOpen(false);
            }}
          >
            <span>{option.name}</span>
            {option.key === current && <span className="agent-settings-check">✓</span>}
          </button>
        );
      })}
    </div>
  );

  const permissionColorVarName = permissionColorVar(permissionMode);

  return (
    <div className="session-menu agent-settings" ref={rootRef}>
      <div className="agent-settings-badges">
        <button
          type="button"
          className="agent-settings-badge agent-settings-badge-permission"
          disabled={busy}
          style={permissionColorVarName ? { color: `var(${permissionColorVarName})` } : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          {labelOf(CLAUDE_PERMISSION_MODES, permissionMode)}
        </button>
        <button type="button" className="agent-settings-badge agent-settings-badge-model" disabled={busy} onClick={() => setOpen((v) => !v)}>
          {compactModelLabel(modelMode)}
        </button>
      </div>

      {open && (
        <div className="session-menu-popover agent-settings-popover" onClick={(event) => event.stopPropagation()}>
          <div className="agent-settings-section">
            <span className="session-menu-label">Model</span>
            {CLAUDE_MODEL_MODES.map((option) => (
              <button
                key={option.key}
                type="button"
                className="agent-settings-row"
                disabled={busy}
                onClick={() => {
                  onChange({ modelMode: option.key });
                  setOpen(false);
                }}
              >
                <span>{option.name}</span>
                {option.key === modelMode && <span className="agent-settings-check">✓</span>}
              </button>
            ))}
            {!CLAUDE_MODEL_MODES.some((option) => option.key === modelMode) && (
              // The hardcoded list above (see agentOptions.ts — the Claude
              // Agent SDK doesn't report an available-models list for classic
              // sessions the way it does for other agent flavors, so there's
              // no dynamic source to read instead) will lag behind whatever
              // Anthropic actually ships. Surfacing the currently-set value
              // even when unrecognized, rather than silently hiding it as if
              // "no model" were selected.
              <button type="button" className="agent-settings-row" disabled>
                <span>{modelMode}</span>
                <span className="agent-settings-check">✓</span>
              </button>
            )}
            <div className="agent-settings-custom-model">
              <input
                type="text"
                value={customModel}
                disabled={busy}
                placeholder="custom model id…"
                onChange={(event) => setCustomModel(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  submitCustomModel();
                }}
              />
              <button type="button" disabled={busy || !customModel.trim()} onClick={submitCustomModel}>
                use
              </button>
            </div>
          </div>
          <div className="session-menu-divider" />
          {section('Effort', CLAUDE_EFFORT_LEVELS, effortLevel, 'effortLevel')}
          <div className="session-menu-divider" />
          {section('Permission', CLAUDE_PERMISSION_MODES, permissionMode, 'permissionMode')}
        </div>
      )}
    </div>
  );
}

/**
 * Status footer below the composer box, mirroring the real Claude Code
 * CLI's own status line (path | model | ...) as closely as our data
 * supports — path and model/effort/permission are all in session metadata
 * already. Context-window-used % is NOT: that's a CLI-local stat, never
 * part of anything Happy's protocol sends us for classic sessions (only
 * Rig-flavor sessions carry a contextWindow field at all, and that's a
 * static limit, not live usage) — so it's left out rather than faked.
 */
export function AgentSettingsCaption({
  path,
  permissionMode,
  modelMode,
  effortLevel,
}: {
  path: string;
  permissionMode: string;
  modelMode: string;
  effortLevel: string;
}) {
  return (
    <div className="tile-composer-caption">
      <span className="tile-composer-caption-path">{path}</span>
      <span className="tile-composer-caption-modes">
        {labelOf(CLAUDE_MODEL_MODES, modelMode)} · {labelOf(CLAUDE_EFFORT_LEVELS, effortLevel)} · {labelOf(CLAUDE_PERMISSION_MODES, permissionMode)}
      </span>
    </div>
  );
}
