import { type FormEvent, useState } from 'react';
import { LuPlus } from 'react-icons/lu';
import { useT } from '../lib/i18n';
import { useHappyStore } from '../store/happyStore';
import { useSettingsStore } from '../store/settingsStore';
import { useViewStore } from '../store/viewStore';
import { DirectoryBrowser } from './DirectoryBrowser';

export function SpawnPanel() {
  const t = useT();
  const machines = useHappyStore((s) => s.machines);
  const spawnSession = useHappyStore((s) => s.spawnSession);
  const localMachineId = useHappyStore((s) => s.localMachineId);
  const focusSession = useViewStore((s) => s.focusSession);
  const defaultPermissionMode = useSettingsStore((s) => s.defaultPermissionMode);
  const defaultModelMode = useSettingsStore((s) => s.defaultModelMode);
  const defaultEffortLevel = useSettingsStore((s) => s.defaultEffortLevel);
  const language = useSettingsStore((s) => s.language);
  const lastSpawnMachineId = useSettingsStore((s) => s.lastSpawnMachineId);
  const lastSpawnDirectoryByMachine = useSettingsStore((s) => s.lastSpawnDirectoryByMachine);
  const setLastSpawnLocation = useSettingsStore((s) => s.setLastSpawnLocation);

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

  // Prefer the machine/directory used last time (so starting another
  // session on the same project doesn't mean re-picking both every time);
  // fall back to this machine itself the very first time, before anything's
  // ever been recorded. Directory is looked up per-machine — a path from a
  // different machine is meaningless once a different one is selected.
  const defaultMachineId = (): string => {
    if (lastSpawnMachineId && onlineMachines.some((m) => m.id === lastSpawnMachineId)) return lastSpawnMachineId;
    if (localMachineId && onlineMachines.some((m) => m.id === localMachineId)) return localMachineId;
    return '';
  };

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
        setError(t('spawnNoResponse'));
      } else if (result.type === 'success') {
        setLastSpawnLocation(machineId, directory.trim());
        setOpen(false);
        setDirectory('');
        setNeedsApproval(false);
        // Land on the session you just created, the way starting a new
        // chat/window in any similar app jumps you straight into it.
        focusSession(result.sessionId);
      } else if (result.type === 'requestToApproveDirectoryCreation') {
        setNeedsApproval(true);
        setError(
          language === 'ja'
            ? `「${result.directory}」はまだ存在しません — もう一度送信すると作成します`
            : `"${result.directory}" doesn't exist yet — submit again to create it`,
        );
      } else if (result.type === 'pending') {
        setError(language === 'ja' ? `まだ起動中です — ${result.retryAfterMs}ms後に再試行してください` : `Still starting — retry in ${result.retryAfterMs}ms`);
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
      <button
        type="button"
        className="spawn-toggle"
        onClick={() => {
          const machine = defaultMachineId();
          setMachineId(machine);
          setDirectory(machine ? (lastSpawnDirectoryByMachine[machine] ?? '') : '');
          setOpen(true);
        }}
      >
        <LuPlus size={13} strokeWidth={2.5} />
        {t('newSession')}
      </button>
    );
  }

  return (
    <form className="spawn-panel" onSubmit={submit}>
      <select
        value={machineId}
        onChange={(event) => {
          const nextMachineId = event.target.value;
          setMachineId(nextMachineId);
          setDirectory(lastSpawnDirectoryByMachine[nextMachineId] ?? '');
          setNeedsApproval(false);
        }}
      >
        <option value="" disabled>
          {t('spawnMachinePlaceholder')}
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
          placeholder={t('spawnDirectoryPlaceholder')}
          onChange={(event) => {
            setDirectory(event.target.value);
            setNeedsApproval(false);
          }}
        />
        <button type="button" disabled={!machineId} title={t('spawnBrowseTitle')} onClick={() => setBrowsing(true)}>
          {t('spawnBrowse')}
        </button>
      </div>
      <button type="submit" className="spawn-start" disabled={busy || !machineId || !directory.trim()}>
        {needsApproval ? t('spawnCreateAndStart') : t('spawnStart')}
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
        {t('cancel')}
      </button>
      {error && <span className="spawn-error">{error}</span>}

      {browsing && machineId && (
        <DirectoryBrowser
          machineId={machineId}
          platform={(selectedMachine?.metadata as { platform?: string } | null)?.platform ?? 'darwin'}
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
