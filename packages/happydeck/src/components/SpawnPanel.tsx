import { type FormEvent, useState } from 'react';
import { useT } from '../lib/i18n';
import { useHappyStore } from '../store/happyStore';
import { useSettingsStore } from '../store/settingsStore';
import { DirectoryBrowser } from './DirectoryBrowser';

export function SpawnPanel() {
  const t = useT();
  const machines = useHappyStore((s) => s.machines);
  const spawnSession = useHappyStore((s) => s.spawnSession);
  const defaultPermissionMode = useSettingsStore((s) => s.defaultPermissionMode);
  const defaultModelMode = useSettingsStore((s) => s.defaultModelMode);
  const defaultEffortLevel = useSettingsStore((s) => s.defaultEffortLevel);

  const [open, setOpen] = useState(false);
  const [machineId, setMachineId] = useState('');
  const [directory, setDirectory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [browsing, setBrowsing] = useState(false);

  const onlineMachines = machines.filter((m) => m.active);
  const selectedMachine = onlineMachines.find((m) => m.id === machineId);
  const selectedMachineHome = (selectedMachine?.metadata as { homeDir?: string } | null)?.homeDir;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!machineId || !directory.trim() || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await spawnSession({
        machineId,
        directory: directory.trim(),
        approvedNewDirectoryCreation: needsApproval,
        permissionMode: defaultPermissionMode,
        modelMode: defaultModelMode,
        effortLevel: defaultEffortLevel,
      });
      if (!result) {
        setError('No response from the machine (RPC returned nothing decryptable)');
      } else if (result.type === 'success') {
        setOpen(false);
        setDirectory('');
        setNeedsApproval(false);
      } else if (result.type === 'requestToApproveDirectoryCreation') {
        setNeedsApproval(true);
        setError(`"${result.directory}" doesn't exist yet — submit again to create it`);
      } else if (result.type === 'pending') {
        setError(`Still starting — retry in ${result.retryAfterMs}ms`);
      } else {
        setError(result.errorMessage);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="spawn-toggle" onClick={() => setOpen(true)}>
        {t('newSession')}
      </button>
    );
  }

  return (
    <form className="spawn-panel" onSubmit={submit}>
      <select
        value={machineId}
        onChange={(event) => {
          setMachineId(event.target.value);
          setNeedsApproval(false);
        }}
      >
        <option value="" disabled>
          machine…
        </option>
        {onlineMachines.map((machine) => {
          const host = (machine.metadata as { host?: string } | null)?.host ?? machine.id;
          return (
            <option key={machine.id} value={machine.id}>
              {host}
            </option>
          );
        })}
      </select>
      <div className="spawn-directory-row">
        <input
          className="spawn-directory"
          value={directory}
          placeholder="/path/to/project"
          onChange={(event) => {
            setDirectory(event.target.value);
            setNeedsApproval(false);
          }}
        />
        <button type="button" disabled={!machineId} title="Browse this machine's filesystem" onClick={() => setBrowsing(true)}>
          browse…
        </button>
      </div>
      <button type="submit" disabled={busy || !machineId || !directory.trim()}>
        {needsApproval ? 'create + start' : 'start'}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
          setMachineId('');
          setDirectory('');
          setNeedsApproval(false);
        }}
      >
        cancel
      </button>
      {error && <span className="spawn-error">{error}</span>}

      {browsing && machineId && (
        <DirectoryBrowser
          machineId={machineId}
          startPath={directory.trim() || selectedMachineHome || '/'}
          onCancel={() => setBrowsing(false)}
          onSelect={(path) => {
            setDirectory(path);
            setNeedsApproval(false);
            setBrowsing(false);
          }}
        />
      )}
    </form>
  );
}
