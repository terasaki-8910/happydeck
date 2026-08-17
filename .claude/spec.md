# happydeck スペック (v0.1 — 承認待ち)

`.claude/requirements.md` を出発点に、リサーチ(happy本家ソース読解)と質疑応答で確定した内容をまとめたもの。
実装(git worktree単位)に進む前の承認ゲート。

## 決定事項サマリ

| 項目 | 決定 |
|---|---|
| 採用方針 | `happy-desktop`(公式Electron)は不採用。参考程度に留め、Tauriで happydeck をゼロから自作 |
| 対象プロトコル | classic `happy` プロトコル(NaCl暗号化 + socket.ioリレー)。`rig`(新ハーネス)は対象外 — 4台とも classic 確認済み |
| 暗号化/認証実装 | `slopus/happy` 本家ソースを読解した上でのクリーンルーム実装(コピペ不可) |
| デバイス認証 | 新規デバイスリンク1回のみ許容。happydeckがQR表示→既存スマホアプリでスキャン承認(スマホ側改修不要) |
| 対象OS(GUI本体) | Mac のみ。Windows/NixOS/Ubuntu側の `happy` セットアップは完了・動作確認済みで対象外 |
| iPhone | 公式Happyアプリをそのまま使用。開発対象外 |
| タブ/一括操作 | タブ=自由に作れるワークスペース(マシン横断でプロジェクト単位等にグルーピング可)。選択した複数セッションへの一括メッセージ送信・一括permission承認 |
| デザイン方向性 | 個性的・攻めた方向。多数エージェント監視ダッシュボードらしい高密度・ダーク基調・モノスペース中心 |
| リポジトリ構成 | git初期化 + pnpm workspace。`claude-pipeline-template` の厳密な流用はしない |
| 開発モデル | 今回のconversationのまま(Sonnet)で継続。Opus/Fableへの切替は求められていない |

## 非スコープ

- Windows/NixOS/Ubuntu側の `happy` CLI/daemonセットアップ(既に完了済み)
- iPhoneネイティブアプリの開発(既存公式アプリを使用)
- `rig` プロトコルへの対応
- Happyリレーサーバーの自前ホスティング(公式クラウドリレーをそのまま使う前提。将来的な自前ホスティング要望があれば別途)

---

## アーキテクチャ

### パッケージ構成(pnpm workspace)

```
packages/
  happy-wire/       既存。共有 zod スキーマ(protocol types)。そのまま依存
  happy-app/        既存。参考資料のみ(RN/Expo依存でビルド対象外のまま維持)
  happy-client/      新規。フレームワーク非依存のTSライブラリ
                     - crypto/        鍵導出・暗号化(NaCl + AES-256-GCM)
                     - auth/          デバイスリンク(QR発行→ポーリング→鍵復号)、トークン発行(challenge-signature)
                     - transport/     socket.io-client 接続、RPC呼び出し(sessionRPC/machineRPC)
                     - sync/          machines/sessions/messages のローカル状態同期(happy-appのsync.ts/ops.ts/reducer.tsを参考にした再実装)
  happydeck/            新規。Tauriアプリ本体
                     - src/           React + TypeScript UI
                     - src-tauri/     Rustシェル(通知・キーチェーン・ウィンドウ管理)
```

`happy-client` を分離するのは、暗号化/同期ロジックをUIから独立してテストできるようにするため(`happydeck`側は「動くものを都度手で確認」で構わないが、`happy-client`の暗号化まわりは自動テストで担保したい)。

### 技術スタック

- **Tauri v2**。フロントは React + TypeScript。状態管理は Zustand(happy-appの `storage.getState()` パターンと概念が近く、素直に馴染む)。
- **暗号化ライブラリ**: `tweetnacl` または `libsodium-wrappers`(box/secretbox用)+ ブラウザ標準 WebCrypto(`crypto.subtle.encrypt` AES-GCM、`encryptor.ts` のAES256Encryptionに相当。RN専用の `rn-encryption` ネイティブモジュールはTauri/Webでは使えないため置き換え)。
- **QRコード表示**: `qrcode`(npm)でデバイスリンク用QRを描画。
- **認証情報の永続化**: OS標準キーチェーン(Tauri の keyring/stronghold プラグイン)。`{ secret, token }` を保存(モバイル版の `AuthCredentials` 型と同じ形)。
- **通知**: Tauri notification プラグインでMacネイティブ通知。

