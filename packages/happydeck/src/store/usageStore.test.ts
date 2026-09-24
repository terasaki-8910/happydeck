import { describe, expect, it } from 'vitest';
import { shouldForceRefresh } from './usageStore';

/**
 * The gate deciding when the usage badge spends a ~3.7s `claude -p
 * "/usage"` subprocess instead of the free file read.
 *
 * Only two things guard it now (see the constant's own doc for why a
 * periodic force stopped being expensive): a refresh already in flight,
 * and the interval since the last ATTEMPT. Worth testing rather than
 * eyeballing because both failure directions are silent — stacking
 * refreshes on an in-flight one, or respawning every poll tick after a
 * failure, would show up as background CPU/process churn, not as anything
 * visibly wrong on screen.
 */

const NOW = Date.parse('2026-09-24T00:00:00Z');
const INTERVAL_MS = 5 * 60 * 1000;

describe('shouldForceRefresh', () => {
  it('forces on the very first tick, before any attempt has been recorded', () => {
    expect(shouldForceRefresh({ refreshing: false, lastForcedRefreshAt: null }, NOW)).toBe(true);
  });

  it('holds off while still inside the interval', () => {
    const state = { refreshing: false, lastForcedRefreshAt: NOW - (INTERVAL_MS - 1000) };
    expect(shouldForceRefresh(state, NOW)).toBe(false);
  });

  it('forces again once the interval has fully elapsed', () => {
    const state = { refreshing: false, lastForcedRefreshAt: NOW - INTERVAL_MS };
    expect(shouldForceRefresh(state, NOW)).toBe(true);
  });

  it('never stacks a second refresh onto one still in flight, even past the interval', () => {
    const state = { refreshing: true, lastForcedRefreshAt: NOW - INTERVAL_MS };
    expect(shouldForceRefresh(state, NOW)).toBe(false);
  });

  it('keeps backing off on the same schedule after a refresh that failed to help', () => {
    // A stale login (the confirmed 2026-09-03 Windows case) refreshes
    // without producing new numbers. The interval is measured from the
    // ATTEMPT, which is what stops that from becoming a subprocess every
    // 30s instead of every 5 minutes.
    const justTried = { refreshing: false, lastForcedRefreshAt: NOW };
    expect(shouldForceRefresh(justTried, NOW + 30_000)).toBe(false);
  });
});
