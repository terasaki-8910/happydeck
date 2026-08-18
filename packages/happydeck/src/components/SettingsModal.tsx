import { useEffect, useState } from 'react';
import { CLAUDE_EFFORT_LEVELS, CLAUDE_MODEL_MODES, CLAUDE_PERMISSION_MODES } from '../lib/agentOptions';
import { type TranslationKey, useT } from '../lib/i18n';
import { joinPath } from '../lib/paths';
import { useHappyStore } from '../store/happyStore';
import {
  FONT_LABELS,
  type FontChoice,
  LANGUAGE_LABELS,
  type Language,
  type NotificationPrefs,
  TERMINAL_APP_LABELS,
  type TerminalAppChoice,
  TERMINAL_WINDOW_MODE_LABELS,
  type TerminalWindowMode,
  THEME_LABELS,
  type Theme,
  useSettingsStore,
} from '../store/settingsStore';
import { ToggleSwitch } from './ToggleSwitch';

type Section = 'general' | 'terminal' | 'account' | 'privacy' | 'claudemd';

const SECTIONS: { id: Section; labelKey: TranslationKey }[] = [
  { id: 'general', labelKey: 'settingsGeneral' },
  { id: 'terminal', labelKey: 'settingsTerminal' },
  { id: 'account', labelKey: 'settingsAccount' },
  { id: 'privacy', labelKey: 'settingsPrivacy' },
  { id: 'claudemd', labelKey: 'settingsClaudeMd' },
];

const THEME_OPTION_KEY: Record<Theme, TranslationKey> = {
  system: 'themeOptionSystem',
  light: 'themeOptionLight',
  dark: 'themeOptionDark',
};

const FONT_OPTION_KEY: Record<FontChoice, TranslationKey> = {
  system: 'fontOptionSystem',
  inter: 'fontOptionInter',
  rounded: 'fontOptionRounded',
  compact: 'fontOptionCompact',
};

const TERMINAL_APP_OPTION_KEY: Record<TerminalAppChoice, TranslationKey> = {
  system: 'terminalAppOptionSystem',
  terminal: 'terminalAppOptionTerminal',
  iterm: 'terminalAppOptionIterm',
};

