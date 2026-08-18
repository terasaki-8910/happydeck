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
  // opusplan/fableplan aren't in the happy-app reference this file otherwise
  // mirrors exactly — added on the user's own request, not independently
  // verified against a CLI source. If Claude Code rejects either key, that'll
  // surface as an agent-side error, not a happydeck bug.
  { key: 'opusplan', name: 'opusplan (opus + sonnet)' },
  { key: 'fableplan', name: 'fableplan (fable + opus + sonnet)' },
];

export const CLAUDE_EFFORT_LEVELS: ModeOption[] = [
  { key: 'low', name: 'low' },
  { key: 'medium', name: 'medium' },
  { key: 'high', name: 'high' },
  { key: 'xhigh', name: 'xhigh' },
  { key: 'max', name: 'max' },
];
