import type { Language } from '../store/settingsStore';

export function cwdNotKnownError(language: Language): string {
  return language === 'ja'
    ? 'このセッションの作業ディレクトリがまだ分かっていません — 読み込みが完了してからもう一度試してください。'
    : "This session's working directory isn't known yet — try again once it's loaded.";
}

export function unknownAttachMachineError(language: Language, host: string): string {
  return language === 'ja'
    ? `このセッションのマシン情報が不明です（${host}）— ディレクトリの作成方法が判断できません。`
    : `Unknown machine for this session (${host}) — can't tell how to create a directory there.`;
}

export function attachDisconnectedError(language: Language, host: string): string {
  return language === 'ja'
    ? `${host}への接続が途中で切れました — 自動的に再試行済みです。そのマシンの接続状況を確認してからもう一度試してください。`
    : `Lost connection to ${host} partway through — already retried automatically. Check that machine's connection and try again.`;
}

export function sshTargetMissingError(language: Language, host: string): string {
  return language === 'ja'
    ? `${host}用のSSH接続先が設定されていません — 設定 > ターミナルで設定してください。`
    : `No SSH target configured for ${host} — set one in Settings > Terminal.`;
}

export function terminalOpenFailedError(language: Language, app: string): string {
  return language === 'ja' ? `${app}を開けませんでした` : `Failed to open ${app}`;
}

export function sentButNotResumedError(language: Language, explainedResumeFailure: string): string {
  return language === 'ja'
    ? `メッセージは送信されましたが、このセッションをオンラインに戻せませんでした: ${explainedResumeFailure}`
    : `Message sent, but couldn't bring this session back online: ${explainedResumeFailure}`;
}

export function credentialsReadTimeoutError(language: Language): string {
  return language === 'ja'
    ? 'macOSキーチェーンからのアカウント認証情報の読み込みがタイムアウトしました。キーチェーンへのアクセス許可を求めるダイアログが別のウィンドウの裏に隠れているか、そもそも表示されなかった可能性があります（devビルドはリビルドの度にコード署名が変わるため、これが起きることが分かっています）— 他のSpace/ウィンドウに「happydeckがキーチェーンにアクセスしようとしています」的なダイアログがないか確認してから、再試行してください。繰り返し発生する場合は、キーチェーンアクセス.appで「ccdeck-happy-account」を検索してアクセス制御を確認するか、happydeckを完全に終了して（ウィンドウを閉じるだけでなく）再度開いてみてください。'
    : 'Reading account credentials from the macOS Keychain timed out. A Keychain access prompt may be stuck behind another window, or failed to appear at all (known to happen with dev builds, whose code signature changes on every rebuild) — check for a "happydeck wants to access…" dialog on another Space/window, then Retry. If it keeps happening, try Keychain Access.app → search "ccdeck-happy-account" → check its access control, or quit happydeck fully (not just close the window) and reopen it.';
}

export function credentialsWriteTimeoutError(language: Language): string {
  return language === 'ja'
    ? 'macOSキーチェーンへのアカウント認証情報の保存がタイムアウトしました — 読み込み側のタイムアウトと同じ原因である可能性が高いです。'
    : 'Saving account credentials to the macOS Keychain timed out — same likely cause as the read-side timeout (see getStoredCredentials).';
}

export function localMachineIdTimeoutError(language: Language): string {
  return language === 'ja'
    ? 'このマシンのHappy ID（~/.happy/settings.json）の読み込みが予期せずタイムアウトしました — これは単なるローカルファイルの読み込みなので、発生した場合はキーチェーン固有の問題というより、Tauriのipcブリッジ自体が固まっている可能性が高いです。'
    : "Reading this machine's Happy ID (~/.happy/settings.json) timed out unexpectedly — this is a plain local file read, so if this fires the Tauri IPC bridge itself is likely stuck rather than anything keychain-specific.";
}
