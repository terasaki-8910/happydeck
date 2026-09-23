import { useEffect, useRef, useState } from 'react';
import { LuBrain, LuCalendarDays, LuGauge, LuTimer } from 'react-icons/lu';
import { formatResetTime, isWindowExpired, usageWindowLabel, windowKey, type UsageWindow } from '../lib/claudeUsage';
import { useT } from '../lib/i18n';
import { useSettingsStore } from '../store/settingsStore';
import { useUsageStore } from '../store/usageStore';

function metricClass(percent: number, expired = false): string {
  // An expired window's percentage is stale, so it must not carry amber/red
  // either — the color is as much of a claim as the number.
  if (expired) return '';
  if (percent >= 95) return 'usage-indicator-metric-danger';
  if (percent >= 80) return 'usage-indicator-metric-warn';
  return '';
}

/**
 * Reports when the CLI last refreshed these numbers, not when happydeck
 * last read the file. Since the switch to reading ~/.claude.json the read
 * time says nothing useful — it's always seconds ago — while the data
 * behind it only moves when a Claude Code session is actually running.
 * Includes the date once the reading isn't from today, because a bare
 * "16:18" on day-old numbers reads as fresh.
 */
function formatMeasured(language: 'en' | 'ja', measuredAt: number): string {
  const locale = language === 'ja' ? 'ja-JP' : 'en-US';
  const when = new Date(measuredAt);
  const sameDay = when.toDateString() === new Date().toDateString();
  const stamp = when.toLocaleString(locale, sameDay ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return language === 'ja' ? `${stamp} 時点` : `Measured ${stamp}`;
}

/**
 * A window past its reset time shows "—" rather than its cached
 * percentage: that number belongs to the window before the reset, and
 * nothing will correct it until a Claude Code session runs and refreshes
 * the cache. Showing a stale 87% is worse than showing nothing.
 */
function metricText(w: UsageWindow, expired: boolean): string {
  return expired ? '—' : `${w.percent}%`;
}

/**
 * Titlebar badge for Claude Code's account-wide usage limits (5h session +
 * weekly window(s)), read from the CLI's own cache in ~/.claude.json — see
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
  const refreshing = useUsageStore((s) => s.refreshing);
  const fetchedAt = useUsageStore((s) => s.fetchedAt);
  const measuredAt = useUsageStore((s) => s.measuredAt);
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
  // Nothing has SETTLED yet — avoid a flash of a placeholder badge before
  // the initial read resolves one way or another. (Far briefer now that
  // this is a file read rather than a ~3.5s subprocess, but a first paint
  // still beats it.) Gated on fetchedAt, not on windows.length: a read that
  // completed without throwing but produced zero windows (an unrecognized
  // cache shape — see the parse-failed message below) must still show
  // SOMETHING, or it's indistinguishable from "disabled in Settings" or
  // "still loading" and unreportable when it happens (confirmed report,
  // 2026-09-02: a Windows build that could genuinely no longer launch
  // `claude` showed nothing at all, not even the error badge below).
  if (fetchedAt === null && !error) return null;

  const noData = windows.length === 0;
  const sessionWindow = windows.find((w): w is Extract<UsageWindow, { kind: 'session' }> => w.kind === 'session');
  const weekWindows = windows.filter((w): w is Extract<UsageWindow, { kind: 'week' }> => w.kind === 'week');
  // The aggregate cap by identity, not by position: the cache's `limits[]`
  // order is the API's, not something to depend on. Falls back to the first
  // weekly window for an account that only has scoped ones.
  const primaryWeek = weekWindows.find((w) => w.modelLabel === null) ?? weekWindows[0] ?? null;
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
              <span className={`usage-indicator-metric ${metricClass(sessionWindow.percent, isWindowExpired(sessionWindow))}`}>
                <LuTimer size={12} strokeWidth={2} />
                {metricText(sessionWindow, isWindowExpired(sessionWindow))}
              </span>
            )}
            {sessionWindow && primaryWeek && <span className="usage-indicator-sep">·</span>}
            {primaryWeek && (
              <span className={`usage-indicator-metric ${metricClass(primaryWeek.percent, isWindowExpired(primaryWeek))}`}>
                <LuCalendarDays size={12} strokeWidth={2} />
                {metricText(primaryWeek, isWindowExpired(primaryWeek))}
              </span>
            )}
            {primaryWeek && fableWeek && <span className="usage-indicator-sep">·</span>}
            {fableWeek && (
              <span className={`usage-indicator-metric ${metricClass(fableWeek.percent, isWindowExpired(fableWeek))}`}>
                <LuBrain size={12} strokeWidth={2} />
                {metricText(fableWeek, isWindowExpired(fableWeek))}
              </span>
            )}
          </>
        )}
      </button>

      {open && (
        <div className="session-menu-popover usage-popover" onClick={(event) => event.stopPropagation()}>
          <span className="session-menu-label">{t('usageTitle')}</span>
          {windows.map((w) => {
            const expired = isWindowExpired(w);
            const resets = formatResetTime(language, w.resetsAt);
            // Not every window carries a reset time — a per-model weekly cap
            // arrives with resets_at: null. Dropping the line entirely beats
            // an empty one under the label.
            const resetsText = expired ? t('usageExpired') : resets ? (language === 'ja' ? `${resets} にリセット` : `resets ${resets}`) : null;
            return (
              <div className="usage-popover-row" key={windowKey(w)}>
                <span className="usage-popover-row-label">
                  {usageWindowLabel(language, w)}
                  {resetsText && <span className="usage-popover-resets">{resetsText}</span>}
                </span>
                <span className={`usage-popover-row-value ${metricClass(w.percent, expired)}`}>{metricText(w, expired)}</span>
              </div>
            );
          })}
          {noData && !error && <p className="usage-popover-error">{t(parseFailure === 'no-limits' ? 'usageNoLimits' : 'usageParseFailed')}</p>}
          {error && <p className="usage-popover-error">{error}</p>}
          <div className="session-menu-divider" />
          <div className="usage-popover-footer">
            <span className="usage-popover-updated">{measuredAt ? formatMeasured(language, measuredAt) : ''}</span>
            {/* force: true — a plain re-read cannot change anything the
                user is looking at here. The CLI's cache is the only source,
                and only `claude -p "/usage"` moves it. */}
            <button type="button" className="usage-popover-refresh" disabled={loading || refreshing} onClick={() => refresh(true)}>
              {refreshing ? t('usageRefreshing') : t('usageRefreshButton')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
