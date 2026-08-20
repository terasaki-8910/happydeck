import { useEffect, useRef, useState } from 'react';
import { CLAUDE_EFFORT_LEVELS, CLAUDE_MODEL_MODES, CLAUDE_PERMISSION_MODES, compactModelLabel, permissionColorVar, translatedOptionName, type ModeOption } from '../lib/agentOptions';
import { useT, type TranslationKey } from '../lib/i18n';

interface AgentSettingsPopoverProps {
  permissionMode: string;
  modelMode: string;
  effortLevel: string;
  busy: boolean;
  onChange: (patch: { permissionMode?: string; modelMode?: string; effortLevel?: string }) => void;
}

function labelOf(t: (key: TranslationKey) => string, options: ModeOption[], key: string, isModelOption: boolean): string {
  const option = options.find((o) => o.key === key);
  return option ? translatedOptionName(t, option, isModelOption) : key;
}

type OpenMenu = 'model' | 'permission' | null;

/**
 * Compact composer-row trigger, right edge (left of send) — two separately
 * boxed badges (permission mode, model), each opening its OWN popover: the
 * model badge opens Model+Effort together (selecting either stays open, so
 * both can be set in one pass — closing after every single pick was the
 * actual complaint), the permission badge opens just Permission (a single
 * mutually-exclusive choice, so closing on select is still right there).
 * Splitting these also fixes a real clipping bug: the old combined
 * Model+Effort+Permission list (17 rows) could be taller than a narrow
 * split pane, pushing its top off-screen. Two distinct badges, not one
 * button with two spans next to each other: concatenated as "default
 * ·opus" it read as if "default" were describing the model. The model
 * badge NEVER shows the literal word "default" (see compactModelLabel) —
 * the verbose "model · effort · permission" summary lives separately,
 * below the composer box (see SessionTile), not crowded in here.
 */
export function AgentSettingsPopover({ permissionMode, modelMode, effortLevel, busy, onChange }: AgentSettingsPopoverProps) {
  const t = useT();
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [customModel, setCustomModel] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
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
  }, [openMenu]);

  const submitCustomModel = () => {
    const trimmed = customModel.trim();
    if (!trimmed) return;
    onChange({ modelMode: trimmed });
    setCustomModel('');
  };

  const section = (
    title: string,
    options: ModeOption[],
    current: string,
    key: 'permissionMode' | 'modelMode' | 'effortLevel',
    closeOnSelect: boolean,
  ) => (
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
              if (closeOnSelect) setOpenMenu(null);
            }}
          >
            <span>{translatedOptionName(t, option, false)}</span>
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
          onClick={() => setOpenMenu((v) => (v === 'permission' ? null : 'permission'))}
        >
          {labelOf(t, CLAUDE_PERMISSION_MODES, permissionMode, false)}
        </button>
        <button
          type="button"
          className="agent-settings-badge agent-settings-badge-model"
          disabled={busy}
          onClick={() => setOpenMenu((v) => (v === 'model' ? null : 'model'))}
        >
          {compactModelLabel(modelMode)}
        </button>
      </div>

      {openMenu === 'model' && (
        <div className="session-menu-popover agent-settings-popover" onClick={(event) => event.stopPropagation()}>
          <div className="agent-settings-section">
            <span className="session-menu-label">{t('modelLabel')}</span>
            {CLAUDE_MODEL_MODES.map((option) => (
              <button
                key={option.key}
                type="button"
                className="agent-settings-row"
                disabled={busy}
                onClick={() => onChange({ modelMode: option.key })}
              >
                <span>{translatedOptionName(t, option, true)}</span>
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
                placeholder={t('customModelIdPlaceholder')}
                onChange={(event) => setCustomModel(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  submitCustomModel();
                }}
              />
              <button type="button" disabled={busy || !customModel.trim()} onClick={submitCustomModel}>
                {t('customModelUse')}
              </button>
            </div>
          </div>
          <div className="session-menu-divider" />
          {section(t('reasoningEffort'), CLAUDE_EFFORT_LEVELS, effortLevel, 'effortLevel', false)}
        </div>
      )}

      {openMenu === 'permission' && (
        <div className="session-menu-popover agent-settings-popover" onClick={(event) => event.stopPropagation()}>
          {section(t('permissionLabel'), CLAUDE_PERMISSION_MODES, permissionMode, 'permissionMode', true)}
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
  const t = useT();
  return (
    <div className="tile-composer-caption">
      <span className="tile-composer-caption-path">{path}</span>
      <span className="tile-composer-caption-modes">
        {labelOf(t, CLAUDE_MODEL_MODES, modelMode, true)} · {labelOf(t, CLAUDE_EFFORT_LEVELS, effortLevel, false)} · {labelOf(t, CLAUDE_PERMISSION_MODES, permissionMode, false)}
      </span>
    </div>
  );
}
