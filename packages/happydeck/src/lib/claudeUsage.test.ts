import { describe, expect, it } from 'vitest';
import { classifyUsageFailure, isWindowExpired, parseUsage, windowKey, type UsageWindow } from './claudeUsage';

// Captured verbatim from this machine's ~/.claude.json on 2026-09-08 — the
// `cachedUsageUtilization` value src-tauri/src/claude_usage.rs hands over.
// Trimmed to the keys this file reads plus enough neighbours (five_hour,
// severity, extra_usage) to prove they're ignored rather than tripped over.
const REAL_FIXTURE = JSON.stringify({
  fetchedAtMs: 1788851938999,
  accountUuid: 'fd81296f-6526-4543-b8b7-2f22b059ac7f',
  utilization: {
    five_hour: { utilization: 13, resets_at: '2026-09-08T10:49:59.879884+00:00' },
    seven_day: { utilization: 11, resets_at: '2026-09-14T21:59:59.879907+00:00' },
    seven_day_opus: null,
    extra_usage: { is_enabled: false, utilization: null },
    limits: [
      { kind: 'session', group: 'session', percent: 13, severity: 'normal', resets_at: '2026-09-08T10:49:59.879884+00:00', scope: null, is_active: true },
      { kind: 'weekly_all', group: 'weekly', percent: 11, severity: 'normal', resets_at: '2026-09-14T21:59:59.879907+00:00', scope: null, is_active: false },
      { kind: 'weekly_scoped', group: 'weekly', percent: 0, severity: 'normal', resets_at: null, scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false },
    ],
    member_dashboard_available: false,
  },
});

describe('parseUsage', () => {
  it('maps the real captured payload into session + weekly windows', () => {
    expect(parseUsage(REAL_FIXTURE)).toEqual({
      measuredAt: 1788851938999,
      windows: [
        { kind: 'session', modelLabel: null, percent: 13, resetsAt: '2026-09-08T10:49:59.879884+00:00' },
        { kind: 'week', modelLabel: null, percent: 11, resetsAt: '2026-09-14T21:59:59.879907+00:00' },
        { kind: 'week', modelLabel: 'Fable', percent: 0, resetsAt: null },
      ],
    });
  });

  it('does not surface five_hour/seven_day/extra_usage as extra windows', () => {
    expect(parseUsage(REAL_FIXTURE).windows).toHaveLength(3);
  });

  it('does not hardcode model names — any scoped cap is generic', () => {
    const fixture = JSON.stringify({
      utilization: { limits: [{ kind: 'weekly_scoped', percent: 5, resets_at: null, scope: { model: { display_name: 'Sonnet' } } }] },
    });
    expect(parseUsage(fixture).windows).toEqual([{ kind: 'week', modelLabel: 'Sonnet', percent: 5, resetsAt: null }]);
  });

  it('handles a session window with no weekly caps at all', () => {
    const fixture = JSON.stringify({ utilization: { limits: [{ kind: 'session', percent: 1, resets_at: '2026-09-08T10:00:00Z' }] } });
    expect(parseUsage(fixture).windows).toEqual([{ kind: 'session', modelLabel: null, percent: 1, resetsAt: '2026-09-08T10:00:00Z' }]);
  });

  it('skips a scoped cap it cannot label rather than mislabelling it', () => {
    const fixture = JSON.stringify({
      utilization: {
        limits: [
          { kind: 'weekly_scoped', percent: 7, resets_at: null, scope: { model: { display_name: '' } } },
          { kind: 'weekly_scoped', percent: 8, resets_at: null, scope: null },
          { kind: 'weekly_all', percent: 9, resets_at: null, scope: null },
        ],
      },
    });
    expect(parseUsage(fixture).windows).toEqual([{ kind: 'week', modelLabel: null, percent: 9, resetsAt: null }]);
  });

  it('skips a limit kind added after this was written', () => {
    const fixture = JSON.stringify({ utilization: { limits: [{ kind: 'monthly_something', percent: 50, resets_at: null }, { kind: 'session', percent: 2, resets_at: null }] } });
    expect(parseUsage(fixture).windows).toEqual([{ kind: 'session', modelLabel: null, percent: 2, resetsAt: null }]);
  });

  it('skips a limit with no usable percent', () => {
    const fixture = JSON.stringify({ utilization: { limits: [{ kind: 'session', percent: null }, { kind: 'weekly_all', percent: '12' }] } });
    expect(parseUsage(fixture).windows).toEqual([]);
  });

  it('keeps measuredAt even when there are no limits to report', () => {
    expect(parseUsage(JSON.stringify({ fetchedAtMs: 123, utilization: {} }))).toEqual({ windows: [], measuredAt: 123 });
  });

  it('returns nothing for an empty string, garbage, or a non-object', () => {
    for (const raw of ['', 'not json at all', '[]', 'null', '"a string"']) {
      expect(parseUsage(raw)).toEqual({ windows: [], measuredAt: null });
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseUsage(`\n  ${REAL_FIXTURE}  \n`).windows).toHaveLength(3);
  });
});

