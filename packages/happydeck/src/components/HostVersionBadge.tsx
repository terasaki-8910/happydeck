import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LuLoaderCircle } from 'react-icons/lu';
import { type TranslationKey, useT } from '../lib/i18n';
import { compareVersions } from '../lib/machineVersions';
import { useHappyStore } from '../store/happyStore';
import { type MachineProbeTarget, type Tool, type ToolState, useMachineVersionStore } from '../store/machineVersionStore';
import { useSettingsStore } from '../store/settingsStore';
import { ConfirmDialog } from './ConfirmDialog';

// Long enough that dragging the cursor ACROSS the badge on the way
// somewhere else doesn't fire four probe RPCs at a machine, short enough
// that deliberately resting on it feels immediate.
const OPEN_DELAY_MS = 180;
// The popover is portalled to <body>, so it is not a DOM descendant of the
// badge and the pointer "leaves" the badge on the way into it. This is the
// grace that makes that trip survivable; both elements cancel the timer on
// enter.
const CLOSE_GRACE_MS = 160;
const POPOVER_WIDTH = 280;
const VIEWPORT_MARGIN = 8;

interface MachineMetadata {
  platform?: string;
  happyHomeDir?: string;
  /** Version of the happy CLI that REGISTERED this machine — i.e. what the daemon is running, not what is on disk. */
  happyCliVersion?: string;
}