### 認証・デバイスリンク フロー(確定仕様)

本家 `packages/happy-app/sources/auth/authQRStart.ts` / `authQRWait.ts` / `authChallenge.ts` / `authGetToken.ts` を根拠に、以下をクリーンルーム実装する:

1. **初回リンク**
   - `secret = randomBytes(32)`、`keypair = crypto_box_seed_keypair(secret)`
   - `POST {serverUrl}/v1/auth/account/request { publicKey: base64(keypair.publicKey) }`
   - QRとして `happy:///account?<base64url(keypair.publicKey)>` を表示(**この文字列を認識する既存のスキャナがスマホアプリに既にあるため、スマホ側の変更は不要**)
   - 同エンドポイントを1秒間隔でポーリングし `state === 'authorized'` を待つ
   - 成功時: `{ token, response }` を受信。`response` を `decryptBox(base64decode(response), keypair.secretKey)` → 生の `masterSecret`(Uint8Array)を取得
   - `{ secret: base64(masterSecret), token }` をキーチェーンに保存
2. **トークン再発行(必要な場合はいつでも)**
   - `authChallenge(secret)` → Ed25519署名(`crypto_sign_seed_keypair(secret)` から導出)
   - `POST {serverUrl}/v1/auth { challenge, signature, publicKey }` → 新しい `token`
   - 有効期限切れ/リフレッシュの概念は本家に見当たらず、必要になったらこのchallenge方式で都度取り直す設計で良い

### 鍵導出・暗号化(確定仕様)

`packages/happy-app/sources/sync/encryption/{encryption,encryptor}.ts` 相当をクリーンルーム実装:

- HD鍵導出(独自方式、BIP32ではない):
  ```
  root(seed, usage)        = HMAC-SHA512(key=seed,       msg = usage + " Master Seed") → {key[0:32], chainCode[32:64]}
  child(chainCode, index)  = HMAC-SHA512(key=chainCode,   msg = 0x00 || utf8(index))    → {key, chainCode}
  deriveKey(master, usage, path[]) = root→child…をpathに沿って畳み込み
  ```
- `deriveKey(masterSecret, 'Happy EnCoder', ['content'])` → アカウントの content keypair(X25519、`crypto_box_seed_keypair`)。他デバイスへの「自分宛て暗号化」に使う
- 2層の暗号化を、対象セッション/マシンの状態に応じて切替:
  - **legacy(データキー未設定)**: `SecretBoxEncryption` — `masterSecret` で直接 NaCl `crypto_secretbox_easy`(nonce 24byte + ciphertext+tag)
  - **新方式(per-session/per-machine AESキーあり)**: `AES256Encryption` — ランダム32byte AESキーをcontent keypairへBox暗号化してサーバに保存、実データは AES-256-GCM(先頭1byteはバージョンタグ `0x00`)
  - どちらを使うかは既存実装の `Encryption.openEncryption()` の分岐をそのまま踏襲(4台の稼働中セッションが新旧混在している前提で両対応必須)
- バイナリ添付ファイルは常に NaCl secretbox(専用のblobキー)

### 同期・操作まわり(プロトコルは`happy-wire`にほぼ揃っている)

- セッション内イベント: `sessionEnvelopeSchema`(text/tool-call/turn-start/turn-end等)
- rig系メタデータ: `RigMetadataV1Schema`(model/permissionMode/reasoning/yolo等のoperating mode、activity.subagents等) — permission mode・model・reasoning effort切替の必須要件はここで満たせる
- 主要RPC(`happy-app/sources/sync/ops.ts` 参考、`happy-client`で再実装):
  - `machineSpawnNewSession` — 新規セッション起動(タスク投入)
  - `sessionSetAgentModes` — permission mode / model / reasoning切替
  - `sessionAllow` / `sessionDeny` — permission許可/拒否(一括操作の対象)
  - `sessionAbort` / `sessionKill` — 中断/強制終了
  - `machineBash` / `sessionBash` — シェル実行(sudo込みyolo系はこの経路)

---

## UI設計方針(初回叩き台。最終承認は別途「見た目」レビューで)

