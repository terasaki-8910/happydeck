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
