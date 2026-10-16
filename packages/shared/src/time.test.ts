import { describe, expect, it } from 'vitest';
import { formatDeadline, formatRelativeTime, isSameDay, toDateKey, toIso } from './time';

const NOW = new Date('2026-10-16T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it('一分钟内为"刚刚"', () => {
    expect(formatRelativeTime('2026-10-16T11:59:30.000Z', NOW)).toBe('刚刚');
  });

  it('过去时间用"前"', () => {
    expect(formatRelativeTime('2026-10-16T11:57:00.000Z', NOW)).toBe('3 分钟前');
    expect(formatRelativeTime('2026-10-16T09:00:00.000Z', NOW)).toBe('3 小时前');
    expect(formatRelativeTime('2026-10-14T12:00:00.000Z', NOW)).toBe('2 天前');
  });

  it('未来时间用"后"', () => {
    expect(formatRelativeTime('2026-10-16T12:05:00.000Z', NOW)).toBe('5 分钟后');
    expect(formatRelativeTime('2026-10-18T12:00:00.000Z', NOW)).toBe('2 天后');
  });

  it('非法输入返回空串', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
  });
});

describe('formatDeadline', () => {
  it('已过期', () => {
    expect(formatDeadline('2026-10-16T11:00:00.000Z', NOW)).toBe('已截止');
  });

  it('未过期显示剩余', () => {
    expect(formatDeadline('2026-10-16T15:00:00.000Z', NOW)).toBe('还有 3 小时');
  });
});

describe('isSameDay / toDateKey / toIso', () => {
  it('同一天判定', () => {
    expect(isSameDay(new Date('2026-10-16T01:00:00'), new Date('2026-10-16T23:00:00'))).toBe(true);
    expect(isSameDay(new Date('2026-10-16T23:00:00'), new Date('2026-10-17T01:00:00'))).toBe(false);
  });

  it('toDateKey 补零', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('toIso 产出 UTC', () => {
    expect(toIso(new Date('2026-10-16T12:00:00.000Z'))).toBe('2026-10-16T12:00:00.000Z');
  });
});
