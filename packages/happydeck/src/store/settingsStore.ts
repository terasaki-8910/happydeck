import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FontChoice = 'system' | 'inter' | 'rounded' | 'compact';

export const FONT_STACKS: Record<FontChoice, string> = {
  system: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
  // Falls back to the system stack wherever Inter isn't installed — no font file is bundled with the app.
  inter: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
  rounded: `'SF Pro Rounded', ui-rounded, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
  compact: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`,
};

export const FONT_LABELS: Record<FontChoice, string> = {
  system: 'System default',
  inter: 'Inter (if installed)',
  rounded: 'Rounded',
  compact: 'Compact',
};

export interface NotificationPrefs {
  done: boolean;
  permission: boolean;
  question: boolean;
}

export type Language = 'en' | 'ja';

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ja: '日本語',
};

// macOS has no OS-level "default terminal" the way it has a default
// browser — `openWith` always needs a specific app name. 'system' picks
// happydeck's own best-effort per-platform guess (Terminal.app on macOS);
// the other two are explicit user overrides, so switching terminal apps
// later is a settings change, not a code change.
export type TerminalAppChoice = 'system' | 'terminal' | 'iterm';

export const TERMINAL_APP_LABELS: Record<TerminalAppChoice, string> = {
  system: 'System default',
  terminal: 'Terminal',
  iterm: 'iTerm',
};

/** Whether "Open in Terminal" opens a new tab in the existing window, or a new window. */
export type TerminalWindowMode = 'tab' | 'window';

export const TERMINAL_WINDOW_MODE_LABELS: Record<TerminalWindowMode, string> = {
  tab: 'New tab',
  window: 'New window',
};

interface SettingsState {
  font: FontChoice;
  language: Language;
  terminalApp: TerminalAppChoice;
  terminalWindowMode: TerminalWindowMode;
  defaultPermissionMode: string;
  defaultModelMode: string;
  defaultEffortLevel: string;
  notify: NotificationPrefs;
  // Per-machine "user@host" (or ~/.ssh/config alias) used by "Open in
  // Terminal" for a session running on a machine other than this one — Happy's
  // own protocol has no remote-shell mechanism, so this reuses the SSH access
  // the user already has to their other machines over Tailscale. Keyed by
  // Happy machineId, not host, so it survives a machine's host/IP changing.
  sshTargets: Record<string, string>;
  setFont: (font: FontChoice) => void;
  setLanguage: (language: Language) => void;
  setTerminalApp: (terminalApp: TerminalAppChoice) => void;
  setTerminalWindowMode: (mode: TerminalWindowMode) => void;
  setDefaultAgentOptions: (opts: { permissionMode?: string; modelMode?: string; effortLevel?: string }) => void;
  setNotifyPref: (key: keyof NotificationPrefs, value: boolean) => void;
  setSshTarget: (machineId: string, target: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      font: 'system',
      language: 'en',
      terminalApp: 'system',
      terminalWindowMode: 'window',
      defaultPermissionMode: 'default',
      defaultModelMode: 'default',
      defaultEffortLevel: 'medium',
      notify: { done: true, permission: true, question: true },
      sshTargets: {},
      setFont: (font) => set({ font }),
      setLanguage: (language) => set({ language }),
      setTerminalApp: (terminalApp) => set({ terminalApp }),
      setTerminalWindowMode: (terminalWindowMode) => set({ terminalWindowMode }),
      setDefaultAgentOptions: (opts) =>
        set((state) => ({
          defaultPermissionMode: opts.permissionMode ?? state.defaultPermissionMode,
          defaultModelMode: opts.modelMode ?? state.defaultModelMode,
          defaultEffortLevel: opts.effortLevel ?? state.defaultEffortLevel,
        })),
      setNotifyPref: (key, value) => set((state) => ({ notify: { ...state.notify, [key]: value } })),
      setSshTarget: (machineId, target) =>
        set((state) => {
          const sshTargets = { ...state.sshTargets };
          if (target.trim()) sshTargets[machineId] = target.trim();
          else delete sshTargets[machineId];
          return { sshTargets };
        }),
    }),
    { name: 'happydeck-settings' },
  ),
);
