import { create } from 'zustand';
import { classifyUsageFailure, isWindowExpired, parseUsage, usageWindowLabel, windowKey, type UsageParseFailure, type UsageWindow } from '../lib/claudeUsage';
import { localizeUsageError } from '../lib/errorMessages';
import { MOCK_ENABLED } from '../lib/mockData';
import { notify } from '../lib/notifications';
import { getClaudeUsageRaw } from '../lib/tauri';
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
  refresh: () => Promise<void>;
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

  async refresh() {
    if (!MOCK_ENABLED && !useSettingsStore.getState().showUsageIndicator) return;

    set({ loading: true });
    const language = useSettingsStore.getState().language;
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
      set({ windows: snapshot.windows, measuredAt: snapshot.measuredAt, parseFailure, fetchedAt: Date.now(), error: null, loading: false });

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
    get().refresh();
    window.setInterval(() => {
      if (document.visibilityState === 'visible') get().refresh();
    }, POLL_INTERVAL_MS);
    // Catches up immediately after the window was hidden/minimized through
    // a whole interval — same rationale as happyStore's 'focus' listener.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') get().refresh();
    });
  },
}));
