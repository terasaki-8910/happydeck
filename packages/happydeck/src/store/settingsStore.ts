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

interface SettingsState {
  font: FontChoice;
  defaultPermissionMode: string;
  defaultModelMode: string;
  defaultEffortLevel: string;
  notify: NotificationPrefs;
  setFont: (font: FontChoice) => void;
  setDefaultAgentOptions: (opts: { permissionMode?: string; modelMode?: string; effortLevel?: string }) => void;
  setNotifyPref: (key: keyof NotificationPrefs, value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      font: 'system',
      defaultPermissionMode: 'default',
      defaultModelMode: 'default',
      defaultEffortLevel: 'medium',
      notify: { done: true, permission: true, question: true },
      setFont: (font) => set({ font }),
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
