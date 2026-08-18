/**
 * Hardcoded mode/model/effort option lists for classic (non-Rig) Claude Code
 * sessions — the only flavor our 4 machines run. Ported from happy-app's
 * sources/components/modelModeOptions.ts (getClaudePermissionModes /
 * getClaudeModelModes / getClaudeEffortLevels), which is itself a fixed
 * list matching what the Claude Code CLI accepts — not derived from any
 * server response for classic sessions.
 */

export interface ModeOption {
  key: string;
  name: string;
}

export const CLAUDE_PERMISSION_MODES: ModeOption[] = [
  { key: 'default', name: 'default' },
  { key: 'plan', name: 'plan' },
  { key: 'dontAsk', name: "don't ask" },
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
 * fallback (`DEFAULT_CLAUDE_MODEL = 'opus'` in claude/runClaude.ts) — not a
 * guess, but also not guaranteed to match every CLI version out there.
 */
export function compactModelLabel(modelMode: string): string {
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
export function permissionColorVar(permissionMode: string): string | null {
  if (permissionMode === 'plan') return '--permission-plan';
  if (permissionMode === 'acceptEdits') return '--permission-accept-edits';
  if (permissionMode === 'bypassPermissions') return '--permission-bypass';
  return null;
}
