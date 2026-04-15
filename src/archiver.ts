import type { AppConfig, ArchiveResult, ChannelInfo } from './types';
import {
  fetchAllPublicChannels,
  fetchLatestMessage,
  archiveChannel,
  hasActivitySinceWarning,
  notifyError,
} from './slack/client';
import { postWarning } from './notifier';
import {
  getWarnedChannel,
  setWarnedChannel,
  removeWarnedChannel,
} from './state';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * ts 文字列（Slack の Unix タイムスタンプ）を Date に変換
 */
function tsToDate(ts: string): Date {
  return new Date(parseFloat(ts) * 1000);
}

/**
 * 経過日数を計算する
 */
function daysSince(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / DAY_IN_MS);
}

/**
 * パブリックチャンネルの情報を取得し、最終投稿日時を付与して返す
 */
async function buildChannelInfoList(config: AppConfig): Promise<ChannelInfo[]> {
  const channels = await fetchAllPublicChannels();
  const result: ChannelInfo[] = [];

  for (const ch of channels) {
    if (!ch.id || !ch.name) continue;

    // 除外チャンネルはスキップ
    if (config.excludeChannels.includes(ch.name)) {
      console.log(`[archiver] スキップ（除外設定）: #${ch.name}`);
      continue;
    }

    try {
      const latestMsg = await fetchLatestMessage(ch.id);
      const lastActivityTs = latestMsg?.ts
        ? parseFloat(latestMsg.ts)
        : (ch.created ?? 0); // 投稿なしの場合はチャンネル作成日時

      result.push({
        id: ch.id,
        name: ch.name,
        lastActivityTs,
        isArchived: ch.is_archived ?? false,
      });
    } catch (err) {
      console.error(`[archiver] チャンネル情報取得エラー: #${ch.name}`, err);
      await notifyError(err, `fetchLatestMessage failed: #${ch.name}`);
    }
  }

  return result;
}

/**
 * メインのアーカイブ処理
 * 1. 警告対象チャンネルに警告メッセージを投稿
 * 2. 猶予期間が終了した警告済みチャンネルをアーカイブ
 */
export async function runArchiver(config: AppConfig): Promise<ArchiveResult> {
  const result: ArchiveResult = {
    archived: [],
    warned: [],
    skipped: [],
    errors: [],
  };

  const now = new Date();
  const channels = await buildChannelInfoList(config);

  for (const channel of channels) {
    const lastActivity = new Date(channel.lastActivityTs * 1000);
    const elapsed = daysSince(lastActivity, now);
    const warned = getWarnedChannel(channel.id);

    try {
      // ── ケース1: 警告済み → アーカイブ or 取りやめ確認 ──
      if (warned) {
        const hasActivity = await hasActivitySinceWarning(channel.id, warned.warnMessageTs);

        if (hasActivity) {
          console.log(`[archiver] アーカイブ取りやめ（アクションあり）: #${channel.name}`);
          removeWarnedChannel(channel.id);
          result.skipped.push(channel.name);
          continue;
        }

        const warnedAt = new Date(warned.warnedAt * 1000);
        const daysSinceWarn = daysSince(warnedAt, now);

        if (daysSinceWarn >= config.warnDaysBefore) {
          console.log(`[archiver] アーカイブ実行: #${channel.name} (最終投稿: ${elapsed}日前)`);
          await archiveChannel(channel.id, channel.name, config.dryRun);
          removeWarnedChannel(channel.id);
          result.archived.push(channel.name);
        } else {
          console.log(`[archiver] 警告済み・猶予中: #${channel.name} (警告から${daysSinceWarn}日)`);
        }
        continue;
      }

      // ── ケース2: 未警告 → 警告タイミングに達したら警告投稿 ──
      const warnThreshold = config.archiveDays - config.warnDaysBefore;
      if (elapsed >= warnThreshold) {
        console.log(`[archiver] 警告投稿: #${channel.name} (最終投稿: ${elapsed}日前)`);
        const warnTs = await postWarning(channel.id, channel.name, config.archiveDays, config.dryRun);

        setWarnedChannel({
          channelId: channel.id,
          channelName: channel.name,
          warnedAt: Math.floor(now.getTime() / 1000),
          warnMessageTs: warnTs ?? '0',
        });

        result.warned.push(channel.name);
      }
    } catch (err) {
      console.error(`[archiver] エラー: #${channel.name}`, err);
      await notifyError(err, `archiver failed: #${channel.name}`);
      result.errors.push(channel.name);
    }
  }

  return result;
}