const WINDOW_MODE_OPTION_KEY: Record<TerminalWindowMode, TranslationKey> = {
  tab: 'windowModeOptionTab',
  window: 'windowModeOptionWindow',
};

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
          <button type="button" className="settings-close" title={`${t('close')} (Esc)`} onClick={onClose}>
            ×
          </button>
          {section === 'general' && <GeneralSection />}
          {section === 'terminal' && <TerminalSection />}
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
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
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
        <span>{t('theme')}</span>
        <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
          {(Object.keys(THEME_LABELS) as Theme[]).map((key) => (
            <option key={key} value={key}>
              {t(THEME_OPTION_KEY[key])}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-hint">{t('themeHint')}</p>

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
      <p className="settings-hint">{t('languageHint')}</p>

      <label className="settings-field">
        <span>{t('font')}</span>
        <select value={font} onChange={(event) => setFont(event.target.value as FontChoice)}>
          {(Object.keys(FONT_LABELS) as FontChoice[]).map((key) => (
            <option key={key} value={key}>
              {t(FONT_OPTION_KEY[key])}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-hint">{t('fontHint')}</p>

      <h3>{t('defaultNewSessionOptions')}</h3>
      <p className="settings-hint">{t('defaultNewSessionOptionsHint')}</p>

      <label className="settings-field">
        <span>{t('permissionModeLabel')}</span>
        <select value={defaultPermissionMode} onChange={(event) => setDefaultAgentOptions({ permissionMode: event.target.value })}>
          {CLAUDE_PERMISSION_MODES.map((mode) => (
            <option key={mode.key} value={mode.key}>
              {mode.name}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        <span>{t('modelLabel')}</span>
        <select value={defaultModelMode} onChange={(event) => setDefaultAgentOptions({ modelMode: event.target.value })}>
          {CLAUDE_MODEL_MODES.map((model) => (
            <option key={model.key} value={model.key}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        <span>{t('reasoningEffort')}</span>
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
      <p className="settings-hint">{t('accountHint')}</p>

      <h3>{t('linkedMachines')}</h3>
      <table className="settings-machines-table">
        <thead>
          <tr>
            <th>{t('device')}</th>
            <th>{t('platform')}</th>
            <th>{t('status')}</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((machine) => {
            const meta = machine.metadata as { host?: string; platform?: string } | null;
            return (
              <tr key={machine.id}>
                <td>
                  {meta?.host ?? machine.id}
                  {machine.id === localMachineId && <span className="settings-this-machine">{t('thisMachine')}</span>}
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
                {t('noMachinesFound')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TerminalSection() {
  const t = useT();
  const localMachineId = useHappyStore((s) => s.localMachineId);
  const machines = useHappyStore((s) => s.machines);
  const terminalApp = useSettingsStore((s) => s.terminalApp);
  const setTerminalApp = useSettingsStore((s) => s.setTerminalApp);
  const terminalWindowMode = useSettingsStore((s) => s.terminalWindowMode);
  const setTerminalWindowMode = useSettingsStore((s) => s.setTerminalWindowMode);
  const sshTargets = useSettingsStore((s) => s.sshTargets);
  const setSshTarget = useSettingsStore((s) => s.setSshTarget);
  const [sshDraft, setSshDraft] = useState<Record<string, string>>({});

  return (
    <div className="settings-section">
      <h2>{t('settingsTerminal')}</h2>
      <p className="settings-hint">{t('terminalHint')}</p>

      <label className="settings-field">
        <span>{t('terminalApp')}</span>
        <select value={terminalApp} onChange={(event) => setTerminalApp(event.target.value as TerminalAppChoice)}>
          {(Object.keys(TERMINAL_APP_LABELS) as TerminalAppChoice[]).map((key) => (
            <option key={key} value={key}>
              {t(TERMINAL_APP_OPTION_KEY[key])}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-hint">{t('terminalAppHint')}</p>

      <label className="settings-field">
        <span>{t('openAs')}</span>
        <select value={terminalWindowMode} onChange={(event) => setTerminalWindowMode(event.target.value as TerminalWindowMode)}>
          {(Object.keys(TERMINAL_WINDOW_MODE_LABELS) as TerminalWindowMode[]).map((key) => (
            <option key={key} value={key}>
              {t(WINDOW_MODE_OPTION_KEY[key])}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-hint">{t('openAsHint')}</p>

      <h3>{t('sshTargets')}</h3>
      <p className="settings-hint">{t('sshTargetsHint')}</p>
      <table className="settings-machines-table">
        <thead>
          <tr>
            <th>{t('device')}</th>
            <th>{t('sshTarget')}</th>
          </tr>
        </thead>
        <tbody>
          {machines.map((machine) => {
            const meta = machine.metadata as { host?: string } | null;
            const isLocal = machine.id === localMachineId;
            const draft = sshDraft[machine.id] ?? sshTargets[machine.id] ?? '';
            return (
              <tr key={machine.id}>
                <td>
                  {meta?.host ?? machine.id}
                  {isLocal && <span className="settings-this-machine">{t('thisMachine')}</span>}
                </td>
                <td>
                  {isLocal ? (
                    <span className="settings-hint">{t('localNoSshNeeded')}</span>
                  ) : (
                    <input
                      type="text"
                      className="settings-ssh-target-input"
                      placeholder="user@host"
                      value={draft}
                      onChange={(event) => setSshDraft((prev) => ({ ...prev, [machine.id]: event.target.value }))}
                      onBlur={() => setSshTarget(machine.id, draft)}
                    />
                  )}
                </td>
              </tr>
            );
          })}
          {machines.length === 0 && (
            <tr>
              <td colSpan={2} className="settings-hint">
                {t('noMachinesFound')}
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
      <p className="settings-hint">{t('notificationsHint')}</p>
      {rows.map((row) => (
        <ToggleSwitch key={row.key} checked={notify[row.key]} onChange={(value) => setNotifyPref(row.key, value)} label={t(row.labelKey)} />
      ))}
    </div>
  );
}

function ClaudeMdSection() {
  const t = useT();
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
      <h2>{t('settingsClaudeMd')}</h2>
      <p className="settings-hint">{t('claudeMdHint')}</p>
      <label className="settings-field">
        <span>{t('machine')}</span>
        <select value={machineId} onChange={(event) => load(event.target.value)}>
          <option value="" disabled>
            {t('selectPlaceholder')}
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

      {loading && <p className="settings-hint">{t('loading')}</p>}
      {error && <p className="settings-error">{error}</p>}
      {isNewFile && !loading && <p className="settings-hint">{t('noClaudeMdYet')}</p>}

      {content !== null && !loading && (
        <>
          <textarea className="settings-claudemd-editor" value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} />
          <div className="settings-claudemd-actions">
            <button type="button" disabled={saving} onClick={save}>
              {saving ? t('saving') : t('save')}
            </button>
            {saved && <span className="settings-saved">{t('saved')}</span>}
          </div>
        </>
      )}
    </div>
  );
}
