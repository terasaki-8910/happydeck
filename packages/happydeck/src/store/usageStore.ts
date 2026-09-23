import { create } from 'zustand';
import { classifyUsageFailure, isWindowExpired, parseUsage, usageWindowLabel, windowKey, type UsageParseFailure, type UsageWindow } from '../lib/claudeUsage';
import { localizeUsageError } from '../lib/errorMessages';
import { MOCK_ENABLED } from '../lib/mockData';
import { notify } from '../lib/notifications';
import { getClaudeUsageRaw, refreshClaudeUsage } from '../lib/tauri';
import { useSettingsStore } from './settingsStore';

// Reading ~/.claude.json costs a file read, not a ~3.5s subprocess (that
// was the old `claude -p "/usage"` path, which capped the cadence at 3
// minutes and meant the badge could lag reality by that long). Polling this
// often is now essentially free; the CLI refreshes its own cache every few
// minutes while a session runs, so anything much tighter than this would
// just re-read identical bytes.
const POLL_INTERVAL_MS = 30 * 1000;
const WARN_THRESHOLD = 80;
const DANGER_THRESHOLD = 95;

// How long to leave a provably-stale cache alone before spending a
// subprocess on it. "Provably stale" is narrow on purpose (see
// needsForcedRefresh): a window whose own reset time has passed, which
// means the displayed number is not merely old but WRONG, and no amount of
// re-reading the file can fix it.
//
// The floor exists because the refresh can legitimately fail to help — a
// stale login refreshes nothing, and without a floor that would put the app
// back to booting a CLI process every 30s, which is the exact cost the
// file-read rewrite removed. 10 minutes keeps the worst case at ~6
// subprocesses an hour instead of ~120.
const FORCED_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

// VITE_HAPPYDECK_MOCK=1 fixture — no real ~/.claude.json read happens
// outside a Tauri runtime. Percentages are picked to exercise both the
// amber (>=80%) and red (>=95%) thresholds; nudge these during UI work to
// check color/notification behavior without waiting on real usage. Reset
// times are relative so the fixture never drifts into looking expired.
const MOCK_WINDOWS: UsageWindow[] = [
  { kind: 'session', modelLabel: null, percent: 63, resetsAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() },
  { kind: 'week', modelLabel: null, percent: 40, resetsAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString() },
  { kind: 'week', modelLabel: 'Fable', percent: 9, resetsAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString() },
];

interface UsageState {
  windows: UsageWindow[];
  /** When happydeck last read the file — drives the "have we settled yet" gate in UsageIndicator. */
  fetchedAt: number | null;
  /** When the CLI itself last refreshed these numbers. The honest answer to "how old is this?" — see below. */
  measuredAt: number | null;
  error: string | null;
  /** Set only when a read SUCCEEDED but yielded no windows — distinguishes "the cache holds something else" from a thrown error. */
  parseFailure: UsageParseFailure | null;
  loading: boolean;
  /** Highest threshold (80 or 95) already notified for a given window+reset-period, keyed by windowKey. */
  notified: Record<string, number>;
  started: boolean;
  /** True while a subprocess-backed forced refresh is in flight — distinct from `loading`, which also covers the sub-ms file read. */
  refreshing: boolean;
  /** When a forced refresh was last ATTEMPTED (not when it succeeded) — a failing refresh must back off exactly like a succeeding one. */
  lastForcedRefreshAt: number | null;
  /**
   * @param force Spend a subprocess making Claude Code re-fetch the numbers
   * before reading. Use for the explicit "refresh now" action; the polling
   * path passes nothing and stays a plain file read.
   */
  refresh: (force?: boolean) => Promise<void>;
  /** Idempotent — call from App's mount effect. Starts the poll/visibility loop once per app launch. */
  start: () => void;
}

