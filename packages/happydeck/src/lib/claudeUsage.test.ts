import { describe, expect, it } from 'vitest';
import { parseUsage } from './claudeUsage';

// Captured live from `claude -p "/usage" --output-format json` during the
// feature's own investigation (2026-08-30) — the real shape this parses.
const REAL_FIXTURE = JSON.stringify({
  is_error: false,
  type: 'result',
  subtype: 'success',
  total_cost_usd: 0,
  result:
    'You are currently using your subscription to power your Claude Code usage\n\n' +
    'Current session: 63% used · resets Aug 30 at 7:20am (Asia/Tokyo)\n' +
    'Current week (all models): 40% used · resets Sep 1 at 7am (Asia/Tokyo)\n' +
    'Current week (Fable): 9% used · resets Sep 1 at 7am (Asia/Tokyo)\n\n' +
    "What's contributing to your limits usage?\n" +
    'Approximate, based on local sessions on this machine — does not include other devices or claude.ai.\n\n' +
    'Last 24h · 318 requests · 4 sessions\n  88% of your usage was at >150k context',
});

describe('parseUsage', () => {
  it('parses the real captured shape into session + weekly windows', () => {
    expect(parseUsage(REAL_FIXTURE)).toEqual([
      { kind: 'session', modelLabel: null, percent: 63, resets: 'Aug 30 at 7:20am (Asia/Tokyo)' },
      { kind: 'week', modelLabel: 'all models', percent: 40, resets: 'Sep 1 at 7am (Asia/Tokyo)' },
      { kind: 'week', modelLabel: 'Fable', percent: 9, resets: 'Sep 1 at 7am (Asia/Tokyo)' },
    ]);
  });

  it('does not surface the "contributing" breakdown as a window', () => {
    const windows = parseUsage(REAL_FIXTURE);
    expect(windows).toHaveLength(3);
  });

  it('does not hardcode model names — any week label is generic', () => {
    const fixture = JSON.stringify({
      type: 'result',
      result: 'Current session: 10% used · resets Aug 30 at 1pm (UTC)\nCurrent week (Sonnet): 5% used · resets Sep 1 at 1pm (UTC)',
    });
    expect(parseUsage(fixture)).toEqual([
      { kind: 'session', modelLabel: null, percent: 10, resets: 'Aug 30 at 1pm (UTC)' },
      { kind: 'week', modelLabel: 'Sonnet', percent: 5, resets: 'Sep 1 at 1pm (UTC)' },
    ]);
  });

  it('handles a session line with no weekly caps at all', () => {
    const fixture = JSON.stringify({ type: 'result', result: 'Current session: 1% used · resets Aug 30 at 1pm (UTC)' });
    expect(parseUsage(fixture)).toEqual([{ kind: 'session', modelLabel: null, percent: 1, resets: 'Aug 30 at 1pm (UTC)' }]);
  });

  it('returns [] for an empty string', () => {
    expect(parseUsage('')).toEqual([]);
  });

  it('returns [] for non-JSON garbage', () => {
    expect(parseUsage('claude: command not found\n')).toEqual([]);
  });

  it('returns [] for valid JSON with no recognizable "Current ..." lines', () => {
    const fixture = JSON.stringify({ type: 'result', result: 'Usage reporting is temporarily unavailable.' });
    expect(parseUsage(fixture)).toEqual([]);
  });

  it('returns [] when the JSON has no result field', () => {
    expect(parseUsage(JSON.stringify({ type: 'result' }))).toEqual([]);
  });

  it('tolerates surrounding whitespace/newlines', () => {
    expect(parseUsage(`\n\n  ${REAL_FIXTURE}  \n`)).toHaveLength(3);
  });
});
