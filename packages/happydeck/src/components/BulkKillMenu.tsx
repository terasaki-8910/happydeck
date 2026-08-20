import { useEffect, useRef, useState } from 'react';
import { LuSkull } from 'react-icons/lu';
import { useT } from '../lib/i18n';
import { type AgentState, type LiveSession, useHappyStore } from '../store/happyStore';
import { useSettingsStore } from '../store/settingsStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ConfirmDialog } from './ConfirmDialog';

function isIdle(session: LiveSession): boolean {
  if (!session.active || session.thinking) return false;
  const agentState = session.agentState as AgentState | null;
  return Object.keys(agentState?.requests ?? {}).length === 0;
}

interface KillTarget {
  /** Already-localized — "all running sessions" / "ホスト名のセッション" / etc, built at pick-time so this doesn't need its own translation lookup at render time. */
  description: string;
  sessions: LiveSession[];
}

/**
 * Bulk-kill by criteria (all / idle-only / per-machine / per-workspace) —
 * distinct from selectionStore's manual per-tile checkbox selection
 * (BulkActionBar), which is for "pick some tiles, send/approve to them."
 * This is filter-driven: you're not picking sessions one at a time, you're
 * saying "everything finished" or "everything on that machine."
 */
export function BulkKillMenu() {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const sessions = useHappyStore((s) => s.sessions);
  const machines = useHappyStore((s) => s.machines);
  const killSession = useHappyStore((s) => s.killSession);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<KillTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    // Capture phase, not bubble — Tauri's own document-level drag-region
    // mousedown listener (window/scripts/drag.js) calls
    // stopImmediatePropagation() for any click landing on a
    // data-tauri-drag-region element (the titlebar), which runs before any
    // later-registered bubble-phase listener on document ever fires.
    // Capture fires first regardless of registration order, so this
    // still sees the click.
    document.addEventListener('mousedown', onOutside, true);
    return () => document.removeEventListener('mousedown', onOutside, true);
  }, [open]);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), 4000);
    return () => clearTimeout(timer);
  }, [result]);

  // Killing an already-offline session is a no-op — every target here is
  // scoped to running sessions only, so the count shown is what will
  // actually happen.
  const activeSessions = sessions.filter((s) => s.active);
  const idleSessions = activeSessions.filter(isIdle);

  const machineTargets = machines
    .map((machine) => {
      const host = (machine.metadata as { host?: string } | null)?.host ?? machine.id;
      const onThisMachine = activeSessions.filter((s) => (s.metadata as { machineId?: string } | null)?.machineId === machine.id);
      return { key: machine.id, label: host, sessions: onThisMachine };
    })
    .filter((entry) => entry.sessions.length > 0);

  const workspaceTargets = workspaces
    .map((workspace) => ({
      key: workspace.id,
      label: workspace.name,
      sessions: activeSessions.filter((s) => workspace.sessionIds.includes(s.id)),
    }))
    .filter((entry) => entry.sessions.length > 0);

  // Machine/workspace names are user data, not translatable — the
  // surrounding phrase is language-conditional the same way
  // explainResumeError builds its own full sentences, rather than forcing
  // this through the flat single-string t() dictionary.
  const forMachine = (host: string) => (language === 'ja' ? `${host}のセッション` : `sessions on ${host}`);
  const forWorkspace = (name: string) => (language === 'ja' ? `ワークスペース「${name}」のセッション` : `sessions in ${name}`);

  const runKill = async (sessionsToKill: LiveSession[]) => {
    setTarget(null);
    setBusy(true);
    const outcomes = await Promise.allSettled(sessionsToKill.map((s) => killSession(s.id)));
    const failed = outcomes.filter((o) => o.status === 'rejected').length;
    const ok = outcomes.length - failed;
    setResult(
      failed === 0
        ? language === 'ja'
          ? `${outcomes.length}件を終了しました`
          : `killed ${outcomes.length}`
        : language === 'ja'
          ? `${ok}件を終了、${failed}件失敗`
          : `killed ${ok}, ${failed} failed`,
    );
    setBusy(false);
  };

  const pick = (description: string, targetSessions: LiveSession[]) => {
    setOpen(false);
    setTarget({ description, sessions: targetSessions });
  };

  // Nothing to kill with zero sessions — a lone skull icon sitting in an
  // otherwise-empty titlebar had nothing to act on, which read as clutter
  // rather than a real control.
  if (sessions.length === 0) return null;

  return (
    <div className="bulk-kill" ref={rootRef}>
      <button
        type="button"
        className="sidebar-footer-icon bulk-kill-trigger"
        title={t('killSessions')}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
      >
        <LuSkull size={15} strokeWidth={2} />
      </button>

      {result && <span className="bulk-kill-result">{result}</span>}

      {open && (
        <div className="session-menu-popover action-menu-popover bulk-kill-popover">
          <button type="button" disabled={activeSessions.length === 0} onClick={() => pick(t('bulkKillTargetAll'), activeSessions)}>
            {t('killAllSessions')} ({activeSessions.length})
          </button>
          <button type="button" disabled={idleSessions.length === 0} onClick={() => pick(t('bulkKillTargetIdle'), idleSessions)}>
            {t('killIdleSessions')} ({idleSessions.length})
          </button>

          {machineTargets.length > 0 && (
            <>
              <div className="session-menu-divider" />
              <span className="session-menu-label">{t('killByMachine')}</span>
              {machineTargets.map((entry) => (
                <button type="button" key={entry.key} onClick={() => pick(forMachine(entry.label), entry.sessions)}>
                  {entry.label} ({entry.sessions.length})
                </button>
              ))}
            </>
          )}

          {workspaceTargets.length > 0 && (
            <>
              <div className="session-menu-divider" />
              <span className="session-menu-label">{t('killByWorkspace')}</span>
              {workspaceTargets.map((entry) => (
                <button type="button" key={entry.key} onClick={() => pick(forWorkspace(entry.label), entry.sessions)}>
                  {entry.label} ({entry.sessions.length})
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {target && (
        <ConfirmDialog
          title={
            language === 'ja'
              ? `${target.sessions.length}件のセッションを終了しますか？`
              : `Kill ${target.sessions.length} session${target.sessions.length === 1 ? '' : 's'}?`
          }
          body={
            language === 'ja'
              ? `対象: ${target.description}（${target.sessions.length}件）。${t('bulkKillConfirmBody')}`
              : `${t('bulkKillConfirmBody')} Target: ${target.description} (${target.sessions.length} total).`
          }
          confirmLabel={language === 'ja' ? `${target.sessions.length}件を終了` : `kill ${target.sessions.length}`}
          danger
          onConfirm={() => runKill(target.sessions)}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  );
}
