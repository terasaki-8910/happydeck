/**
 * Parses the raw stdout of `claude -p "/usage" --output-format json` (see
 * src-tauri/src/claude_usage.rs) into structured usage windows.
 *
 * `/usage` is an undocumented, REPL-oriented slash command — this is prose
 * meant for a human terminal, not a stable machine contract, so a future
 * Claude Code release can change its wording without notice. Failing soft
 * (returning fewer windows, or none) is the deliberate response to any
 * shape this doesn't recognize — never show a half-parsed or guessed number.
 */

import type { Language } from '../store/settingsStore';
import { translate } from './i18n';

export type UsageWindow =
  | { kind: 'session'; modelLabel: null; percent: number; resets: string }
  | { kind: 'week'; modelLabel: string; percent: number; resets: string };

/** Stable identity for a window within one reset period — changes automatically once `resets` rolls over. */
export function windowKey(w: UsageWindow): string {
  return `${w.kind}:${w.modelLabel ?? ''}:${w.resets}`;
}

/**
 * modelLabel ("Fable", "all models", ...) comes straight from the CLI's own
 * prose and isn't translated — same treatment BulkKillMenu gives machine/
 * workspace names ("user data, not translatable"), so only the session
 * case is a flat i18n lookup.
 */
export function usageWindowLabel(language: Language, w: UsageWindow): string {
  if (w.kind === 'session') return translate(language, 'usageWindowSession');
  return language === 'ja' ? `週間（${w.modelLabel}）` : `Weekly (${w.modelLabel})`;
}

// The separator between "N% used" and "resets ..." is U+00B7 MIDDLE DOT
// (confirmed against real CLI output), not a hyphen or bullet.
const SESSION_LINE = /^Current session: (\d+)% used · resets (.+)$/;
const WEEK_LINE = /^Current week \(([^)]+)\): (\d+)% used · resets (.+)$/;

/**
 * `claude -p ... --output-format json` prints one JSON object to stdout.
 * Tried as a whole first (the common case); falls back to scanning lines
 * from the end for a bare `{"type":"result",...}` object in case a future
 * CLI version interleaves other output on stdout.
 */
function extractResultText(rawStdout: string): string | null {
  const trimmed = rawStdout.trim();
  if (!trimmed) return null;

  const direct = tryParseResult(trimmed);
  if (direct !== null) return direct;

  const lines = trimmed.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const found = tryParseResult(lines[i].trim());
    if (found !== null) return found;
  }
  return null;
}

function tryParseResult(candidate: string): string | null {
  if (!candidate) return null;
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && 'type' in parsed && (parsed as { type: unknown }).type === 'result' && 'result' in parsed && typeof (parsed as { result: unknown }).result === 'string') {
      return (parsed as { result: string }).result;
    }
  } catch {
    // Not JSON — fine, the caller tries the next candidate.
  }
  return null;
}

export function parseUsage(rawStdout: string): UsageWindow[] {
  const resultText = extractResultText(rawStdout);
  if (!resultText) return [];

  const windows: UsageWindow[] = [];
  for (const line of resultText.split('\n')) {
    const trimmed = line.trim();
    const session = trimmed.match(SESSION_LINE);
    if (session) {
      windows.push({ kind: 'session', modelLabel: null, percent: Number(session[1]), resets: session[2] });
      continue;
    }
    const week = trimmed.match(WEEK_LINE);
    if (week) {
      windows.push({ kind: 'week', modelLabel: week[1], percent: Number(week[2]), resets: week[3] });
    }
  }
  return windows;
}

/**
 * Why a parse produced no windows, so the UI can say something the user can
 * act on instead of a flat "unrecognized".
 *
 * `'cost-summary'` is a specific, confirmed-in-the-wild case: `claude -p
 * "/usage"` answering with the end-of-run cost/duration block ("Total cost:
 * ... / Total duration ...") rather than any subscription limits. Observed
 * live (2026-09-02) on Windows running CLI 2.1.235, while a Mac on 2.1.258
 * returned real limits for the byte-identical command — the slash command
 * IS recognized there (num_turns 0, no API call), it just reports something
 * else entirely.
 *
 * Two causes fit that evidence equally well and the output alone cannot
 * separate them: a CLI predating the limits-reporting `/usage`, or an
 * API-key (Console) login, which has no 5-hour/weekly limits to report at
 * all. The message this maps to names both rather than asserting one — do
 * not "simplify" it into a bare version warning without new evidence.
 */
export type UsageParseFailure = 'cost-summary' | 'unrecognized';

export function classifyUsageFailure(rawStdout: string): UsageParseFailure {
  const resultText = extractResultText(rawStdout);
  // Both markers, not just "Total cost:", so an unrelated future format that
  // happens to mention cost isn't misreported as this specific case.
  if (resultText && /^Total cost:/m.test(resultText) && /^Total duration/m.test(resultText)) {
    return 'cost-summary';
  }
  return 'unrecognized';
}
