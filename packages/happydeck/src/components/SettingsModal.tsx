import { useEffect, useState } from 'react';
import { CLAUDE_EFFORT_LEVELS, CLAUDE_MODEL_MODES, CLAUDE_PERMISSION_MODES } from '../lib/agentOptions';
import { type TranslationKey, useT } from '../lib/i18n';
import { joinPath } from '../lib/paths';
import { useHappyStore } from '../store/happyStore';
import { FONT_LABELS, type FontChoice, LANGUAGE_LABELS, type Language, type NotificationPrefs, useSettingsStore } from '../store/settingsStore';
import { ToggleSwitch } from './ToggleSwitch';

type Section = 'general' | 'account' | 'privacy' | 'claudemd';

const SECTIONS: { id: Section; labelKey: TranslationKey }[] = [
  { id: 'general', labelKey: 'settingsGeneral' },
  { id: 'account', labelKey: 'settingsAccount' },
  { id: 'privacy', labelKey: 'settingsPrivacy' },
  { id: 'claudemd', labelKey: 'settingsClaudeMd' },
];

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [section, setSection] = useState<Section>('general');
  const t = useT();

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
              {t(s.labelKey)}
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
  const t = useT();
  const font = useSettingsStore((s) => s.font);
  const setFont = useSettingsStore((s) => s.setFont);
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const defaultPermissionMode = useSettingsStore((s) => s.defaultPermissionMode);
  const defaultModelMode = useSettingsStore((s) => s.defaultModelMode);
  const defaultEffortLevel = useSettingsStore((s) => s.defaultEffortLevel);
  const setDefaultAgentOptions = useSettingsStore((s) => s.setDefaultAgentOptions);

  return (
    <div className="settings-section">
      <h2>{t('settingsGeneral')}</h2>

      <label className="settings-field">
        <span>{t('language')}</span>
        <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
          {(Object.keys(LANGUAGE_LABELS) as Language[]).map((key) => (
            <option key={key} value={key}>
              {LANGUAGE_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-hint">Translates the app's own UI chrome. Session content, paths, and error text stay as-is.</p>

      <label className="settings-field">
        <span>{t('font')}</span>
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
  const t = useT();
  const localMachineId = useHappyStore((s) => s.localMachineId);
  const machines = useHappyStore((s) => s.machines);

  return (
    <div className="settings-section">
      <h2>{t('settingsAccount')}</h2>
      <p className="settings-hint">
        happydeck reuses your existing Happy account — there's no separate login. The account is identified by the
        device-linked master secret stored in the macOS Keychain.
      </p>

      <h3>{t('linkedMachines')}</h3>
      <table className="settings-machines-table">
        <thead>
          <tr>
            <th>Device</th>
            <th>Platform</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((machine) => {
            const meta = machine.metadata as { host?: string; platform?: string } | null;
            return (
              <tr key={machine.id}>
                <td>
                  {meta?.host ?? machine.id}
                  {machine.id === localMachineId && <span className="settings-this-machine"> (this machine)</span>}
                </td>
                <td>{meta?.platform ?? '—'}</td>
                <td>
                  <span className={`status-dot ${machine.active ? 'status-online' : 'status-offline'}`} />
                  {machine.active ? t('statusOnline') : t('statusOffline')}
                </td>
              </tr>
            );
          })}
          {machines.length === 0 && (
            <tr>
              <td colSpan={3} className="settings-hint">
                no machines found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PrivacySection() {
  const t = useT();
  const notify = useSettingsStore((s) => s.notify);
  const setNotifyPref = useSettingsStore((s) => s.setNotifyPref);

  const rows: { key: keyof NotificationPrefs; labelKey: TranslationKey }[] = [
    { key: 'done', labelKey: 'sessionFinished' },
    { key: 'permission', labelKey: 'permissionNeeded' },
    { key: 'question', labelKey: 'questionFromAgent' },
  ];

  return (
    <div className="settings-section">
      <h2>{t('settingsPrivacy')}</h2>
      <h3>{t('notifications')}</h3>
      <p className="settings-hint">Which session events trigger a native Mac notification.</p>
      {rows.map((row) => (
        <ToggleSwitch key={row.key} checked={notify[row.key]} onChange={(value) => setNotifyPref(row.key, value)} label={t(row.labelKey)} />
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
  const [isNewFile, setIsNewFile] = useState(false);
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
    setIsNewFile(false);
    setError(null);
    setSaved(false);
    const machine = machines.find((m) => m.id === id);
    const home = (machine?.metadata as { homeDir?: string } | null)?.homeDir;
    if (!home) return;
    const filePath = joinPath(joinPath(home, '.claude'), 'CLAUDE.md');
    setLoading(true);
    readMachineFile(id, filePath)
      .then((result) => {
        if (result.success) {
          setContent(result.content);
        } else if (/ENOENT/i.test(result.error)) {
          // No CLAUDE.md there yet — that's normal, not a failure. Start the
          // editor empty so typing + save just creates the file.
          setContent('');
          setIsNewFile(true);
        } else {
          setError(result.error);
        }
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
        if (result.success) {
          setSaved(true);
          setIsNewFile(false);
        } else {
          setError(result.error);
        }
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
      {isNewFile && !loading && <p className="settings-hint">No CLAUDE.md there yet — start typing and save to create one.</p>}

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