describe('windowKey', () => {
  it('changes once a window rolls over, so a new period can notify again', () => {
    const before: UsageWindow = { kind: 'session', modelLabel: null, percent: 96, resetsAt: '2026-09-08T10:00:00Z' };
    const after: UsageWindow = { kind: 'session', modelLabel: null, percent: 96, resetsAt: '2026-09-08T15:00:00Z' };
    expect(windowKey(before)).not.toBe(windowKey(after));
  });

  it('separates the aggregate weekly cap from a scoped one', () => {
    const all: UsageWindow = { kind: 'week', modelLabel: null, percent: 40, resetsAt: '2026-09-14T21:00:00Z' };
    const scoped: UsageWindow = { kind: 'week', modelLabel: 'Fable', percent: 40, resetsAt: '2026-09-14T21:00:00Z' };
    expect(windowKey(all)).not.toBe(windowKey(scoped));
  });
});

describe('isWindowExpired', () => {
  const now = Date.parse('2026-09-08T12:00:00Z');

  it('is true once the reset time has passed', () => {
    expect(isWindowExpired({ kind: 'session', modelLabel: null, percent: 87, resetsAt: '2026-09-08T10:49:59Z' }, now)).toBe(true);
  });

  it('is false for a window still open', () => {
    expect(isWindowExpired({ kind: 'week', modelLabel: null, percent: 11, resetsAt: '2026-09-14T21:59:59Z' }, now)).toBe(false);
  });

  // The payload's own is_active flag marks which limit is currently the
  // binding constraint, NOT whether a window is still open — the real
  // capture above has a live weekly cap sitting at is_active:false. Only
  // resets_at may drive this.
  it('ignores a null reset time instead of guessing', () => {
    expect(isWindowExpired({ kind: 'week', modelLabel: 'Fable', percent: 0, resetsAt: null }, now)).toBe(false);
  });

  it('ignores an unparseable reset time instead of guessing', () => {
    expect(isWindowExpired({ kind: 'session', modelLabel: null, percent: 5, resetsAt: 'later today' }, now)).toBe(false);
  });
});

describe('classifyUsageFailure', () => {
  it('reports no-limits when the cache is well-formed but empty', () => {
    const fixture = JSON.stringify({ fetchedAtMs: 1, utilization: { limits: [] } });
    expect(parseUsage(fixture).windows).toEqual([]);
    expect(classifyUsageFailure(fixture)).toBe('no-limits');
  });

  it('reports no-limits when every limit in it was unrecognizable', () => {
    const fixture = JSON.stringify({ utilization: { limits: [{ kind: 'monthly_something', percent: 50 }] } });
    expect(classifyUsageFailure(fixture)).toBe('no-limits');
  });

  it('falls back to unrecognized for a payload with no limits array', () => {
    expect(classifyUsageFailure(JSON.stringify({ fetchedAtMs: 1, utilization: {} }))).toBe('unrecognized');
    expect(classifyUsageFailure(JSON.stringify({ fetchedAtMs: 1 }))).toBe('unrecognized');
  });

  it('falls back to unrecognized for garbage, empty, and non-JSON input', () => {
    expect(classifyUsageFailure('')).toBe('unrecognized');
    expect(classifyUsageFailure('claude: command not found')).toBe('unrecognized');
  });
});
