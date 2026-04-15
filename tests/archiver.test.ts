import { describe, it, expect, vi, beforeEach } from 'vitest';

// Slack API クライアントをモック
vi.mock('../src/slack/client', () => ({
  fetchAllPublicChannels: vi.fn(),
  fetchLatestMessage: vi.fn(),
  archiveChannel: vi.fn(),
  hasActivitySinceWarning: vi.fn(),
  postWarningMessage: vi.fn().mockResolvedValue('mock-warn-ts'),
  notifyError: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('../src/state', () => ({
  getWarnedChannel: vi.fn().mockReturnValue(undefined),
  setWarnedChannel: vi.fn(),
  removeWarnedChannel: vi.fn(),
}));

vi.mock('../src/notifier', () => ({
  postWarning: vi.fn().mockResolvedValue('mock-warn-ts'),
}));

import {
  fetchAllPublicChannels,
  fetchLatestMessage,
  archiveChannel,
  hasActivitySinceWarning,
} from '../src/slack/client';
import { getWarnedChannel, setWarnedChannel, removeWarnedChannel } from '../src/state';
import { runArchiver } from '../src/archiver';
import type { AppConfig } from '../src/types';

const baseConfig: AppConfig = {
  archiveDays: 180,
  warnDaysBefore: 2,
  excludeChannels: ['general', 'random'],
  timezone: 'Asia/Tokyo',
  dryRun: false,
  cronSchedule: '0 9 * * *',
};

/** N 日前の Slack timestamp 文字列を返す */
function daysAgoTs(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return String(ms / 1000);
}

const mockChannel = (name: string, id = `C_${name}`) => ({
  id,
  name,
  is_archived: false,
  created: Math.floor(Date.now() / 1000) - 365 * 24 * 3600,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWarnedChannel).mockReturnValue(undefined);
  vi.mocked(hasActivitySinceWarning).mockResolvedValue(false);
});

describe('runArchiver — 除外チャンネル', () => {
  it('excludeChannels に含まれるチャンネルはスキップされる', async () => {
    vi.mocked(fetchAllPublicChannels).mockResolvedValue([mockChannel('general')]);

    const result = await runArchiver(baseConfig);

    expect(fetchLatestMessage).not.toHaveBeenCalled();
    expect(archiveChannel).not.toHaveBeenCalled();
    expect(result.archived).toHaveLength(0);
  });
});

describe('runArchiver — 警告タイミング', () => {
  it('経過日数が archiveDays - warnDaysBefore に達したら警告を投稿する', async () => {
    vi.mocked(fetchAllPublicChannels).mockResolvedValue([mockChannel('old-channel')]);
    vi.mocked(fetchLatestMessage).mockResolvedValue({ ts: daysAgoTs(178) }); // 178日前 = 180-2

    const result = await runArchiver(baseConfig);

    expect(setWarnedChannel).toHaveBeenCalledWith(
      expect.objectContaining({ channelName: 'old-channel' }),
    );
    expect(result.warned).toContain('old-channel');
    expect(result.archived).toHaveLength(0);
  });

  it('経過日数が warnThreshold 未満なら何もしない', async () => {
    vi.mocked(fetchAllPublicChannels).mockResolvedValue([mockChannel('fresh-channel')]);
    vi.mocked(fetchLatestMessage).mockResolvedValue({ ts: daysAgoTs(177) }); // 177日前

    const result = await runArchiver(baseConfig);

    expect(setWarnedChannel).not.toHaveBeenCalled();
    expect(result.warned).toHaveLength(0);
    expect(result.archived).toHaveLength(0);
  });
});

describe('runArchiver — アーカイブ実行', () => {
  it('警告済み & 猶予期間経過 & アクションなし → アーカイブする', async () => {
    vi.mocked(fetchAllPublicChannels).mockResolvedValue([mockChannel('dead-channel')]);
    vi.mocked(fetchLatestMessage).mockResolvedValue({ ts: daysAgoTs(185) });
    vi.mocked(getWarnedChannel).mockReturnValue({
      channelId: 'C_dead-channel',
      channelName: 'dead-channel',
      warnedAt: Math.floor(Date.now() / 1000) - 3 * 24 * 3600, // 3日前に警告
      warnMessageTs: 'warn-ts-001',
    });
    vi.mocked(hasActivitySinceWarning).mockResolvedValue(false);

    const result = await runArchiver(baseConfig);

    expect(archiveChannel).toHaveBeenCalledWith('C_dead-channel', 'dead-channel', false);
    expect(removeWarnedChannel).toHaveBeenCalledWith('C_dead-channel');
    expect(result.archived).toContain('dead-channel');
  });

  it('警告済み & リアクションあり → アーカイブを取りやめる', async () => {
    vi.mocked(fetchAllPublicChannels).mockResolvedValue([mockChannel('active-channel')]);
    vi.mocked(fetchLatestMessage).mockResolvedValue({ ts: daysAgoTs(185) });
    vi.mocked(getWarnedChannel).mockReturnValue({
      channelId: 'C_active-channel',
      channelName: 'active-channel',
      warnedAt: Math.floor(Date.now() / 1000) - 3 * 24 * 3600,
      warnMessageTs: 'warn-ts-002',
    });
    vi.mocked(hasActivitySinceWarning).mockResolvedValue(true); // リアクションあり

    const result = await runArchiver(baseConfig);

    expect(archiveChannel).not.toHaveBeenCalled();
    expect(removeWarnedChannel).toHaveBeenCalledWith('C_active-channel');
    expect(result.skipped).toContain('active-channel');
  });
});

describe('runArchiver — dryRun モード', () => {
  it('dryRun: true のとき archiveChannel が dryRun=true で呼ばれる', async () => {
    const dryConfig = { ...baseConfig, dryRun: true };

    vi.mocked(fetchAllPublicChannels).mockResolvedValue([mockChannel('dry-channel')]);
    vi.mocked(fetchLatestMessage).mockResolvedValue({ ts: daysAgoTs(185) });
    vi.mocked(getWarnedChannel).mockReturnValue({
      channelId: 'C_dry-channel',
      channelName: 'dry-channel',
      warnedAt: Math.floor(Date.now() / 1000) - 3 * 24 * 3600,
      warnMessageTs: 'warn-ts-003',
    });
    vi.mocked(hasActivitySinceWarning).mockResolvedValue(false);

    await runArchiver(dryConfig);

    expect(archiveChannel).toHaveBeenCalledWith('C_dry-channel', 'dry-channel', true);
  });
});
