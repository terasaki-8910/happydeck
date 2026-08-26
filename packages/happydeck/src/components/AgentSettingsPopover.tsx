import { useEffect, useRef, useState } from 'react';
import { LuBrain, LuShield } from 'react-icons/lu';
import { CLAUDE_EFFORT_LEVELS, CLAUDE_MODEL_MODES, CLAUDE_PERMISSION_MODES, compactModelLabel, permissionColorVar, translatedOptionName, type ModeOption } from '../lib/agentOptions';
import { useT, type TranslationKey } from '../lib/i18n';

interface AgentSettingsPopoverProps {
  /**
   * undefined means "this session has no recorded value for it", which is
   * NOT the same as the value 'default' — nothing in happy-cli ever writes
   * these three fields into session metadata (see compactModelLabel), so
   * only a session spawned by this app, or one whose mode was picked in
   * this very popover, has them at all. They used to arrive here coerced
   * to 'default'/'default'/'medium' by SessionTile, which made every
   * externally-started session claim mode values nobody had ever set.
   */
  permissionMode: string | undefined;
  modelMode: string | undefined;
  effortLevel: string | undefined;
  busy: boolean;
  onChange: (patch: { permissionMode?: string; modelMode?: string; effortLevel?: string }) => void;
}

function labelOf(t: (key: TranslationKey) => string, options: ModeOption[], key: string | undefined, isModelOption: boolean): string {
  if (!key) return t('modeUnknown');
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
 *
 * In a NARROW pane both badges drop their text and become 24px icon
 * squares, driven purely by a container query on .tile-composer (see
 * App.css) — no JS, no ResizeObserver. Reason: both badges are
 * flex-shrink:0 with nowrap, so they reserved the same strip at every
 * pane width and the textarea — the row's only flex:1 item — absorbed
 * 100% of the shortfall. Measured in a browser, not derived: the
 * expanded badges + "+" + send + gaps cost 228px of the composer's
 * content box; collapsed they cost 120px.
 *
 * Collapsing to ICONS rather than merging the two badges into one is
 * deliberate: merging is precisely what the paragraph above records as
 * already tried and reverted, and a single badge would either reopen the
 * 17-row clipping bug or add a disambiguation click. Nothing is truly
 * hidden by the icon form — AgentSettingsCaption below the composer box
 * prints the same three values as full translated text, unconditionally.
 *
 * That caption is not decoration, it is the collapsed form's fallback:
 * permissionColorVar returns null for BOTH 'default' and 'dontAsk' (see
 * agentOptions.ts), so with the label gone those two modes render as the
 * same undifferentiated grey shield. Do NOT "fix" that by inventing a
 * colour for dontAsk — agentOptions.ts records leaving it uncoloured as a
 * deliberate choice, because happy-app's own theme has no entry for it.
 * The caption and the title/aria-label below are the disambiguators.
 *
 * aria-label/title are set at EVERY width, not just the collapsed one, so
 * the accessible name is identical in both forms and doesn't silently
 * appear/disappear on a resize. They're composed from the existing
 * permissionLabel/modelLabel dictionary keys instead of new entries —
 * those are the same words the popover headings use, so they can't drift
 * out of sync with them.
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
    // undefined = nothing recorded, so no row gets a checkmark: "we don't
    // know which of these is in effect" reads correctly as an unselected
    // list, whereas checking a guessed row would not.
    current: string | undefined,
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
  const modelBadgeLabel = compactModelLabel(modelMode);
  // Badge face vs accessible name are separate concerns here. The face
  // shrinks (text -> em dash when unrecorded, and -> icon-only in a narrow
  // pane, via CSS); the accessible name never does, so screen readers and
  // hover get the same full sentence at every width and in every state.
  const permissionText = permissionMode ? labelOf(t, CLAUDE_PERMISSION_MODES, permissionMode, false) : t('modeUnknown');
  const modelText = modelBadgeLabel ?? t('modeUnknown');
  // acceptEdits is the one mode whose label is accurate but reads as
  // "accept everything": happy-cli's getToolDescriptor
  // (dist/index-BmZ4or3w.mjs:1839) marks only Edit/MultiEdit/Write/
  // NotebookEdit as edits, so Bash keeps prompting, exactly as in Claude
  // Code itself. A native title rather than helper text under the composer:
  // this is a once-per-user surprise, not something worth permanent chrome,
  // and the other four modes need no gloss.
  const permissionTitle = !permissionMode
    ? t('modeUnknownHint')
    : permissionMode === 'acceptEdits'
      ? `${t('permissionLabel')}: ${permissionText} — ${t('permHintAcceptEdits')}`
      : `${t('permissionLabel')}: ${permissionText}`;
  const modelTitle = modelBadgeLabel ? `${t('modelLabel')}: ${modelText}` : t('modeUnknownHint');

  return (
    <div className="session-menu agent-settings" ref={rootRef}>
      <div className="agent-settings-badges">
        <button
          type="button"
          className={`agent-settings-badge agent-settings-badge-permission${permissionMode ? '' : ' agent-settings-badge-unset'}`}
          disabled={busy}
          style={permissionColorVarName ? { color: `var(${permissionColorVarName})` } : undefined}
          title={permissionTitle}
          aria-label={`${t('permissionLabel')}: ${permissionText}`}
          onClick={() => setOpenMenu((v) => (v === 'permission' ? null : 'permission'))}
        >
          {/* A plain shield, NOT LuShieldCheck (which is also available in
              this icon set): a check mark asserts "you're protected,"
              which is a flat lie under bypassPermissions. The severity
              signal stays where it already was — the inline color from
              permissionColorVar, which the icon inherits unchanged. Note
              that signal only exists for plan/acceptEdits/bypass; see the
              block comment above for why default and dontAsk stay grey. */}
          <LuShield className="agent-settings-badge-icon" size={13} strokeWidth={2} />
          <span className="agent-settings-badge-text">{permissionText}</span>
        </button>
        <button
          type="button"
          className={`agent-settings-badge agent-settings-badge-model${modelBadgeLabel ? '' : ' agent-settings-badge-unset'}`}
          disabled={busy}
          title={modelTitle}
          aria-label={`${t('modelLabel')}: ${modelText}`}
          onClick={() => setOpenMenu((v) => (v === 'model' ? null : 'model'))}
        >
          <LuBrain className="agent-settings-badge-icon" size={13} strokeWidth={2} />
          <span className="agent-settings-badge-text">{modelText}</span>
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
            {modelMode && !CLAUDE_MODEL_MODES.some((option) => option.key === modelMode) && (
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
  // Same undefined-means-unrecorded contract as AgentSettingsPopoverProps.
  permissionMode: string | undefined;
  modelMode: string | undefined;
  effortLevel: string | undefined;
}) {
  const t = useT();
  // The all-absent case is not the rare one — happy-cli writes none of these
  // three, so every session this app did not spawn hits it. Rendering
  // labelOf three times there produced "not recorded · not recorded · not
  // recorded", which is noise, so it collapses to a single phrase. A
  // PARTIALLY recorded session keeps all three slots, because dropping the
  // missing ones would silently change what the remaining words refer to.
  const anyRecorded = Boolean(modelMode || effortLevel || permissionMode);
  const allRecorded = Boolean(modelMode && effortLevel && permissionMode);
  return (
    <div className="tile-composer-caption">
      <span className="tile-composer-caption-path">{path}</span>
      <span className="tile-composer-caption-modes" title={allRecorded ? undefined : t('modeUnknownHint')}>
        {anyRecorded ? (
          <>
            {labelOf(t, CLAUDE_MODEL_MODES, modelMode, true)} · {labelOf(t, CLAUDE_EFFORT_LEVELS, effortLevel, false)} · {labelOf(t, CLAUDE_PERMISSION_MODES, permissionMode, false)}
          </>
        ) : (
          t('modeUnknown')
        )}
      </span>
    </div>
  );
}
