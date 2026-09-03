import { create } from 'zustand';
import { classifyUsageFailure, parseUsage, usageWindowLabel, windowKey, type UsageParseFailure, type UsageWindow } from '../lib/claudeUsage';
import { MOCK_ENABLED } from '../lib/mockData';
import { notify } from '../lib/notifications';
import { getClaudeUsageRaw } from '../lib/tauri';
import { useSettingsStore } from './settingsStore';

const POLL_INTERVAL_MS = 3 * 60 * 1000;
const WARN_THRESHOLD = 80;
const DANGER_THRESHOLD = 95;

// VITE_HAPPYDECK_MOCK=1 fixture — no real `claude` subprocess makes sense
// outside an actual Tauri runtime. Percentages are picked to exercise both
// the amber (>=80%) and red (>=95%) thresholds; nudge these during UI work
// to check color/notification behavior without waiting on real usage.
const MOCK_WINDOWS: UsageWindow[] = [
  { kind: 'session', modelLabel: null, percent: 63, resets: 'Aug 30 at 7:20am (Asia/Tokyo)' },
  { kind: 'week', modelLabel: 'all models', percent: 40, resets: 'Sep 1 at 7am (Asia/Tokyo)' },
  { kind: 'week', modelLabel: 'Fable', percent: 9, resets: 'Sep 1 at 7am (Asia/Tokyo)' },
];

interface UsageState {
  windows: UsageWindow[];
  fetchedAt: number | null;
  error: string | null;
  /** Set only when a fetch SUCCEEDED but yielded no windows — distinguishes "claude answered with something else" from a thrown error. */
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
  error: null,
  parseFailure: null,
  loading: false,
  notified: {},
  started: false,

  async refresh() {
    if (!MOCK_ENABLED && !useSettingsStore.getState().showUsageIndicator) return;

    set({ loading: true });
    try {
      // Mock mode substitutes a fixture instead of skipping this function
      // altogether, specifically so the threshold/notification logic below
      // — not just the badge's numbers — is exercisable via
      // VITE_HAPPYDECK_MOCK=1 without a real Tauri runtime.
      const raw = MOCK_ENABLED ? null : await getClaudeUsageRaw();
      const windows = raw === null ? MOCK_WINDOWS : parseUsage(raw);
      // Only classify when the call itself succeeded — a thrown error takes
      // the catch branch below and is reported on its own terms.
      const parseFailure = windows.length === 0 && raw !== null ? classifyUsageFailure(raw) : null;
      set({ windows, parseFailure, fetchedAt: Date.now(), error: null, loading: false });

      const language = useSettingsStore.getState().language;
      const notified = { ...get().notified };
      let notifiedChanged = false;
      for (const w of windows) {
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
      // (claude CLI mid-update, momentary PATH miss) shouldn't blank out a
      // number the user was just looking at. Only the error flag changes.
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
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
