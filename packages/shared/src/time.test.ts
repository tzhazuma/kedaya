import { describe, expect, it } from 'vitest';
import {
  dateKeyAtOffset,
  dayRange,
  dayRangeWithOffset,
  formatDeadline,
  formatRelativeTime,
  isSameDay,
  parseDateKeyAtOffset,
  toDateKey,
  toIso,
} from './time';

/** 东八区偏移（分钟） */
const CST = 480;

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

/* ------------------------------------------------------------------ *
 * 按指定时区偏移切天（服务端不再依赖进程 TZ）
 * ------------------------------------------------------------------ */

describe('dayRangeWithOffset', () => {
  it('东八区：UTC 23:30 属于次日（北京 07:30）', () => {
    const range = dayRangeWithOffset(new Date('2026-10-16T23:30:00.000Z'), CST);
    expect(range.key).toBe('2026-10-17');
    expect(range.from.toISOString()).toBe('2026-10-16T16:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-17T16:00:00.000Z');
  });

  it('东八区：同一 UTC 日切出两个 key', () => {
    expect(dateKeyAtOffset(new Date('2026-10-16T15:59:00.000Z'), CST)).toBe('2026-10-16');
    expect(dateKeyAtOffset(new Date('2026-10-16T16:00:00.000Z'), CST)).toBe('2026-10-17');
  });

  it('UTC 偏移 0 时与 UTC 日期一致', () => {
    expect(dayRangeWithOffset(NOW, 0).key).toBe('2026-10-16');
  });

  it('本地 dayRange 与「本机偏移」一致（默认口径不变）', () => {
    const local = dayRange(NOW);
    const explicit = dayRangeWithOffset(NOW, -NOW.getTimezoneOffset());
    expect(local.key).toBe(explicit.key);
    expect(local.from.getTime()).toBe(explicit.from.getTime());
  });
});

describe('parseDateKeyAtOffset', () => {
  it('解析成目标时区零点', () => {
    const date = parseDateKeyAtOffset('2026-10-17', CST);
    expect(date?.toISOString()).toBe('2026-10-16T16:00:00.000Z');
  });

  it('拒绝不存在的日期（2026-02-31 不再静默进位）', () => {
    expect(parseDateKeyAtOffset('2026-02-31', CST)).toBeNull();
    expect(parseDateKeyAtOffset('2026-13-01', CST)).toBeNull();
  });

  it('拒绝格式错误', () => {
    expect(parseDateKeyAtOffset('2026/10/17', CST)).toBeNull();
    expect(parseDateKeyAtOffset('20261017', CST)).toBeNull();
  });
});
