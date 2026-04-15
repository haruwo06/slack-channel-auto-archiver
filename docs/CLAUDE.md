# Slack Channel Auto-Archiver

## プロジェクト概要

Slack のパブリックチャンネルを自動でアーカイブする Bot アプリケーション。
最終投稿から一定日数が経過したチャンネルを対象に、事前警告 → リアクション待機 → アーカイブ の流れで動作する。

- **Runtime**: Node.js 20+ (Volta 管理)
- **Language**: TypeScript 5 (strict モード)
- **Framework**: Slack Bolt for JavaScript
- **Scheduler**: node-cron
- **Deploy**: Railway または Render (無料枠対応)
- **Config Store**: 環境変数 + `config/settings.json`（除外チャンネル・日数設定）

## ディレクトリ構成

```
slack-archiver/
├── CLAUDE.md
├── CLAUDE.local.md          # ローカル専用設定（gitignore）
├── .claude/
│   ├── settings.json
│   ├── commands/            # カスタムスラッシュコマンド
│   ├── rules/               # 追加ルール群
│   └── agents/              # サブエージェント定義
├── src/
│   ├── index.ts             # エントリーポイント（Bolt app 起動）
│   ├── scheduler.ts         # cron ジョブ定義
│   ├── archiver.ts          # アーカイブロジック本体
│   ├── notifier.ts          # 警告メッセージ投稿ロジック
│   ├── config.ts            # 設定読み込み・バリデーション
│   └── types.ts             # 共通型定義
├── config/
│   └── settings.json        # 除外チャンネル・日数設定ファイル
├── tests/
│   ├── archiver.test.ts
│   ├── notifier.test.ts
│   └── config.test.ts
├── .env.example
├── package.json
├── tsconfig.json
└── railway.toml             # デプロイ設定
```

## アーキテクチャ・設計原則

### 処理フロー
```
[cron: 毎日 09:00 JST]
  └─ scheduler.ts
       ├─ archiver.ts: 期限切れチャンネル一覧取得
       ├─ notifier.ts: 残り2日チャンネルに警告投稿
       └─ archiver.ts: 警告済み・猶予期間終了チャンネルをアーカイブ
```

### アーカイブ判定ロジック
1. 全パブリックチャンネルを取得（`conversations.list`）
2. 除外リストに含まれるチャンネルはスキップ
3. `conversations.history` で最終投稿日時を確認
4. `今日 - 最終投稿日 >= ARCHIVE_DAYS` ならアーカイブ候補
5. `今日 - 最終投稿日 >= ARCHIVE_DAYS - WARN_DAYS_BEFORE` なら警告対象
6. 警告投稿後、`WARN_DAYS_BEFORE` 日以内にリアクション or メッセージがあればアーカイブ取りやめ

### 状態管理
- 警告済みチャンネルの記録は `warned_channels` マップ（メモリ）＋起動時にファイル永続化
- Railway / Render の再起動対策として `data/state.json` に書き出す

## 設定（config/settings.json）

```json
{
  "archiveDays": 180,
  "warnDaysBefore": 2,
  "excludeChannels": ["general", "random", "announce"],
  "timezone": "Asia/Tokyo",
  "dryRun": false
}
```

| キー | 型 | 説明 |
|---|---|---|
| `archiveDays` | number | 最終投稿からアーカイブするまでの日数 |
| `warnDaysBefore` | number | アーカイブ何日前に警告するか |
| `excludeChannels` | string[] | アーカイブ除外チャンネル名（# なし） |
| `timezone` | string | cron 実行タイムゾーン |
| `dryRun` | boolean | true にするとアーカイブを実行せずログのみ |

## コーディング規約

- TypeScript strict モード必須。`any` は禁止
- 非同期処理はすべて `async/await`（Promise チェーン禁止）
- エラーは握りつぶさず必ず `console.error` + Slack へのエラー通知
- Slack API 呼び出しは `src/slack/client.ts` に集約（直接 `client.xxx` を書かない）
- 関数は単一責任。1関数 = 1処理（目安 30 行以内）
- マジックナンバー禁止。すべて `config` か定数から参照
- コメントは「なぜ」を書く（「何をしているか」はコードで分かる）

## 禁止事項

- NEVER: `settings.json` の `excludeChannels` に含まれるチャンネルをアーカイブする
- NEVER: `dryRun: true` の状態で実際の Slack API 書き込み系（archive/postMessage）を呼ぶ
- NEVER: Bot Token を `console.log` に出力する
- NEVER: `conversations.archive` を警告投稿なしに呼び出す
- ALWAYS: Slack API のレートリミット対策として呼び出し間に 1 秒以上の待機を入れる
- ALWAYS: 新しいパッケージ追加前に確認を求める

## よく使うコマンド

```bash
npm run dev        # ts-node-dev でローカル起動
npm run build      # tsc でビルド
npm test           # vitest でテスト実行
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run dry-run    # DRY_RUN=true で動作確認
```

## 参考ドキュメント

- Slack API: https://api.slack.com/methods
- Bolt JS: https://slack.dev/bolt-js/
- 詳細設計: `.claude/rules/slack-api.md`
- テスト方針: `.claude/rules/testing.md`
- デプロイ手順: `.claude/rules/deploy.md`
