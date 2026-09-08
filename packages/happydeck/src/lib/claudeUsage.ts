/**
 * Maps Claude Code's own cached usage payload — `cachedUsageUtilization`
 * from `~/.claude.json`, handed over verbatim by
 * src-tauri/src/claude_usage.rs — into the windows the badge renders.
 *
 * This is an internal CLI cache, not a documented contract, so a future
 * release can change or drop fields without notice. Failing soft
 * (returning fewer windows, or none) is the deliberate response to any
 * shape this doesn't recognize — never show a half-parsed or guessed
 * number.
 *
 * Shape, confirmed live (2026-09-08):
 *   { fetchedAtMs, utilization: { limits: [
 *       { kind: 'session' | 'weekly_all' | 'weekly_scoped',
 *         percent, resets_at: ISO-8601 | null, severity, is_active,
 *         scope: { model: { display_name } } | null }, ... ] } }
 */

import type { Language } from '../store/settingsStore';
import { translate } from './i18n';

export type UsageWindow =
  | { kind: 'session'; modelLabel: null; percent: number; resetsAt: string | null }
  /** `modelLabel: null` is the aggregate weekly cap (`weekly_all`); a string is one model's own cap. */
  | { kind: 'week'; modelLabel: string | null; percent: number; resetsAt: string | null };

export interface UsageSnapshot {
  windows: UsageWindow[];
  /** When the CLI last refreshed these numbers, ms epoch — NOT when happydeck read the file. */
  measuredAt: number | null;
}

const EMPTY: UsageSnapshot = { windows: [], measuredAt: null };

/** Stable identity for a window within one reset period — changes automatically once `resetsAt` rolls over. */
export function windowKey(w: UsageWindow): string {
  return `${w.kind}:${w.modelLabel ?? ''}:${w.resetsAt ?? ''}`;
}

/**
 * A model's own weekly cap is labelled with the CLI's `display_name`
 * ("Fable") and isn't translated — same treatment BulkKillMenu gives
 * machine/workspace names ("user data, not translatable"). The session and
 * aggregate-weekly labels are ours, so those are flat i18n lookups.
 */
export function usageWindowLabel(language: Language, w: UsageWindow): string {
  if (w.kind === 'session') return translate(language, 'usageWindowSession');
  if (w.modelLabel === null) return translate(language, 'usageWindowWeeklyAll');
  return language === 'ja' ? `週間（${w.modelLabel}）` : `Weekly (${w.modelLabel})`;
}

/**
 * `resets_at` is machine-readable now (it used to be the CLI's own English
 * prose, "Sep 1 at 7am (Asia/Tokyo)"), so the reset time can finally be
 * rendered in the user's language and local zone rather than passed
 * through verbatim.
 */
export function formatResetTime(language: Language, resetsAt: string | null): string | null {
  if (!resetsAt) return null;
  const ms = Date.parse(resetsAt);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * A cached window whose reset time has already passed. This matters
 * because the cache is only refreshed while a Claude Code session runs —
 * with nothing running, an hours-old 5-hour window sits there reading 87%
 * long after it actually rolled over, and displaying that number is
 * simply wrong.
 *
 * Deliberately computed from `resets_at`, NOT from the payload's
 * `is_active` flag: `is_active` marks which limit is currently the binding
 * constraint, not whether a window is still open, so a perfectly live
 * weekly cap reads `is_active: false` whenever the session window is the
 * tighter one. Using it here would blank out valid numbers.
 */
export function isWindowExpired(w: UsageWindow, now: number = Date.now()): boolean {
  if (!w.resetsAt) return false;
  const ms = Date.parse(w.resetsAt);
  return !Number.isNaN(ms) && ms <= now;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The display name of a per-model weekly cap. Returns null — and the
 * caller then drops the window entirely — when a scoped limit arrives with
 * no name we can show: an unlabelled percentage in a list of labelled ones
 * reads as one of the labelled kinds, which is worse than omitting it.
 */
function scopeLabel(scope: unknown): string | null {
  if (!isRecord(scope) || !isRecord(scope.model)) return null;
  const name = scope.model.display_name;
  return typeof name === 'string' && name.trim() !== '' ? name : null;
}

function toWindow(entry: unknown): UsageWindow | null {
  if (!isRecord(entry)) return null;
  const { percent, kind } = entry;
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return null;
  // Not clamped to 0–100: if the account is ever reported past its limit,
  // that is the one number worth showing honestly.
  const rounded = Math.round(percent);
  const resetsAt = typeof entry.resets_at === 'string' && entry.resets_at.trim() !== '' ? entry.resets_at : null;

  if (kind === 'session') return { kind: 'session', modelLabel: null, percent: rounded, resetsAt };
  if (kind === 'weekly_all') return { kind: 'week', modelLabel: null, percent: rounded, resetsAt };
  if (kind === 'weekly_scoped') {
    const label = scopeLabel(entry.scope);
    return label === null ? null : { kind: 'week', modelLabel: label, percent: rounded, resetsAt };
  }
  // An unrecognized kind — a window type added after this was written.
  // Skipped rather than guessed at.
  return null;
}

export function parseUsage(rawJson: string): UsageSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return EMPTY;
  }
  if (!isRecord(parsed)) return EMPTY;

  const measuredAt = typeof parsed.fetchedAtMs === 'number' && Number.isFinite(parsed.fetchedAtMs) ? parsed.fetchedAtMs : null;
  const limits = isRecord(parsed.utilization) ? parsed.utilization.limits : undefined;
  if (!Array.isArray(limits)) return { windows: [], measuredAt };

  const windows = limits.map(toWindow).filter((w): w is UsageWindow => w !== null);
  return { windows, measuredAt };
}

/**
 * Why a read produced no windows, so the UI can say something the user can
 * act on instead of a flat "unrecognized".
 *
 * `'no-limits'` is the payload being present and well-formed but carrying
 * no limits at all. The one confirmed real-world instance of an account
 * with no usage data to report (Windows, 2026-09-03) was **a stale login**
 * — `claude auth login` there restored real limits immediately. Two
 * earlier hypotheses were both DISPROVEN on that same machine and should
 * not be reintroduced without new evidence:
 *  - "CLI too old": it was 2.1.235 (vs a working Mac's 2.1.258) and
 *    `claude update` had failed, so it was still 2.1.235 when re-login
 *    fixed it — the version was never the problem.
 *  - "API-key login has no limits to report": `ANTHROPIC_API_KEY` was
 *    confirmed unset there.
 */
export type UsageParseFailure = 'no-limits' | 'unrecognized';

export function classifyUsageFailure(rawJson: string): UsageParseFailure {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (isRecord(parsed) && isRecord(parsed.utilization) && Array.isArray(parsed.utilization.limits)) {
      return 'no-limits';
    }
  } catch {
    // Not JSON at all — 'unrecognized' below is exactly right.
  }
  return 'unrecognized';
}
