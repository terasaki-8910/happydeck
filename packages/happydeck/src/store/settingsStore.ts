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

interface SettingsState {
  font: FontChoice;
  language: Language;
  terminalApp: TerminalAppChoice;
  defaultPermissionMode: string;
  defaultModelMode: string;
  defaultEffortLevel: string;
  notify: NotificationPrefs;
  setFont: (font: FontChoice) => void;
  setLanguage: (language: Language) => void;
  setTerminalApp: (terminalApp: TerminalAppChoice) => void;
  setDefaultAgentOptions: (opts: { permissionMode?: string; modelMode?: string; effortLevel?: string }) => void;
  setNotifyPref: (key: keyof NotificationPrefs, value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      font: 'system',
      language: 'en',
      terminalApp: 'system',
      defaultPermissionMode: 'default',
      defaultModelMode: 'default',
      defaultEffortLevel: 'medium',
      notify: { done: true, permission: true, question: true },
      setFont: (font) => set({ font }),
      setLanguage: (language) => set({ language }),
      setTerminalApp: (terminalApp) => set({ terminalApp }),
      setDefaultAgentOptions: (opts) =>
        set((state) => ({
          defaultPermissionMode: opts.permissionMode ?? state.defaultPermissionMode,
          defaultModelMode: opts.modelMode ?? state.defaultModelMode,
          defaultEffortLevel: opts.effortLevel ?? state.defaultEffortLevel,
        })),
      setNotifyPref: (key, value) => set((state) => ({ notify: { ...state.notify, [key]: value } })),
    }),
    { name: 'happydeck-settings' },
  ),
);
