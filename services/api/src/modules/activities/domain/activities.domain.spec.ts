import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_EVIDENCE_MAX,
  ACTIVITY_REMINDER_NOW_SHIFT_MS,
  buildDefaultReminderDrafts,
  clampEvidence,
  toActivityItem,
  type ActivityRecord,
} from './activities.domain';

const NOW = new Date('2026-11-22T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;

describe('buildDefaultReminderDrafts', () => {
  it('报名截止前 24h、开始前 1h，全部只走站内信', () => {
    const drafts = buildDefaultReminderDrafts(
      {
        startsAt: new Date('2026-11-25T10:00:00.000Z'),
        registrationDeadlineAt: new Date('2026-11-24T10:00:00.000Z'),
      },
      NOW,
    );

    expect(drafts).toEqual([
      {
        kind: 'registration',
        remindAt: new Date('2026-11-23T10:00:00.000Z'),
        channel: 'inapp',
        dedupeKey: 'default:registration',
      },
      {
        kind: 'start',
        remindAt: new Date('2026-11-25T09:00:00.000Z'),
        channel: 'inapp',
        dedupeKey: 'default:start',
      },
    ]);
  });

  it('目标时刻已过（含恰好等于 now）不建提醒', () => {
    expect(
      buildDefaultReminderDrafts(
        {
          startsAt: NOW,
          registrationDeadlineAt: new Date('2026-11-21T00:00:00.000Z'),
        },
        NOW,
      ),
    ).toEqual([]);
  });

  it('目标在未来、但提醒时刻已过 → 改到 now+5min，不丢提醒', () => {
    const drafts = buildDefaultReminderDrafts(
      {
        startsAt: new Date(NOW.getTime() + 30 * 60 * 1000),
        registrationDeadlineAt: new Date(NOW.getTime() + 2 * HOUR),
      },
      NOW,
    );

    expect(drafts.map((draft) => draft.remindAt)).toEqual([
      new Date(NOW.getTime() + ACTIVITY_REMINDER_NOW_SHIFT_MS),
      new Date(NOW.getTime() + ACTIVITY_REMINDER_NOW_SHIFT_MS),
    ]);
  });

  it('兜底时刻不得晚于目标：目标只剩 3 分钟时提醒放在目标时刻', () => {
    const target = new Date(NOW.getTime() + 3 * 60 * 1000);
    const drafts = buildDefaultReminderDrafts(
      { startsAt: target, registrationDeadlineAt: null },
      NOW,
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.remindAt.getTime()).toBe(target.getTime());
  });

  it('缺少开始时刻或报名截止时刻时跳过对应提醒', () => {
    expect(buildDefaultReminderDrafts({ startsAt: null, registrationDeadlineAt: null }, NOW)).toEqual(
      [],
    );

    const onlyStart = buildDefaultReminderDrafts(
      { startsAt: new Date('2026-11-25T10:00:00.000Z'), registrationDeadlineAt: null },
      NOW,
    );
    expect(onlyStart.map((draft) => draft.kind)).toEqual(['start']);
  });
});

describe('clampEvidence', () => {
  it('按码点截断到 200 字，不把 emoji 截成半个', () => {
    const raw = '🦆'.repeat(ACTIVITY_EVIDENCE_MAX + 20);
    const clamped = clampEvidence(raw);

    expect([...clamped]).toHaveLength(ACTIVITY_EVIDENCE_MAX);
    expect(clamped.endsWith('…')).toBe(true);
    expect(clamped).not.toContain('\uFFFD');
  });

  it('压缩空白并去掉控制字符（证据不是正文副本）', () => {
    expect(clampEvidence('  时间：10月20日\n\n\t14:00  ')).toBe('时间：10月20日 14:00');
  });
});

describe('toActivityItem', () => {
  it('时间字段输出 UTC ISO；raw 与未定时刻原样保留', () => {
    const record: ActivityRecord = {
      id: 'act-1',
      userId: 'user-1',
      source: 'campus-mail',
      sourceRef: 'mail-1',
      kind: 'lecture',
      title: 'AI for Science',
      startsAt: new Date('2026-11-25T06:00:00.000Z'),
      endsAt: null,
      location: null,
      organizer: null,
      registrationDeadlineAt: null,
      registrationDeadlineRaw: '11月24日',
      registrationUrl: null,
      evidenceText: '2026年11月25日 14:00',
      confidence: 0.8,
      status: 'candidate',
      sourceUrl: null,
      sourceLabel: '校园邮箱',
      publishedAt: null,
      stale: false,
      mailAccountId: 'acc-1',
      mailEventId: 'mail-1',
      createdAt: NOW,
      updatedAt: NOW,
    };

    expect(toActivityItem(record)).toMatchObject({
      id: 'act-1',
      source: 'campus-mail',
      startsAt: '2026-11-25T06:00:00.000Z',
      endsAt: null,
      registrationDeadlineAt: null,
      registrationDeadlineRaw: '11月24日',
      status: 'candidate',
    });
    // 内部字段（userId / sourceRef / mailAccountId）不进入对外视图
    expect(toActivityItem(record)).not.toHaveProperty('userId');
    expect(toActivityItem(record)).not.toHaveProperty('sourceRef');
    expect(toActivityItem(record)).not.toHaveProperty('mailAccountId');
  });
});
