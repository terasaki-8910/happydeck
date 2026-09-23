import { describe, expect, it } from 'vitest';
import type { UsageWindow } from '../lib/claudeUsage';
import { shouldForceRefresh } from './usageStore';

/**
 * The gate deciding when the usage badge spends a ~3.7s `claude -p
 * "/usage"` subprocess instead of the free file read.
 *
 * Worth testing rather than eyeballing because both directions are costly
 * in opposite ways: too eager puts the app back to booting a CLI process
 * every 30s (the exact regression the file-read rewrite removed), too timid
 * leaves the 5-hour window stuck on "—" forever, which is the bug this was
 * written to fix.
 */

const NOW = Date.parse('2026-09-24T00:00:00Z');
const COOLDOWN_MS = 10 * 60 * 1000;

function expired(): UsageWindow {
  return { kind: 'session', modelLabel: null, percent: 39, resetsAt: new Date(NOW - 60_000).toISOString() };
}

function live(): UsageWindow {
  return { kind: 'session', modelLabel: null, percent: 39, resetsAt: new Date(NOW + 60 * 60_000).toISOString() };
}

const IDLE = { refreshing: false, lastForcedRefreshAt: null };

describe('shouldForceRefresh', () => {
  it('forces when a window has rolled past its reset time', () => {
    expect(shouldForceRefresh({ ...IDLE, windows: [expired()] }, NOW)).toBe(true);
  });

  it('stays on the free read while every window is still live', () => {
    // The key non-obvious case: an OLD cache is not by itself a reason to
    // spend a subprocess. Only a wrong number is.
    expect(shouldForceRefresh({ ...IDLE, windows: [live()] }, NOW)).toBe(false);
  });

  it('stays on the free read when there are no windows at all', () => {
    // No windows means the read failed or the cache holds something
    // unrecognized — neither is something a refresh can repair, and
    // respawning against it every 30s is exactly the runaway to avoid.
    expect(shouldForceRefresh({ ...IDLE, windows: [] }, NOW)).toBe(false);
  });

  it('does not stack a second refresh onto one still in flight', () => {
    expect(shouldForceRefresh({ windows: [expired()], refreshing: true, lastForcedRefreshAt: null }, NOW)).toBe(false);
  });

  it('holds off while still inside the cooldown', () => {
    const state = { windows: [expired()], refreshing: false, lastForcedRefreshAt: NOW - (COOLDOWN_MS - 1000) };
    expect(shouldForceRefresh(state, NOW)).toBe(false);
  });

  it('retries once the cooldown has elapsed', () => {
    const state = { windows: [expired()], refreshing: false, lastForcedRefreshAt: NOW - COOLDOWN_MS };
    expect(shouldForceRefresh(state, NOW)).toBe(true);
  });

  it('keeps backing off after a refresh that changed nothing', () => {
    // A stale login refreshes successfully but writes no new numbers, so
    // the window stays expired. The cooldown is measured from the ATTEMPT,
    // which is what stops that from becoming a permanent respawn loop.
    const justTried = { windows: [expired()], refreshing: false, lastForcedRefreshAt: NOW };
    expect(shouldForceRefresh(justTried, NOW + POLL_TICK)).toBe(false);
  });
});

/** One poll interval — the cadence a runaway would respawn at. */
const POLL_TICK = 30 * 1000;
