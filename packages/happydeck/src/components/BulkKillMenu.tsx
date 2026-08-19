import { useEffect, useRef, useState } from 'react';
import { LuSkull } from 'react-icons/lu';
import { useT } from '../lib/i18n';
import { type AgentState, type LiveSession, useHappyStore } from '../store/happyStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ConfirmDialog } from './ConfirmDialog';

function isIdle(session: LiveSession): boolean {
  if (!session.active || session.thinking) return false;
  const agentState = session.agentState as AgentState | null;
  return Object.keys(agentState?.requests ?? {}).length === 0;
}

interface KillTarget {
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
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
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

  const runKill = async (sessionsToKill: LiveSession[]) => {
    setTarget(null);
    setBusy(true);
    const outcomes = await Promise.allSettled(sessionsToKill.map((s) => killSession(s.id)));
    const failed = outcomes.filter((o) => o.status === 'rejected').length;
    setResult(failed === 0 ? `killed ${outcomes.length}` : `killed ${outcomes.length - failed}, ${failed} failed`);
    setBusy(false);
  };

  const pick = (description: string, targetSessions: LiveSession[]) => {
    setOpen(false);
    setTarget({ description, sessions: targetSessions });
  };

  return (
    <div className="bulk-kill" ref={rootRef}>
      <button
        type="button"
        className="sidebar-footer-icon"
        title={t('killSessions')}
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
      >
        <LuSkull size={15} strokeWidth={2} />
      </button>

      {result && <span className="bulk-kill-result">{result}</span>}

      {open && (
        <div className="session-menu-popover action-menu-popover bulk-kill-popover">
          <button type="button" disabled={activeSessions.length === 0} onClick={() => pick('all running sessions', activeSessions)}>
            {t('killAllSessions')} ({activeSessions.length})
          </button>
          <button type="button" disabled={idleSessions.length === 0} onClick={() => pick('idle sessions', idleSessions)}>
            {t('killIdleSessions')} ({idleSessions.length})
          </button>

          {machineTargets.length > 0 && (
            <>
              <div className="session-menu-divider" />
              <span className="session-menu-label">{t('killByMachine')}</span>
              {machineTargets.map((entry) => (
                <button type="button" key={entry.key} onClick={() => pick(`sessions on ${entry.label}`, entry.sessions)}>
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
                <button type="button" key={entry.key} onClick={() => pick(`sessions in ${entry.label}`, entry.sessions)}>
                  {entry.label} ({entry.sessions.length})
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {target && (
        <ConfirmDialog
          title={`Kill ${target.sessions.length} session${target.sessions.length === 1 ? '' : 's'}?`}
          body={`This immediately terminates the CLI process for ${target.description} (${target.sessions.length} total) on whichever machine each is running on. Cannot be undone.`}
          confirmLabel={`kill ${target.sessions.length}`}
          danger
          onConfirm={() => runKill(target.sessions)}
          onCancel={() => setTarget(null)}
        />
      )}
    </div>
  );
}
