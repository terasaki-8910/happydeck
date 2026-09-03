/**
 * Hardcoded mode/model/effort option lists for classic (non-Rig) Claude Code
 * sessions — the only flavor our 4 machines run. Ported from happy-app's
 * sources/components/modelModeOptions.ts (getClaudePermissionModes /
 * getClaudeModelModes / getClaudeEffortLevels), which is itself a fixed
 * list matching what the Claude Code CLI accepts — not derived from any
 * server response for classic sessions.
 */

import type { TranslationKey } from './i18n';

export interface ModeOption {
  key: string;
  name: string;
}

/**
 * happy-cli's own equivalence check (dist/index-BmZ4or3w.mjs,
 * `isClaudeBypassEquivalent`): `resolveRemoteClaudePermissionMode` silently
 * IGNORES a downgrade from either of these straight to 'default' —
 * `if (isClaudeBypassEquivalent(currentMode) && nextMode === "default")
 * return currentMode;` — with no signal back to any client that it
 * happened. Picking 'default' while in bypass therefore updates the badge
 * to a value the running agent silently never adopts, and nothing in this
 * app can detect that mismatch after the fact (no event, no metadata
 * change). 'plan' and 'acceptEdits' are NOT caught by that guard and do
 * work as an exit. See CLAUDE_PERMISSION_MODES' filtering of 'default' for
 * where this is used to keep the picker from offering the trap at all.
 */
export function isClaudeBypassEquivalent(permissionMode: string | undefined): boolean {
  return permissionMode === 'bypassPermissions' || permissionMode === 'yolo';
}

// 'dontAsk' was here and is deliberately gone (2026-09-04). It could never
// have worked in either direction: it isn't in happy-cli's own
// VALID_PERMISSION_MODES (dist/index-BmZ4or3w.mjs:1403-1411), and
// buildAgentMessageMeta's allowlist (lib/agentMessageMeta.ts) omits it too,
// so picking it wrote metadata, repainted the badge as "don't ask", and sent
// the agent nothing at all — a mode the UI claimed to be in and no process
// ever was. Don't re-add it without a happy-cli that accepts it.
export const CLAUDE_PERMISSION_MODES: ModeOption[] = [
  { key: 'default', name: 'default' },
  { key: 'plan', name: 'plan' },
  { key: 'acceptEdits', name: 'accept edits' },
  { key: 'bypassPermissions', name: 'bypass (yolo)' },
];

export const CLAUDE_MODEL_MODES: ModeOption[] = [
  { key: 'default', name: 'default model' },
  { key: 'claude-opus-5', name: 'opus 5' },
  { key: 'opus', name: 'opus 4.8' },
  { key: 'fable', name: 'fable 5' },
  { key: 'sonnet', name: 'sonnet 4.6' },
  { key: 'haiku', name: 'haiku 4.5' },
  // opusplan: not in the happy-app reference's hardcoded list either, but a
  // real, documented Claude Code CLI mode (Opus for planning, Sonnet for
  // execution) as far as general knowledge goes — kept.
  { key: 'opusplan', name: 'opusplan (opus + sonnet)' },
  // fableplan was here too, added purely on request with no verification at
  // all (not in the reference, and no independent confirmation it's a real
  // accepted CLI value, unlike opusplan) -- removed rather than ship a
  // likely-broken option. Re-add if you've actually seen it work.
];

export const CLAUDE_EFFORT_LEVELS: ModeOption[] = [
  { key: 'low', name: 'low' },
  { key: 'medium', name: 'medium' },
  { key: 'high', name: 'high' },
  { key: 'xhigh', name: 'xhigh' },
  { key: 'max', name: 'max' },
];

/**
 * Short, composer-pill-friendly model name — never the literal "default"
 * (per explicit request: always show what it concretely resolves to), and
 * collapses opus-5/opus-4.8 into one "opus" label (explicitly OK'd — the
 * full popover list below still keeps them separate as real distinct
 * --model values).
 *
 * The "default" resolution to 'opus' is sourced from happy-cli's own
 * fallback (`DEFAULT_CLAUDE_MODEL = 'opus'`, re-confirmed in the installed
 * bundle at dist/index-BmZ4or3w.mjs:6452) — not a guess, but also not
 * guaranteed to match every CLI version out there. Note it is only sound
 * for a modelMode that is EXPLICITLY 'default': that is the one case where
 * we know no --model was passed and the CLI fell back.
 *
 * Returns null when modelMode is absent, which is a genuinely different
 * thing that used to be collapsed into the same branch. happy-cli never
 * writes modelMode into session metadata at all (it appears only in the
 * spawn request path — the RPC params at types-CV0guBiJ.mjs:4486 and
 * appendDaemonSpawnModeArgs at index-BmZ4or3w.mjs:5550), so a session this
 * app didn't spawn simply has no recorded model. Answering 'opus' there
 * stated a fact we do not have. Substituting the user's own happydeck
 * default instead would be the same mistake in a new place — that setting
 * describes what the NEXT spawn will request. Callers render null as an
 * explicit "not recorded".
 */
export function compactModelLabel(modelMode: string | undefined): string | null {
  if (!modelMode) return null;
  if (modelMode === 'default') return 'opus';
  if (modelMode === 'claude-opus-5' || modelMode === 'opus') return 'opus';
  return modelMode;
}

/**
 * The CSS custom-property name for a permission mode's official Claude Code
 * color, or null for a mode with no official color (rendered as the usual
 * neutral text color instead of inventing one). Sourced from happy-app's
 * theme.ts (theme.colors.permission.*), not guessed — notably "plan" is
 * green there, not blue/cyan. "dontAsk" has no entry in that source either
 * (Claude-specific, outside the semantic-kind set that gets colored), so
 * it's left null rather than assigned an unverified color.
 */
export function permissionColorVar(permissionMode: string | undefined): string | null {
  if (permissionMode === 'plan') return '--permission-plan';
  if (permissionMode === 'acceptEdits') return '--permission-accept-edits';
  if (permissionMode === 'bypassPermissions') return '--permission-bypass';
  return null;
}

// Permission-mode and effort-level names are plain descriptive words, so
// they're translated. Model names (opus 5, sonnet 4.6, ...) are product
// names, not translated, EXCEPT the generic "default model" entry, which
// describes a choice rather than naming a specific model — matches how
// Claude's own desktop app localizes "エフォート" (effort) labels but
// keeps model names themselves untranslated.
const OPTION_NAME_KEY: Record<string, TranslationKey> = {
  default: 'permOptDefault',
  plan: 'permOptPlan',
  dontAsk: 'permOptDontAsk',
  acceptEdits: 'permOptAcceptEdits',
  bypassPermissions: 'permOptBypass',
  low: 'effortOptLow',
  medium: 'effortOptMedium',
  high: 'effortOptHigh',
  xhigh: 'effortOptXhigh',
  max: 'effortOptMax',
};

/** Translated display name for a Model/Effort/Permission option, falling
 * back to its English `name` for model options (untranslated by design)
 * and any value not in OPTION_NAME_KEY (e.g. a typed-in custom model id). */
export function translatedOptionName(t: (key: TranslationKey) => string, option: ModeOption, isModelOption: boolean): string {
  if (isModelOption && option.key === 'default') return t('modelOptDefault');
  const key = isModelOption ? undefined : OPTION_NAME_KEY[option.key];
  return key ? t(key) : option.name;
}
