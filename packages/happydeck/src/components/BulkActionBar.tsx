import { type FormEvent, useState } from 'react';
import { type AgentState, useHappyStore } from '../store/happyStore';
import { useSelectionStore } from '../store/selectionStore';
import { useSettingsStore } from '../store/settingsStore';
import { useT } from '../lib/i18n';

/** "send: 3 ok" / "approve: 2 ok, 1 failed" — kept as a language-conditional
 * sentence builder (like BulkKillMenu's forMachine/forWorkspace) rather than
 * forced through the flat t() dictionary, since it interpolates a count. */
function formatBulkResult(language: 'en' | 'ja', label: string, okCount: number, failedCount: number): string {
  if (language === 'ja') {
    return failedCount === 0 ? `${label}: ${okCount}件成功` : `${label}: ${okCount}件成功、${failedCount}件失敗`;
  }
  return failedCount === 0 ? `${label}: ${okCount} ok` : `${label}: ${okCount} ok, ${failedCount} failed`;
}

export function BulkActionBar() {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const selected = useSelectionStore((s) => s.selected);
  const clear = useSelectionStore((s) => s.clear);
  const sessions = useHappyStore((s) => s.sessions);
  const sendMessage = useHappyStore((s) => s.sendMessage);
  const allowRequest = useHappyStore((s) => s.allowRequest);

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const selectedSessions = sessions.filter((s) => selected.has(s.id));

  if (selected.size === 0) {
    return null;
  }

  const pendingCount = selectedSessions.reduce((sum, s) => {
    const agentState = s.agentState as AgentState | null;
    return sum + Object.keys(agentState?.requests ?? {}).length;
  }, 0);

  const runBulk = async (label: string, tasks: Array<() => Promise<unknown>>) => {
    setBusy(true);
    setResult(null);
    const outcomes = await Promise.allSettled(tasks.map((task) => task()));
    const failed = outcomes.filter((o) => o.status === 'rejected').length;
    setResult(formatBulkResult(language, label, outcomes.length - failed, failed));
    setBusy(false);
  };

  const handleSend = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    runBulk(
      t('bulkActionSend'),
      selectedSessions.map((s) => () => sendMessage(s.id, text)),
    );
  };

  const handleApproveAll = () => {
    const tasks: Array<() => Promise<unknown>> = [];
    for (const session of selectedSessions) {
      const agentState = session.agentState as AgentState | null;
      for (const requestId of Object.keys(agentState?.requests ?? {})) {
        tasks.push(() => allowRequest(session.id, requestId));
      }
    }
    if (tasks.length === 0) return;
    runBulk(t('bulkActionApprove'), tasks);
  };

  const selectedCountLabel = language === 'ja' ? `${selected.size}件選択中` : `${selected.size} selected`;
  const messagePlaceholder =
    language === 'ja' ? `${selected.size}件のセッションにメッセージを送信…` : `message ${selected.size} session${selected.size === 1 ? '' : 's'}…`;
  const approveAllLabel = language === 'ja' ? `保留中をすべて承認 (${pendingCount})` : `approve all pending (${pendingCount})`;

  return (
    <div className="bulk-bar">
      <span className="bulk-count">{selectedCountLabel}</span>
      <form className="bulk-send" onSubmit={handleSend}>
        <input className="bulk-send-input" value={draft} disabled={busy} placeholder={messagePlaceholder} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" disabled={busy || !draft.trim()}>
          {t('bulkSendToAll')}
        </button>
      </form>
      <button type="button" disabled={busy || pendingCount === 0} onClick={handleApproveAll}>
        {approveAllLabel}
      </button>
      {result && <span className="bulk-result">{result}</span>}
      <button type="button" className="bulk-clear" disabled={busy} onClick={clear}>
        {t('bulkClear')}
      </button>
    </div>
  );
}