export const useUsageStore = create<UsageState>()((set, get) => ({
  windows: [],
  fetchedAt: null,
  measuredAt: null,
  error: null,
  parseFailure: null,
  loading: false,
  notified: {},
  started: false,
  refreshing: false,
  lastForcedRefreshAt: null,

  async refresh(force = false) {
    if (!MOCK_ENABLED && !useSettingsStore.getState().showUsageIndicator) return;

    set({ loading: true });
    const language = useSettingsStore.getState().language;

    // Before the read, not after: the whole point is for the read below to
    // see numbers this call just caused to be written. Mock mode skips it —
    // there's no Tauri runtime to invoke, and MOCK_WINDOWS never goes stale.
    let refreshError: string | null = null;
    if (force && !MOCK_ENABLED) {
      set({ refreshing: true, lastForcedRefreshAt: Date.now() });
      try {
        await refreshClaudeUsage();
      } catch (error) {
        // Held rather than set here, and deliberately not an early return:
        // the read below still runs (cached numbers are worth re-showing),
        // but its success path must not clear this. A "refresh now" that
        // quietly failed and left the same stale number on screen is the
        // exact silent failure this whole change exists to remove.
        refreshError = localizeUsageError(language, error instanceof Error ? error.message : String(error));
      } finally {
        set({ refreshing: false });
      }
    }

    try {
      // Mock mode substitutes a fixture instead of skipping this function
      // altogether, specifically so the threshold/notification logic below
      // — not just the badge's numbers — is exercisable via
      // VITE_HAPPYDECK_MOCK=1 without a real Tauri runtime.
      const raw = MOCK_ENABLED ? null : await getClaudeUsageRaw();
      const snapshot = raw === null ? { windows: MOCK_WINDOWS, measuredAt: Date.now() } : parseUsage(raw);
      // Only classify when the read itself succeeded — a thrown error takes
      // the catch branch below and is reported on its own terms.
      const parseFailure = snapshot.windows.length === 0 && raw !== null ? classifyUsageFailure(raw) : null;
      set({ windows: snapshot.windows, measuredAt: snapshot.measuredAt, parseFailure, fetchedAt: Date.now(), error: refreshError, loading: false });

      const notified = { ...get().notified };
      let notifiedChanged = false;
      for (const w of snapshot.windows) {
        // A window past its reset time carries a percentage from the window
        // BEFORE it — the CLI only refreshes the cache while a session runs,
        // so nothing has corrected it yet. Notifying "you're at 96%" off a
        // number that already rolled over is exactly the false alarm this
        // whole feature exists to avoid.
        if (isWindowExpired(w)) continue;
        const key = windowKey(w);
        const already = notified[key] ?? 0;
        const crossed = w.percent >= DANGER_THRESHOLD ? DANGER_THRESHOLD : w.percent >= WARN_THRESHOLD ? WARN_THRESHOLD : 0;
        if (crossed > already) {
          notified[key] = crossed;
          notifiedChanged = true;
          const label = usageWindowLabel(language, w);
          const { title, body } =
            language === 'ja' ? { title: `使用量が${w.percent}%です`, body: `${label}が上限の${crossed}%を超えました。` } : { title: `Usage at ${w.percent}%`, body: `${label} crossed ${crossed}% of its limit.` };
          notify(title, body);
        }
      }
      if (notifiedChanged) set({ notified });
    } catch (error) {
      // Keep the last successful windows on screen — a transient failure
      // (a read landing mid-rewrite that outlasted the Rust-side retries)
      // shouldn't blank out a number the user was just looking at. Only the
      // error flag changes.
      set({ error: localizeUsageError(language, error instanceof Error ? error.message : String(error)), loading: false });
    }
  },

  start() {
    if (get().started) return;
    set({ started: true });

    // Each tick decides for itself whether the plain file read is enough.
    // Nothing here forces a refresh on a merely OLD cache — only on one
    // that is demonstrably showing a wrong number.
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      get().refresh(shouldForceRefresh(get()));
    };

    // Not `tick()` — the first read must happen even if the app launched
    // hidden or minimized, or the badge has nothing to show when the window
    // is first brought up. Never forced: there are no windows loaded yet to
    // judge staleness against, so there is nothing a subprocess could fix.
    get().refresh();
    window.setInterval(tick, POLL_INTERVAL_MS);
    // Catches up immediately after the window was hidden/minimized through
    // a whole interval — same rationale as happyStore's 'focus' listener.
    document.addEventListener('visibilitychange', tick);
  },
}));

/**
 * Whether this tick should spend a subprocess instead of just re-reading
 * the file.
 *
 * The trigger is an EXPIRED window, not an old `measuredAt`. A cache
 * measured hours ago is perfectly correct as long as no window has rolled
 * over since; once one has, its percentage belongs to a period that already
 * ended, the UI is showing "—" for it, and re-reading the same file will
 * never produce anything else. That is the only state where the subprocess
 * buys something the free path cannot.
 *
 * Both guards matter. Without `refreshing`, the 30s poll would stack
 * refreshes on top of a ~3.7s subprocess that hasn't returned; without the
 * cooldown, a refresh that legitimately cannot help (stale login — the
 * confirmed 2026-09-03 Windows case) would respawn every 30s forever.
 */
export function shouldForceRefresh(state: Pick<UsageState, 'windows' | 'refreshing' | 'lastForcedRefreshAt'>, now: number = Date.now()): boolean {
  if (MOCK_ENABLED || state.refreshing) return false;
  if (!state.windows.some((w) => isWindowExpired(w, now))) return false;
  const last = state.lastForcedRefreshAt;
  return last === null || now - last >= FORCED_REFRESH_COOLDOWN_MS;
}
