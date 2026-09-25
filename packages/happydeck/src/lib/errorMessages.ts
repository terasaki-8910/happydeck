import type { Language } from '../store/settingsStore';

/**
 * Wraps whatever bootstrap() failed on (see App.tsx's status==='error'
 * branch) — often a raw OS/library string (e.g. a macOS Security framework
 * Keychain error) that can't itself be translated, so this at least gives
 * it a Japanese sentence of context instead of showing English with
 * nothing around it.
 */
export function bootstrapFailedError(language: Language, detail: string): string {
  return language === 'ja' ? `起動に失敗しました: ${detail}` : `Failed to start: ${detail}`;
}

export function sessionExitedWithCodeText(language: Language, code: number): string {
  return language === 'ja' ? `セッションが終了しました（コード ${code}）` : `Session exited (code ${code})`;
}

/** Headline for a background-task notice whose own <summary> is missing — see formatMessage.ts's taskNotificationPart. */
export function backgroundTaskFallbackText(language: Language): string {
  return language === 'ja' ? 'バックグラウンドタスク' : 'Background task';
}

export function notConnectedError(language: Language): string {
  return language === 'ja' ? 'サーバーに接続されていません' : 'Not connected';
}

/** Internal-consistency guard (an id we already hold doesn't exist in our
 * own local map) — should be unreachable in normal use, but still worth a
 * Japanese sentence rather than raw English if it ever does surface. */
export function unknownSessionError(language: Language, sessionId: string): string {
  return language === 'ja' ? `不明なセッションです: ${sessionId}` : `Unknown session ${sessionId}`;
}

export function unknownMachineError(language: Language, machineId: string): string {
  return language === 'ja' ? `不明なマシンです: ${machineId}` : `Unknown machine ${machineId}`;
}

export function noMachineIdToResumeError(language: Language): string {
  return language === 'ja'
    ? 'このセッションには再開先のマシンIDが記録されていません'
    : 'This session has no recorded machineId to resume it on';
}

export function attachmentDecryptFailedError(language: Language): string {
  return language === 'ja'
    ? '添付ファイルの復号に失敗しました（鍵が違うか、データが壊れています）'
    : 'Failed to decrypt attachment (wrong key or corrupted blob)';
}

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

/** Summary only — the raw failure text rides along as DetailedError's `detail`, so it can be shown on demand instead of inline. */
export function attachmentWriteFailedError(language: Language, host: string): string {
  return language === 'ja'
    ? `ファイルの添付に失敗しました。${host} 側でファイルを書き込む処理が失敗しています（ファイルの内容の問題ではありません）。`
    : `Couldn't attach the file. Writing it on ${host} failed — this is about the transfer, not the file's contents.`;
}

/**
 * A command sent to the session's machine came back rejected by that
 * machine's own shell. Overwhelmingly this means the two ends disagree
 * about what the command should look like — i.e. happydeck here is older
 * or newer than the build that machine expects — so the actionable advice
 * is to line the versions up, not to inspect the shell error.
 */
export function attachmentCommandRejectedError(language: Language, host: string): string {
  return language === 'ja'
    ? `ファイルの添付に失敗しました。${host} 側のシェルがコマンドを受け付けませんでした。happydeck のバージョンが古い可能性があるため、両方のマシンで最新版に更新してから再度お試しください。`
    : `Couldn't attach the file — the shell on ${host} rejected the command. This usually means happydeck is out of date; update it on both machines and try again.`;
}

export function attachmentTimedOutError(language: Language, host: string): string {
  return language === 'ja'
    ? `ファイルの添付がタイムアウトしました。${host} からの応答がありません。接続状況を確認してから再度お試しください。`
    : `Attaching the file timed out — ${host} stopped responding. Check that machine's connection and try again.`;
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

export function claudeUsageTimeoutError(language: Language): string {
  return language === 'ja'
    ? '~/.claude.json からの使用量の読み込みがタイムアウトしました。ローカルファイルの読み込みなので、Tauriのipcブリッジ自体が固まっている可能性が高いです。'
    : 'Reading usage from ~/.claude.json timed out. This is a plain local file read, so the Tauri IPC bridge itself is the likely culprit.';
}

export function claudeUsageRefreshTimeoutError(language: Language): string {
  return language === 'ja'
    ? '使用量の更新（claude -p "/usage"）がタイムアウトしました。Claude Codeの起動に時間がかかっているか、アカウントAPIに到達できていない可能性があります。'
    : 'Refreshing usage (claude -p "/usage") timed out. Claude Code may be slow to start, or unable to reach the account API.';
}

/**
 * Turns the stable failure codes src-tauri/src/claude_usage.rs returns into
 * something the user can act on. An unrecognized code falls through
 * verbatim rather than being swallowed — a Rust-side message we haven't
 * localized yet is still far more useful on screen than a generic one.
 */
export function localizeUsageError(language: Language, raw: string): string {
  const code = raw.split(':', 1)[0].trim();
  switch (code) {
    case 'missing-file':
      return language === 'ja'
        ? '~/.claude.json が見つかりません。このマシンでClaude Codeがまだ一度も実行されていないようです。'
        : "~/.claude.json doesn't exist — Claude Code appears to have never run on this machine.";
    case 'no-usage-data':
      return language === 'ja'
        ? 'Claude Codeが使用量をまだキャッシュしていません（~/.claude.json に cachedUsageUtilization がありません）。ログインが切れているか、Claude Codeが古い可能性があります。'
        : "Claude Code hasn't cached any usage yet (no cachedUsageUtilization in ~/.claude.json) — its login may have gone stale, or the CLI may be too old to write it.";
    case 'corrupt':
      // The CLI rewrites this file wholesale, so a read can land mid-write.
      // The Rust side already retries; reaching here means every retry lost
      // the race, which the next poll routinely fixes on its own.
      return language === 'ja'
        ? '~/.claude.json の読み込み中に書き換えが発生しました。次回の取得で自動的に回復します。'
        : '~/.claude.json was being rewritten while it was read. The next poll normally recovers on its own.';
    default:
      return raw;
  }
}

/**
 * The three ways resolving a session's own Remote Control URL can come back
 * empty (see remoteControl.ts). None of them is a bug in happydeck, so each
 * names the one thing the user can do about it instead of just failing:
 * Remote Control has to be turned on from the session's own machine, and
 * that machine has to be reachable to be asked whether it is.
 */
export function remoteControlNotConnectedError(language: Language, host: string): string {
  return language === 'ja'
    ? `このセッションではリモートコントロールが有効になっていません。${host} 側のこのセッションで /remote-control を実行してください。`
    : `Remote Control isn't on for this session — run /remote-control in it, on ${host}.`;
}

export function remoteControlNoEntryError(language: Language, host: string): string {
  return language === 'ja'
    ? `${host} 上にこのセッションのClaude Codeプロセスが見つかりません。すでに終了しているか、リモートコントロールに対応していないバージョンです。`
    : `No live Claude Code process for this session on ${host} — it has already exited, or its CLI is too old for Remote Control.`;
}

export function remoteControlUnreachableError(language: Language, host: string): string {
  return language === 'ja'
    ? `${host} にリモートコントロールの状態を問い合わせられませんでした。`
    : `Couldn't ask ${host} whether Remote Control is on.`;
}
