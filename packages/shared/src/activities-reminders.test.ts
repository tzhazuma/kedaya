import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_REGISTRATION_LEAD_MS,
  ACTIVITY_REMINDER_FALLBACK_MS,
  ACTIVITY_START_LEAD_MS,
  computeActivityReminders,
} from './activities-reminders';

/**
 * 默认提醒：报名截止前 24h、开始前 1h。
 *
 * 三条容易做错的规则：
 *   1. 目标已过 → 不建（不能给昨天截止的活动排明天的提醒）；
 *   2. 目标还没到、但「目标 - 提前量」已经过了 → now + 5min（别静默丢掉）；
 *   3. 兜底时刻也不能晚于目标（3 分钟后截止的活动，提醒不能排在 5 分钟后）。
 */

const NOW = new Date('2026-10-20T00:00:00.000Z');

describe('computeActivityReminders —— 默认提前量', () => {
  it('导出与契约一致的 24h / 1h / 5min', () => {
    expect(ACTIVITY_REGISTRATION_LEAD_MS).toBe(24 * 60 * 60 * 1000);
    expect(ACTIVITY_START_LEAD_MS).toBe(60 * 60 * 1000);
    expect(ACTIVITY_REMINDER_FALLBACK_MS).toBe(5 * 60 * 1000);
  });

  it('报名截止前 24h、开始前 1h，按时间升序返回', () => {
    const reminders = computeActivityReminders(
      {
        registrationDeadlineAt: '2026-10-23T04:00:00.000Z',
        startsAt: '2026-10-25T06:00:00.000Z',
      },
      { now: NOW },
    );
    expect(reminders).toEqual([
      {
        kind: 'registration',
        remindAt: '2026-10-22T04:00:00.000Z',
        channel: 'inapp',
      },
      {
        kind: 'start',
        remindAt: '2026-10-25T05:00:00.000Z',
        channel: 'inapp',
      },
    ]);
  });

  it('只有开始时间时只建开始提醒', () => {
    const reminders = computeActivityReminders(
      { registrationDeadlineAt: null, startsAt: '2026-10-25T06:00:00.000Z' },
      { now: NOW },
    );
    expect(reminders.map((r) => r.kind)).toEqual(['start']);
  });

  it('只有报名截止时只建报名提醒', () => {
    const reminders = computeActivityReminders(
      { registrationDeadlineAt: '2026-10-23T04:00:00.000Z', startsAt: null },
      { now: NOW },
    );
    expect(reminders.map((r) => r.kind)).toEqual(['registration']);
  });

  it('两个目标都没有 → 空数组', () => {
    expect(computeActivityReminders({ registrationDeadlineAt: null, startsAt: null }, { now: NOW })).toEqual(
      [],
    );
  });
});

describe('computeActivityReminders —— 过去与兜底', () => {
  it('目标已过 → 不建', () => {
    const reminders = computeActivityReminders(
      {
        registrationDeadlineAt: '2026-10-19T04:00:00.000Z',
        startsAt: '2026-10-18T06:00:00.000Z',
      },
      { now: NOW },
    );
    expect(reminders).toEqual([]);
  });

  it('目标恰好等于 now → 视为已过，不建', () => {
    expect(
      computeActivityReminders(
        { registrationDeadlineAt: NOW.toISOString(), startsAt: NOW.toISOString() },
        { now: NOW },
      ),
    ).toEqual([]);
  });

  it('提前量已过但目标还在未来 → now + 5min', () => {
    const deadline = new Date(NOW.getTime() + 10 * 60 * 1000).toISOString();
    const reminders = computeActivityReminders(
      { registrationDeadlineAt: deadline, startsAt: null },
      { now: NOW },
    );
    expect(reminders).toEqual([
      {
        kind: 'registration',
        remindAt: '2026-10-20T00:05:00.000Z',
        channel: 'inapp',
      },
    ]);
  });

  it('目标只剩 3 分钟 → 兜底提醒不晚于目标', () => {
    const deadline = new Date(NOW.getTime() + 3 * 60 * 1000).toISOString();
    const reminders = computeActivityReminders(
      { registrationDeadlineAt: deadline, startsAt: null },
      { now: NOW },
    );
    expect(reminders).toHaveLength(1);
    expect(Date.parse(reminders[0]?.remindAt ?? '')).toBeLessThanOrEqual(Date.parse(deadline));
    expect(reminders[0]?.remindAt).toBe(deadline);
  });

  it('提前量刚好落在 now 之前一秒 → 走兜底', () => {
    const deadline = new Date(NOW.getTime() + ACTIVITY_REGISTRATION_LEAD_MS - 1000).toISOString();
    const reminders = computeActivityReminders(
      { registrationDeadlineAt: deadline, startsAt: null },
      { now: NOW },
    );
    expect(reminders[0]?.remindAt).toBe('2026-10-20T00:05:00.000Z');
  });

  it('提前量刚好落在 now → 视为未来，直接使用', () => {
    const deadline = new Date(NOW.getTime() + ACTIVITY_REGISTRATION_LEAD_MS).toISOString();
    const reminders = computeActivityReminders(
      { registrationDeadlineAt: deadline, startsAt: null },
      { now: NOW },
    );
    expect(reminders[0]?.remindAt).toBe(NOW.toISOString());
  });

  it('只有日期的字符串不当作时刻（避免 UTC 零点漂移）', () => {
    const reminders = computeActivityReminders(
      { registrationDeadlineAt: '2026-10-23', startsAt: null },
      { now: NOW },
    );
    expect(reminders).toEqual([]);
  });

  it('非法时间字符串被忽略，不抛异常', () => {
    const reminders = computeActivityReminders(
      {
        registrationDeadlineAt: 'not-a-date',
        startsAt: '2026-10-25T06:00:00.000Z',
      },
      { now: NOW },
    );
    expect(reminders.map((r) => r.kind)).toEqual(['start']);
  });
});

describe('computeActivityReminders —— 可配置提前量', () => {
  it('调用方可以覆盖默认提前量', () => {
    const reminders = computeActivityReminders(
      { registrationDeadlineAt: '2026-10-23T04:00:00.000Z', startsAt: null },
      { now: NOW, registrationLeadMs: 2 * 60 * 60 * 1000 },
    );
    expect(reminders[0]?.remindAt).toBe('2026-10-23T02:00:00.000Z');
  });

  it('开始提醒的提前量也可覆盖', () => {
    const reminders = computeActivityReminders(
      { registrationDeadlineAt: null, startsAt: '2026-10-25T06:00:00.000Z' },
      { now: NOW, startLeadMs: 30 * 60 * 1000 },
    );
    expect(reminders[0]?.remindAt).toBe('2026-10-25T05:30:00.000Z');
  });
});