- **配色**: ダーク基調をデフォルト(ライトは任意対応)。モノスペースフォント中心
- **メイン画面**: グリッドで複数セッションを同時表示。各タイルに直接メッセージ送信可能(チャット型、フルターミナル忠実性は不要)
- **タブ**: ユーザーが自由に作成するワークスペース。マシン横断でセッションをグルーピング可能
- **タイル内**: 直近のチャット/ツール呼び出し状況、`RigActivitySchema`由来のsubagent稼働数、permission mode / model / reasoning effort切替(必須要件)
- **一括操作**: タブ内で複数セッションを選択 → 同一メッセージを一括送信 / permissionリクエストを一括承認
- **通知**: Macネイティブ通知(Tauri notification plugin)。トリガー条件・ミュート等の詳細は別途詰める

---

## 未解決・実装中に検証が必要な点

1. `authAccountApprove` のサーバ側状態遷移は未確認(happydeck は requester側のみ実装するため通常は不要だが、E2Eで詰まったら要確認)
2. AES-256-GCMのnonce/IV生成方法は `rn-encryption` ネイティブ実装依存で完全には未確認 → WebCrypto実装時に、既存の暗号文を正しく復号できるかで実地検証する
3. 一括操作のUXの詳細(全滅コマンド確認ダイアログの要否、部分失敗時の表示など)は実装しながら詰める

---

## マイルストーン(段階的・機械検証ゲート付き)

| # | 内容 | 受け入れ基準(機械検証) | 状態 |
|---|---|---|---|
| M1 | `happy-client`: 暗号化・デバイスリンク単体実装 | このMacをuser-scopedデバイスとしてリンクでき、既存セッションのメタデータを実際に復号できる(スクリプト/テストで確認) | ✅ 完了(2026-08-16, commit `0bc299a`) |
| M2 | 読み取り専用: 1台分のセッション一覧+ライブ表示 | 実際に動いているMac上のセッションのテキストがリアルタイムに表示される | ✅ 完了(2026-08-17, commit `d4537a6`) |
| M3 | 4台横断のグリッド + タブ(ワークスペース) | 4台のセッションが1画面に同時表示され、タブでグルーピングできる | ✅ 完了(2026-08-17, commit `dfab911`) |
| M4 | 操作系: メッセージ送信・permission/model/reasoning切替・allow/deny・abort/kill・新規セッション起動 | 各操作が実機のセッションに反映される | ✅ 完了(2026-08-17, commit `2759041`)。使い捨てセッションをspawnして実地検証。allow/denyのみ、実機で保留中のpermission requestが発生しなかったため未実地確認(sessionRPCの共通実装は他操作で検証済み) |
| M5 | 一括操作(複数選択→一括送信・一括承認) | 複数セッションへの一括操作が動作する | ✅ 完了(2026-08-17, commit `27b1eb3`)。使い捨てセッション2件をspawnして実地検証(選択→一括送信が正しい対象に届くことを確認) |
| M6 | Macネイティブ通知 | セッション完了等で通知が飛ぶ | ⚠️ コードは完了・実地確認は一部保留(2026-08-17)。`tauri-plugin-notification` を導入し、`ephemeral: session-event`(モバイルpushと同じ発火源)を検知して`sendNotification`を呼ぶところまで実装。デバッグ出力で`isPermissionGranted()=true`・`sendNotification()`が例外なく完了することは実機で確認したが、**バナー自体は表示されなかった**(通知センターにも記録なし)。原因はコード側ではなく、未署名devビルドがmacOSの「アプリケーションの通知」一覧で既定スタイル「オフ」になっている可能性が高い(同リストの他の未使用アプリも軒並み「オフ」)。本番ビルド(署名済み)で解消するか、システム設定 > 通知 > happydeck でスタイルを手動有効化する必要がある。次回起動時にユーザーご自身で確認をお願いしたい |
| M7 | デザイン仕上げ | 見た目レビュー(人間ゲート) | 未着手。ユーザーから「見た目は微妙」との一次コメントあり(2026-08-17)、詳細フィードバックは保留中 |

M1〜M2はセキュリティ・プロトコル互換性の検証が主目的のため優先。M7以前でも「見た目の方向性」自体は早期(M2〜M3あたり)に一度レビューをもらう想定。
