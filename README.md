# 📦slack-archiver
Slackのパブリックチャンネルを自動でアーカイブするBotです。
最終投稿から一定日数が経過したチャンネルを対象に、**事前警告 → リアクション待機 → アーカイブ** の流れで安全に管理します。

---

## 機能

- 最終投稿から指定日数（デフォルト: 180日）経過したパブリックチャンネルを自動アーカイブ
- アーカイブ N 日前（デフォルト: 2日前）に対象チャンネルへ警告メッセージをBotが投稿
- 警告後にリアクション or メッセージがあればアーカイブを自動停止
- 除外チャンネルの設定（`general` / `random` など永続チャンネルを守る）
- アーカイブ日数・警告タイミングを設定ファイルで変更可能
- **Dry Run モード**対応（実際にはアーカイブせずログのみ出力）
- 毎日 09:00 JST に自動実行（cron スケジュール変更可能）

---

## 動作フロー

```
[毎日 09:00 JST]
      │
      ▼
全パブリックチャンネルを取得
      │
      ├─ 除外チャンネル？ ──→ スキップ
      │
      ├─ 経過日数 >= archiveDays - warnDaysBefore
      │     └─ 警告メッセージを投稿 → 状態を保存
      │
      └─ 警告済み & 猶予期間終了
            ├─ リアクション or 新規メッセージあり ──→ アーカイブ取りやめ
            └─ アクションなし ──→ アーカイブ実行
```

---

## 必要な Slack Bot スコープ

Slack App の **OAuth & Permissions** で以下を追加してください。

| スコープ | 用途 |
|---|---|
| `channels:read` | チャンネル一覧取得 |
| `channels:history` | 投稿履歴・リアクション確認 |
| `channels:manage` | チャンネルのアーカイブ |
| `chat:write` | 警告メッセージ投稿 |
| `reactions:read` | リアクション確認 |

---

## セットアップ

### 1. リポジトリをクローン

```bash
git clone https://github.com/<your-org>/slack-archiver.git
cd slack-archiver
```

### 2. 依存パッケージをインストール

```bash
npm install
```

### 3. 環境変数を設定

```bash
cp .env.example .env
# .env を編集して SLACK_BOT_TOKEN と SLACK_SIGNING_SECRET を設定
```

### 4. 設定ファイルを確認・編集

`config/settings.json` を編集します。

```json
{
  "archiveDays": 180,
  "warnDaysBefore": 2,
  "excludeChannels": ["general", "random", "announce"],
  "timezone": "Asia/Tokyo",
  "dryRun": true,
  "cronSchedule": "0 9 * * *"
}
```

| 設定キー | デフォルト | 説明 |
|---|---|---|
| `archiveDays` | `180` | 最終投稿から何日後にアーカイブするか |
| `warnDaysBefore` | `2` | アーカイブの何日前に警告するか |
| `excludeChannels` | `["general","random",...]` | アーカイブしないチャンネル名（# なし） |
| `timezone` | `"Asia/Tokyo"` | cron 実行タイムゾーン |
| `dryRun` | `true` | `true` の間はアーカイブを実行しない |
| `cronSchedule` | `"0 9 * * *"` | 実行スケジュール（cron 形式） |

> **初回は必ず `dryRun: true` のまま動作確認してください。**

### 5. Dry Run で動作確認

```bash
npm run dry-run
```

アーカイブされる予定のチャンネルがログに出力されます。問題なければ `dryRun: false` に変更して本番運用を開始します。

---

## ローカル開発

```bash
npm run dev        # ts-node-dev でホットリロード起動
npm run typecheck  # 型チェック
npm run lint       # ESLint
npm test           # テスト実行（vitest）
npm run test:watch # ウォッチモード
npm run test:coverage # カバレッジレポート
```

---

## デプロイ（Railway）

このアプリは HTTP サーバーを持たない **Worker プロセス**として動作します。

```bash
# Railway CLI をインストール
npm install -g @railway/cli

# ログイン・プロジェクト作成
railway login
railway init

# 環境変数を設定
railway variables set SLACK_BOT_TOKEN=xoxb-xxxx
railway variables set SLACK_SIGNING_SECRET=xxxx
railway variables set TZ=Asia/Tokyo
railway variables set DRY_RUN=false

# デプロイ
railway up
```

Render を使う場合も同様に環境変数を設定し、Start Command を `npm start` に設定してください。

---

## 環境変数一覧

| 変数名 | 必須 | 説明 |
|---|---|---|
| `SLACK_BOT_TOKEN` | ✅ | `xoxb-` で始まる Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | ✅ | Slack App の Signing Secret |
| `ERROR_NOTIFY_CHANNEL` | | エラーと実行サマリーを通知するチャンネル ID |
| `ARCHIVE_DAYS` | | `settings.json` の `archiveDays` を上書き |
| `WARN_DAYS_BEFORE` | | `settings.json` の `warnDaysBefore` を上書き |
| `DRY_RUN` | | `false` で本番実行（デフォルト: true） |
| `RUN_ONCE` | | `true` で即時1回実行して終了（手動実行・CI 用） |
| `LOG_LEVEL` | | `debug` / `info` / `error` |
| `TZ` | | `Asia/Tokyo`（Railway はデフォルト UTC） |

---

## プロジェクト構成

```
slack-archiver/
├── src/
│   ├── index.ts          # エントリーポイント
│   ├── scheduler.ts      # cron ジョブ定義
│   ├── archiver.ts       # アーカイブ判定・実行ロジック
│   ├── notifier.ts       # 警告メッセージ投稿
│   ├── config.ts         # 設定読み込み・バリデーション
│   ├── state.ts          # 警告済み状態の永続化
│   ├── types.ts          # 共通型定義
│   └── slack/
│       └── client.ts     # Slack API ラッパー（全 API 呼び出しを集約）
├── config/
│   └── settings.json     # アーカイブ設定
├── tests/
│   ├── archiver.test.ts  # アーカイブ判定ロジックのテスト
│   └── config.test.ts    # 設定バリデーションのテスト
├── .claude/              # Claude Code 設定
│   ├── rules/            # Slack API・テスト・デプロイのルール
│   ├── commands/         # カスタムコマンド（/check, /dry-run など）
│   └── agents/           # サブエージェント定義
├── .env.example
├── CLAUDE.md
├── package.json
├── tsconfig.json
└── railway.toml
```

---

## ライセンス
MIT