function relativeTime(language: 'en' | 'ja', timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return language === 'ja' ? 'たった今確認' : 'checked just now';
  if (minutes < 60) return language === 'ja' ? `${minutes}分前に確認` : `checked ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return language === 'ja' ? `${hours}時間前に確認` : `checked ${hours}h ago`;
}

/**
 * The machine badge in a session tile's header, plus the popover it opens
 * on hover: which happy CLI and Claude Code that machine is running, how
 * far behind npm's latest each one is, and a button to update it in place.
 *
 * Why this lives on the badge: the badge already answers "which machine is
 * this session on", and the two versions are the next thing you want when
 * the answer matters — a model id a newer Claude Code knows and an older
 * one doesn't (lib/agentOptions.ts) fails at spawn time on THAT machine,
 * not here.
 */
export function HostVersionBadge({ host, machineId }: { host: string; machineId: string | undefined }) {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const machines = useHappyStore((s) => s.machines);
  const entry = useMachineVersionStore((s) => (machineId ? s.byMachine[machineId] : undefined));
  const latest = useMachineVersionStore((s) => s.latest);
  const ensure = useMachineVersionStore((s) => s.ensure);
  const refresh = useMachineVersionStore((s) => s.refresh);
  const runUpdate = useMachineVersionStore((s) => s.runUpdate);
  const dismissUpdate = useMachineVersionStore((s) => s.dismissUpdate);

  const [open, setOpen] = useState(false);
  // A ref, not state: pinning changes no rendering, and the close timer's
  // callback has to read the CURRENT value. As state it read the value
  // captured when the timer was armed, which is exactly wrong here — the
  // trip from the Update button to the confirm dialog arms a close timer
  // while unpinned, and confirming then pins; a stale `false` in that
  // callback closed the popover 160ms after the update had started, hiding
  // its own output.
  const pinnedRef = useRef(false);
  const [confirming, setConfirming] = useState<Tool | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const metadata = (machines.find((m) => m.id === machineId)?.metadata ?? null) as MachineMetadata | null;
  const target: MachineProbeTarget | null = machineId
    ? { machineId, platform: metadata?.platform ?? 'darwin', happyHomeDir: metadata?.happyHomeDir ?? null }
    : null;

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const scheduleOpen = () => {
    if (!machineId) return;
    clearTimers();
    if (open) return;
    openTimer.current = window.setTimeout(() => {
      setOpen(true);
      ensure(machineId);
    }, OPEN_DELAY_MS);
  };

  const scheduleClose = () => {
    clearTimers();
    if (pinnedRef.current) return;
    closeTimer.current = window.setTimeout(() => {
      if (pinnedRef.current) return;
      setOpen(false);
    }, CLOSE_GRACE_MS);
  };

  const close = useCallback(() => {
    clearTimers();
    pinnedRef.current = false;
    setOpen(false);
  }, [clearTimers]);

  // Position against the badge, clamped into the viewport. Portalled and
  // fixed rather than absolutely positioned inside the tile: `.tile` is
  // overflow:hidden with a max-height, so anything anchored in its header
  // would simply be cut off part-way down.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = badgeRef.current?.getBoundingClientRect();
      if (!rect) return;
      // The whole document is scaled with CSS `zoom` on :root — 1.1 by
      // default and user-adjustable from 0.2 to 10 (lib/zoomHotkeys.ts).
      // getBoundingClientRect() and window.innerWidth are in VISUAL
      // pixels, while an inline `left` on this portalled child of <body>
      // is interpreted in the ZOOMED space, so handing the rect straight
      // back lands the popover off by the zoom factor — measured ~24px
      // right of the badge at the default 1.1, and proportionally worse
      // after a few Cmd+=. Clamp in visual pixels, write in zoomed ones.
      const zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
      const visualWidth = POPOVER_WIDTH * zoom;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - visualWidth - VIEWPORT_MARGIN));
      setAnchor({ left: left / zoom, top: (rect.bottom + 4) / zoom });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      // Hand focus back where it came from, so Escape out of a
      // keyboard-opened popover doesn't drop the user at the top of the
      // document. Guarded on the popover actually holding focus — Escape
      // while merely hovering must not yank focus to the badge.
      if (popoverRef.current?.contains(document.activeElement)) badgeRef.current?.focus();
    };
    const onOutside = (event: MouseEvent) => {
      const node = event.target as Node;
      if (badgeRef.current?.contains(node) || popoverRef.current?.contains(node)) return;
      close();
    };
    window.addEventListener('keydown', onEscape);
    // Capture phase, same reason as UsageIndicator's: Tauri's drag-region
    // handler calls stopImmediatePropagation for clicks on the titlebar.
    document.addEventListener('mousedown', onOutside, true);
    return () => {
      window.removeEventListener('keydown', onEscape);
      document.removeEventListener('mousedown', onOutside, true);
    };
  }, [open, close]);

  if (!machineId || !target) return <span className="tile-host tile-host-plain">{host}</span>;

  const update = entry?.update ?? null;
  const confirmTool = confirming;
  const confirmCommand = confirmTool ? (confirmTool === 'happy' ? entry?.happy : entry?.claude)?.updateCommand ?? '' : '';

  const startUpdate = (tool: Tool) => {
    setConfirming(null);
    // Pin so an install's output doesn't vanish the moment the pointer
    // drifts off. The poll itself lives in the store and survives either
    // way — this is only about not yanking it off screen mid-run.
    clearTimers();
    pinnedRef.current = true;
    setOpen(true);
    void runUpdate(target, tool);
  };

  return (
    <>
      <button
        type="button"
        ref={badgeRef}
        className="tile-host"
        aria-expanded={open}
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={scheduleOpen}
        onClick={(event) => {
          event.stopPropagation();
          clearTimers();
          if (open && pinnedRef.current) {
            close();
            return;
          }
          pinnedRef.current = true;
          setOpen(true);
          ensure(machineId);
          // The popover is portalled to <body>, so Tab from the badge walks
          // into the next tile control, not into the popover. Moving focus
          // onto the popover itself (tabIndex -1) is what puts its buttons
          // next in the tab order — the only way to reach Update from the
          // keyboard. rAF because the node only exists after this state
          // update commits.
          requestAnimationFrame(() => popoverRef.current?.focus());
        }}
      >
        {host}
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={popoverRef}
            className="host-version-popover"
            role="dialog"
            aria-label={host}
            tabIndex={-1}
            style={{ left: anchor.left, top: anchor.top, width: POPOVER_WIDTH }}
            onMouseEnter={clearTimers}
            onMouseLeave={scheduleClose}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="host-version-head">
              <span className="host-version-host">{host}</span>
              {metadata?.platform && <span className="host-version-platform">{metadata.platform}</span>}
            </div>

            <VersionRow
              label="happy"
              loading={entry?.status === 'loading'}
              tool={entry?.happy ?? null}
              latest={latest.happy}
              note={runningHappyNote(language, entry?.happy?.installed ?? null, metadata?.happyCliVersion ?? null)}
              busy={update !== null && update.exitCode === null && update.failure === null}
              onUpdate={() => setConfirming('happy')}
              t={t}
            />
            <VersionRow
              label="Claude Code"
              loading={entry?.status === 'loading'}
              tool={entry?.claude ?? null}
              latest={latest.claude}
              note={entry?.claude?.method && entry.claude.method !== 'unknown' ? entry.claude.method : null}
              busy={update !== null && update.exitCode === null && update.failure === null}
              onUpdate={() => setConfirming('claude')}
              t={t}
            />

            {entry?.unreachable && <p className="host-version-error">{t('hostVersionUnreachable')}</p>}
            {latest.unreachable && !latest.loading && <p className="host-version-error">{t('hostVersionRegistryUnreachable')}</p>}

            {update && (
              <div className="host-version-update">
                <div className="host-version-update-head">
                  <code>{update.command}</code>
                  <button type="button" className="host-version-dismiss" onClick={() => dismissUpdate(machineId)}>
                    {t('close')}
                  </button>
                </div>
                {update.failure === 'launchFailed' && <p className="host-version-error">{`${t('hostVersionLaunchFailed')} ${update.detail ?? ''}`}</p>}
                {update.failure === 'noScratchDir' && <p className="host-version-error">{t('hostVersionNoScratchDir')}</p>}
                {update.failure === 'pollTimeout' && <p className="host-version-error">{t('hostVersionPollTimeout')}</p>}
                {update.output && <pre className="host-version-log">{update.output}</pre>}
                {update.exitCode === null && update.failure === null && (
                  <p className="host-version-running">
                    <LuLoaderCircle className="host-version-spin" size={11} strokeWidth={2} />
                    {t('hostVersionUpdating')}
                  </p>
                )}
                {update.exitCode === 0 && <p className="host-version-ok">{update.tool === 'happy' ? t('hostVersionHappyUpdated') : t('hostVersionClaudeUpdated')}</p>}
                {update.exitCode !== null && update.exitCode !== 0 && <p className="host-version-error">{`${t('hostVersionUpdateFailed')} (exit ${update.exitCode})`}</p>}
              </div>
            )}

            <div className="host-version-footer">
              <span className="host-version-checked">{entry?.checkedAt ? relativeTime(language, entry.checkedAt) : ''}</span>
              <button type="button" className="host-version-recheck" disabled={entry?.status === 'loading'} onClick={() => void refresh(machineId)}>
                {entry?.status === 'loading' ? t('hostVersionChecking') : t('hostVersionRecheck')}
              </button>
            </div>
          </div>,
          document.body,
        )}

      {confirmTool && (
        <ConfirmDialog
          title={t('hostVersionConfirmTitle')}
          body={`${t('hostVersionConfirmBody')}\n\n${host}: ${confirmCommand}`}
          confirmLabel={t('hostVersionConfirmRun')}
          onConfirm={() => startUpdate(confirmTool)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}

/**
 * happy-cli's version is reported twice and the two can legitimately
 * disagree: `happyCliVersion` in the machine's metadata is whatever the
 * DAEMON registered with, while the probe reads what is on disk now.
 * After an update they differ until the daemon is restarted, and saying so
 * is the whole point — otherwise an update looks like it did nothing.
 */
function runningHappyNote(language: 'en' | 'ja', installed: string | null, running: string | null): string | null {
  if (!installed || !running || installed === running) return null;
  return language === 'ja' ? `起動中は ${running}（デーモン再起動で反映）` : `daemon still running ${running} — restart to pick it up`;
}

function VersionRow({
  label,
  loading,
  tool,
  latest,
  note,
  busy,
  onUpdate,
  t,
}: {
  label: string;
  loading: boolean;
  tool: ToolState | null;
  latest: string | null;
  note: string | null;
  busy: boolean;
  onUpdate: () => void;
  t: (key: TranslationKey) => string;
}) {
  const comparison = compareVersions(tool?.installed ?? null, latest);
  return (
    <div className="host-version-item">
      <div className="host-version-row">
        <span className="host-version-label">{label}</span>
        <span className="host-version-values">
          {loading && !tool ? (
            <span className="host-version-dim">{t('hostVersionChecking')}</span>
          ) : !tool || !tool.installed ? (
            <span className="host-version-dim">{t('hostVersionNotFound')}</span>
          ) : (
            <>
              <span className={comparison === 'behind' ? 'host-version-stale' : ''}>{tool.installed}</span>
              {comparison === 'behind' && latest && <span className="host-version-latest">→ {latest}</span>}
              {comparison === 'current' && <span className="host-version-dim">{t('hostVersionUpToDate')}</span>}
            </>
          )}
        </span>
        {comparison === 'behind' &&
          (tool?.updateCommand ? (
            <button type="button" className="host-version-update-button" disabled={busy} onClick={onUpdate}>
              {t('hostVersionUpdate')}
            </button>
          ) : (
            <span className="host-version-manual" title={t('hostVersionManualHint')}>
              {t('hostVersionManual')}
            </span>
          ))}
      </div>
      {/* Full-width rather than stacked under the label: both notes are
          sentences ("daemon still running 1.2.4 — restart to pick it up"),
          and squeezed into the label column they wrapped to three lines and
          pushed the version and its button apart. */}
      {note && <p className="host-version-note">{note}</p>}
    </div>
  );
}
