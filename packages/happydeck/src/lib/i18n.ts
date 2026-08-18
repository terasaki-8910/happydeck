import { useSettingsStore, type Language } from '../store/settingsStore';

/**
 * Lightweight i18n — a flat key→string dictionary per language, no
 * external library. Covers the app's visible chrome (sidebar, menus,
 * settings, composer); dynamic content (session titles, paths, protocol
 * error text) stays as-is regardless of language.
 */
const STRINGS = {
  en: {
    newSession: 'new session',
    workspaces: 'workspaces',
    newTab: 'new tab',
    all: 'All',
    pinned: 'pinned',
    noSessions: 'no sessions',
    noMessages: '(no messages)',
    pin: 'Pin',
    unpin: 'Unpin',
    rename: 'Rename…',
    resume: 'Resume',
    addToProject: 'Add to project',
    delete: 'Delete',
    abort: 'Abort',
    downloadTranscript: 'Download transcript',
    openInTerminal: 'Open in Terminal',
    killProcess: 'Kill process',
    messagePlaceholder: 'message this session…',
    send: 'send',
    statusOnline: 'online',
    statusOffline: 'offline',
    statusThinking: 'thinking',
    settingsGeneral: 'General',
    settingsTerminal: 'Terminal',
    settingsAccount: 'Account',
    settingsPrivacy: 'Privacy',
    settingsClaudeMd: 'CLAUDE.md',
    font: 'Font',
    language: 'Language',
    linkedMachines: 'Linked machines',
    notifications: 'Notifications',
    sessionFinished: 'Session finished',
    permissionNeeded: 'Permission needed',
    questionFromAgent: 'Question from agent',
    summarizeProgress: 'Summarize progress',
    summarizeProgressPrompt: 'Briefly summarize your current progress on this task in 1-2 sentences.',
  },
  ja: {
    newSession: '新規セッション',
    workspaces: 'ワークスペース',
    newTab: '新規タブ',
    all: 'すべて',
    pinned: 'ピン留め',
    noSessions: 'セッションがありません',
    noMessages: '(メッセージなし)',
    pin: 'ピン留め',
    unpin: 'ピン留め解除',
    rename: '名前を変更…',
    resume: '再開',
    addToProject: 'プロジェクトへ追加',
    delete: '削除',
    abort: '中断',
    downloadTranscript: '文字起こしをダウンロード',
    openInTerminal: 'ターミナルで開く',
    killProcess: 'プロセスを強制終了',
    messagePlaceholder: 'このセッションにメッセージを送る…',
    send: '送信',
    statusOnline: 'オンライン',
    statusOffline: 'オフライン',
    statusThinking: '思考中',
    settingsGeneral: '一般',
    settingsTerminal: 'ターミナル',
    settingsAccount: 'アカウント',
    settingsPrivacy: 'プライバシー',
    settingsClaudeMd: 'CLAUDE.md',
    font: 'フォント',
    language: '言語',
    linkedMachines: '連携済みマシン',
    notifications: '通知',
    sessionFinished: 'セッション完了',
    permissionNeeded: '許可が必要',
    questionFromAgent: 'エージェントからの質問',
    summarizeProgress: '進捗を要約',
    summarizeProgressPrompt: '現在の進捗を1〜2文で簡潔に要約してください。',
  },
} satisfies Record<Language, Record<string, string>>;

export type TranslationKey = keyof (typeof STRINGS)['en'];

export function translate(language: Language, key: TranslationKey): string {
  return STRINGS[language][key] ?? STRINGS.en[key];
}

/** `const t = useT(); t('newSession')` — reactive to the current language setting. */
export function useT() {
  const language = useSettingsStore((s) => s.language);
  return (key: TranslationKey) => translate(language, key);
}
