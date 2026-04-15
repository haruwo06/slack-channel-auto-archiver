---
description: Slack API の呼び出しルールとレートリミット対策
---

# Slack API ルール

## 必要な Bot Token スコープ

このアプリが動作するために以下のスコープが必要。
Slack App の設定画面（OAuth & Permissions）で確認・追加すること。

| スコープ | 用途 |
|---|---|
| `channels:read` | パブリックチャンネル一覧取得 |
| `channels:history` | チャンネルの投稿履歴取得 |
| `channels:manage` | チャンネルのアーカイブ |
| `chat:write` | 警告メッセージの投稿 |
| `reactions:read` | メッセージへのリアクション確認 |

## レートリミット対応（MUST）

Slack API には Tier ごとのレートリミットがある。
複数チャンネルをループ処理する際は必ず以下を守ること。

```typescript
// ALWAYS: API 呼び出し間に必ずインターバルを入れる
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

for (const channel of channels) {
  await client.conversations.history({ channel: channel.id });
  await sleep(1200); // 1.2秒待機（Tier2: 20req/min の安全マージン）
}
```

| API メソッド | Tier | 推奨インターバル |
|---|---|---|
| `conversations.list` | Tier2 | 1.2秒 |
| `conversations.history` | Tier3 | 0.5秒 |
| `conversations.archive` | Tier2 | 1.2秒 |
| `chat.postMessage` | Tier3 | 0.5秒 |

## ページネーション対応（MUST）

チャンネル数が多い場合、`conversations.list` は複数ページに分かれる。
`next_cursor` が返ってくる間はループし続けること。

```typescript
// ALWAYS: cursor ベースのページネーションを実装する
let cursor: string | undefined;
const allChannels: Channel[] = [];

do {
  const res = await client.conversations.list({
    limit: 200,
    cursor,
    exclude_archived: true,
    types: 'public_channel',
  });
  allChannels.push(...(res.channels ?? []));
  cursor = res.response_metadata?.next_cursor;
  if (cursor) await sleep(1200);
} while (cursor);
```

## エラーハンドリング

```typescript
// Slack API エラーは必ず catch して通知する
try {
  await client.conversations.archive({ channel: channelId });
} catch (err) {
  if (err instanceof Error && 'data' in err) {
    const slackErr = err as WebAPICallError;
    // already_archived は無視してよい
    if (slackErr.data?.error === 'already_archived') return;
  }
  // それ以外はエラー通知チャンネルへ
  await notifyError(err, `archive failed: ${channelId}`);
  throw err;
}
```

## dryRun モードの徹底

```typescript
// NEVER: dryRun が true のときに書き込み系 API を呼ぶ
if (config.dryRun) {
  console.log(`[DRY RUN] Would archive: #${channel.name}`);
  return;
}
await client.conversations.archive({ channel: channel.id });
```
