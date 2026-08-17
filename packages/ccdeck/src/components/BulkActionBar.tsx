import { type FormEvent, useState } from 'react';
import { type AgentState, useHappyStore } from '../store/happyStore';
import { useSelectionStore } from '../store/selectionStore';

export function BulkActionBar() {
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
    setResult(failed === 0 ? `${label}: ${outcomes.length} ok` : `${label}: ${outcomes.length - failed} ok, ${failed} failed`);
    setBusy(false);
  };

  const handleSend = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    runBulk(
      'send',
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
    runBulk('approve', tasks);
  };

  return (
    <div className="bulk-bar">
      <span className="bulk-count">{selected.size} selected</span>
      <form className="bulk-send" onSubmit={handleSend}>
        <input
          className="bulk-send-input"
          value={draft}
          disabled={busy}
          placeholder={`message ${selected.size} session${selected.size === 1 ? '' : 's'}…`}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          send to all
        </button>
      </form>
      <button type="button" disabled={busy || pendingCount === 0} onClick={handleApproveAll}>
        approve all pending ({pendingCount})
      </button>
      {result && <span className="bulk-result">{result}</span>}
      <button type="button" className="bulk-clear" disabled={busy} onClick={clear}>
        clear
      </button>
    </div>
  );
}
