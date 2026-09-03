import { useEffect, useRef, useState } from 'react';
import { LuBrain, LuCalendarDays, LuGauge, LuTimer } from 'react-icons/lu';
import { usageWindowLabel, windowKey, type UsageWindow } from '../lib/claudeUsage';
import { useT } from '../lib/i18n';
import { useSettingsStore } from '../store/settingsStore';
import { useUsageStore } from '../store/usageStore';

function metricClass(percent: number): string {
  if (percent >= 95) return 'usage-indicator-metric-danger';
  if (percent >= 80) return 'usage-indicator-metric-warn';
  return '';
}

function formatUpdated(language: 'en' | 'ja', fetchedAt: number): string {
  const time = new Date(fetchedAt).toLocaleTimeString(language === 'ja' ? 'ja-JP' : 'en-US', { hour: 'numeric', minute: '2-digit' });
  return language === 'ja' ? `最終取得 ${time}` : `Last fetched ${time}`;
}

/**
 * Titlebar badge for Claude Code's account-wide usage limits (5h session +
 * weekly window(s)), fed by shelling out to `claude -p "/usage"` — see
 * src/store/usageStore.ts. Deliberately a text badge, not two separate
 * icon+text badges like AgentSettingsPopover: this is one glanceable status
 * reading, not two independent settings to toggle.
 *
 * The session window, the first weekly window, and (while it exists) a
 * Fable-specific weekly window all show in the compact badge; any other
 * per-model weekly caps only appear in the popover. Fable's own cap is a
 * limited-time addition on top of the aggregate weekly one (user request,
 * 2026-09-01) — worth headlining while it's relevant. Everything else stays
 * generic on purpose: singling out one more named model here is a deliberate,
 * temporary exception to that, not a precedent for hardcoding others.
 */
export function UsageIndicator() {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const showUsageIndicator = useSettingsStore((s) => s.showUsageIndicator);
  const windows = useUsageStore((s) => s.windows);
  const error = useUsageStore((s) => s.error);
  const parseFailure = useUsageStore((s) => s.parseFailure);
  const loading = useUsageStore((s) => s.loading);
  const fetchedAt = useUsageStore((s) => s.fetchedAt);
  const refresh = useUsageStore((s) => s.refresh);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Capture phase — Tauri's own drag-region mousedown listener
    // (data-tauri-drag-region, the titlebar) calls stopImmediatePropagation
    // for clicks landing there, which would otherwise swallow this before a
    // bubble-phase document listener ever saw it.
    document.addEventListener('mousedown', onOutside, true);
    window.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onOutside, true);
      window.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  if (!showUsageIndicator) return null;
  // Nothing has SETTLED yet (first ~3.5s after launch) — avoid a flash of a
  // placeholder badge before the initial request resolves one way or
  // another. Gated on fetchedAt, not on windows.length: a request that
  // completed without throwing but parsed zero windows (an unrecognized
  // response shape — see the parse-failed message below) must still show
  // SOMETHING, or it's indistinguishable from "disabled in Settings" or
  // "still loading" and unreportable when it happens (confirmed report,
  // 2026-09-02: a Windows build that could genuinely no longer launch
  // `claude` showed nothing at all, not even the error badge below).
  if (fetchedAt === null && !error) return null;

  const noData = windows.length === 0;
  const sessionWindow = windows.find((w): w is Extract<UsageWindow, { kind: 'session' }> => w.kind === 'session');
  const weekWindows = windows.filter((w): w is Extract<UsageWindow, { kind: 'week' }> => w.kind === 'week');
  const primaryWeek = weekWindows[0] ?? null;
  // See the module doc above — a deliberate, named exception, expected to
  // naturally stop rendering (fableWeek just stays null) once the CLI no
  // longer reports this window. The `!== primaryWeek` guard avoids showing
  // the same window twice for an account where Fable IS the only weekly cap.
  const fableWeek = weekWindows.find((w) => w.modelLabel === 'Fable' && w !== primaryWeek) ?? null;

  return (
    <div className="usage-indicator" ref={rootRef}>
      <button type="button" className="usage-indicator-trigger" title={t('usageTitle')} onClick={() => setOpen((v) => !v)}>
        {noData ? (
          <span className="usage-indicator-metric">
            <LuGauge size={13} strokeWidth={2} />
            {t('usageUnavailable')}
          </span>
        ) : (
          <>
            {sessionWindow && (
              <span className={`usage-indicator-metric ${metricClass(sessionWindow.percent)}`}>
                <LuTimer size={12} strokeWidth={2} />
                {sessionWindow.percent}%
              </span>
            )}
            {sessionWindow && primaryWeek && <span className="usage-indicator-sep">·</span>}
            {primaryWeek && (
              <span className={`usage-indicator-metric ${metricClass(primaryWeek.percent)}`}>
                <LuCalendarDays size={12} strokeWidth={2} />
                {primaryWeek.percent}%
              </span>
            )}
            {primaryWeek && fableWeek && <span className="usage-indicator-sep">·</span>}
            {fableWeek && (
              <span className={`usage-indicator-metric ${metricClass(fableWeek.percent)}`}>
                <LuBrain size={12} strokeWidth={2} />
                {fableWeek.percent}%
              </span>
            )}
          </>
        )}
      </button>

      {open && (
        <div className="session-menu-popover usage-popover" onClick={(event) => event.stopPropagation()}>
          <span className="session-menu-label">{t('usageTitle')}</span>
          {windows.map((w) => (
            <div className="usage-popover-row" key={windowKey(w)}>
              <span className="usage-popover-row-label">
                {usageWindowLabel(language, w)}
                <span className="usage-popover-resets">{language === 'ja' ? `${w.resets} にリセット` : `resets ${w.resets}`}</span>
              </span>
              <span className={`usage-popover-row-value ${metricClass(w.percent)}`}>{w.percent}%</span>
            </div>
          ))}
          {noData && !error && <p className="usage-popover-error">{t(parseFailure === 'cost-summary' ? 'usageCostSummaryOnly' : 'usageParseFailed')}</p>}
          {error && <p className="usage-popover-error">{error}</p>}
          <div className="session-menu-divider" />
          <div className="usage-popover-footer">
            <span className="usage-popover-updated">{fetchedAt ? formatUpdated(language, fetchedAt) : ''}</span>
            <button type="button" className="usage-popover-refresh" disabled={loading} onClick={() => refresh()}>
              {t('usageRefreshButton')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
