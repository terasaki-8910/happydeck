import { useEffect, useState } from 'react';
import { CLAUDE_EFFORT_LEVELS, CLAUDE_MODEL_MODES, CLAUDE_PERMISSION_MODES } from '../lib/agentOptions';
import { joinPath } from '../lib/paths';
import { useHappyStore } from '../store/happyStore';
import { FONT_LABELS, type FontChoice, type NotificationPrefs, useSettingsStore } from '../store/settingsStore';

type Section = 'general' | 'account' | 'privacy' | 'claudemd';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'claudemd', label: 'CLAUDE.md' },
];

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [section, setSection] = useState<Section>('general');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="settings-dialog" onClick={(event) => event.stopPropagation()}>
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`settings-nav-item ${section === s.id ? 'settings-nav-item-active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <button type="button" className="settings-close" title="Close (Esc)" onClick={onClose}>
            ×
          </button>
          {section === 'general' && <GeneralSection />}
          {section === 'account' && <AccountSection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'claudemd' && <ClaudeMdSection />}
        </div>
      </div>
    </div>
  );
}

function GeneralSection() {
  const font = useSettingsStore((s) => s.font);
  const setFont = useSettingsStore((s) => s.setFont);
  const defaultPermissionMode = useSettingsStore((s) => s.defaultPermissionMode);
  const defaultModelMode = useSettingsStore((s) => s.defaultModelMode);
  const defaultEffortLevel = useSettingsStore((s) => s.defaultEffortLevel);
  const setDefaultAgentOptions = useSettingsStore((s) => s.setDefaultAgentOptions);

  return (
    <div className="settings-section">
      <h2>General</h2>

      <label className="settings-field">
        <span>Font</span>
        <select value={font} onChange={(event) => setFont(event.target.value as FontChoice)}>
          {(Object.keys(FONT_LABELS) as FontChoice[]).map((key) => (
            <option key={key} value={key}>
              {FONT_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-hint">Applies to prose/UI text. Code and commands always stay monospace.</p>

      <h3>Default new-session options</h3>
      <p className="settings-hint">Used as the starting point in the spawn panel — you can still change any of these per session.</p>

      <label className="settings-field">
        <span>Permission mode</span>
        <select value={defaultPermissionMode} onChange={(event) => setDefaultAgentOptions({ permissionMode: event.target.value })}>
          {CLAUDE_PERMISSION_MODES.map((mode) => (
            <option key={mode.key} value={mode.key}>
              {mode.name}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        <span>Model</span>
        <select value={defaultModelMode} onChange={(event) => setDefaultAgentOptions({ modelMode: event.target.value })}>
          {CLAUDE_MODEL_MODES.map((model) => (
            <option key={model.key} value={model.key}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        <span>Reasoning effort</span>
        <select value={defaultEffortLevel} onChange={(event) => setDefaultAgentOptions({ effortLevel: event.target.value })}>
          {CLAUDE_EFFORT_LEVELS.map((effort) => (
            <option key={effort.key} value={effort.key}>
              {effort.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function AccountSection() {
  const localMachineId = useHappyStore((s) => s.localMachineId);
  const machines = useHappyStore((s) => s.machines);

  return (
    <div className="settings-section">
      <h2>Account</h2>
      <p className="settings-hint">
        happydeck reuses your existing Happy account — there's no separate login. The account is identified by the
        device-linked master secret stored in the macOS Keychain.
      </p>
      <label className="settings-field">
        <span>This machine</span>
        <span className="settings-value">{localMachineId ?? 'unknown'}</span>
      </label>
      <label className="settings-field">
        <span>Linked machines</span>
        <span className="settings-value">{machines.length}</span>
      </label>
    </div>
  );
}

function PrivacySection() {
  const notify = useSettingsStore((s) => s.notify);
  const setNotifyPref = useSettingsStore((s) => s.setNotifyPref);

  const rows: { key: keyof NotificationPrefs; label: string }[] = [
    { key: 'done', label: 'Session finished' },
    { key: 'permission', label: 'Permission needed' },
    { key: 'question', label: 'Question from agent' },
  ];

  return (
    <div className="settings-section">
      <h2>Privacy</h2>
      <h3>Notifications</h3>
      <p className="settings-hint">Which session events trigger a native Mac notification.</p>
      {rows.map((row) => (
        <label key={row.key} className="settings-checkbox">
          <input type="checkbox" checked={notify[row.key]} onChange={(event) => setNotifyPref(row.key, event.target.checked)} />
          <span>{row.label}</span>
        </label>
      ))}
    </div>
  );
}

function ClaudeMdSection() {
  const machines = useHappyStore((s) => s.machines);
  const readMachineFile = useHappyStore((s) => s.readMachineFile);
  const writeMachineFile = useHappyStore((s) => s.writeMachineFile);

  const [machineId, setMachineId] = useState('');
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const selectedMachine = machines.find((m) => m.id === machineId);
  const homeDir = (selectedMachine?.metadata as { homeDir?: string } | null)?.homeDir;
  const path = homeDir ? joinPath(joinPath(homeDir, '.claude'), 'CLAUDE.md') : null;

  const load = (id: string) => {
    setMachineId(id);
    setContent(null);
    setError(null);
    setSaved(false);
    const machine = machines.find((m) => m.id === id);
    const home = (machine?.metadata as { homeDir?: string } | null)?.homeDir;
    if (!home) return;
    const filePath = joinPath(joinPath(home, '.claude'), 'CLAUDE.md');
    setLoading(true);
    readMachineFile(id, filePath)
      .then((result) => {
        if (result.success) setContent(result.content);
        else setError(result.error);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  };

  const save = () => {
    if (!path || content === null) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    writeMachineFile(machineId, path, content)
      .then((result) => {
        if (result.success) setSaved(true);
        else setError(result.error);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  return (
    <div className="settings-section settings-section-claudemd">
      <h2>CLAUDE.md</h2>
      <p className="settings-hint">
        View and edit each machine's global <code>~/.claude/CLAUDE.md</code> from here. Reads/writes go straight to that
        machine's filesystem — no session needs to be running there.
      </p>
      <label className="settings-field">
        <span>Machine</span>
        <select value={machineId} onChange={(event) => load(event.target.value)}>
          <option value="" disabled>
            select…
          </option>
          {machines.map((machine) => {
            const host = (machine.metadata as { host?: string } | null)?.host ?? machine.id;
            return (
              <option key={machine.id} value={machine.id}>
                {host}
              </option>
            );
          })}
        </select>
      </label>

      {loading && <p className="settings-hint">loading…</p>}
      {error && <p className="settings-error">{error}</p>}

      {content !== null && !loading && (
        <>
          <textarea className="settings-claudemd-editor" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} />
          <div className="settings-claudemd-actions">
            <button type="button" disabled={saving} onClick={save}>
              {saving ? 'saving…' : 'save'}
            </button>
            {saved && <span className="settings-saved">saved</span>}
          </div>
        </>
      )}
    </div>
  );
}
