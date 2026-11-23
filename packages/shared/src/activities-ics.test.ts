import { describe, expect, it } from 'vitest';

import { buildActivityIcs, type IcsActivityInput } from './activities-ics';

/**
 * 活动 ICS 导出。
 *
 * 与课程 DDL 的 ICS 一样，格式错了不会在本机报错，只会在用户日历里静默不显示。
 * 这里额外锁两条活动域的安全不变量：
 *   1. **只有 confirmed 的活动能导出** —— candidate 还没被用户确认；
 *   2. 没有开始时刻但有报名截止的活动，导出成「报名截止」事件，而不是编一个开始时间。
 */

const NOW = new Date('2026-10-20T04:00:00.000Z');

function activity(over: Partial<IcsActivityInput> = {}): IcsActivityInput {
  return {
    id: 'act-1',
    title: '大模型与推理',
    status: 'confirmed',
    startsAt: '2026-10-25T06:00:00.000Z',
    endsAt: '2026-10-25T08:00:00.000Z',
    location: '信息学院 1-101 报告厅',
    organizer: '信息科学与技术学院',
    registrationDeadlineAt: '2026-10-23T04:00:00.000Z',
    registrationUrl: 'https://events.shanghaitech.edu.cn/signup?id=42',
    sourceUrl: 'https://mp.weixin.qq.com/s/abc',
    sourceLabel: '上科大信息学院',
    evidenceText: '时间：2026年10月25日 14:00-16:00 地点：信息学院 1-101 报告厅',
    ...over,
  };
}

describe('buildActivityIcs —— 基本结构', () => {
  it('是合法的 VCALENDAR 外壳，时区明确', () => {
    const ics = buildActivityIcs([activity()], { calendarName: '可达鸭活动', now: NOW });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('X-WR-CALNAME:可达鸭活动');
    expect(ics).toContain('X-WR-TIMEZONE:Asia/Shanghai');
    // 绝不允许 floating time（没有 Z、也没有 TZID 的本地墙钟）
    expect(ics).not.toMatch(/DTSTART:\d{8}T\d{6}\r\n/);
  });

  it('⚠️ 行分隔符必须是 CRLF', () => {
    const ics = buildActivityIcs([activity()], { calendarName: 'x', now: NOW });
    expect(/(?<!\r)\n/.test(ics)).toBe(false);
  });

  it('一条活动生成一个 VEVENT，字段齐全', () => {
    const ics = buildActivityIcs([activity()], { calendarName: 'x', now: NOW });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('UID:act-1@kedaya-activities');
    expect(ics).toContain('DTSTAMP:20261020T040000Z');
    expect(ics).toContain('DTSTART:20261025T060000Z');
    expect(ics).toContain('DTEND:20261025T080000Z');
    expect(ics).toContain('SUMMARY:大模型与推理');
    expect(ics).toContain('LOCATION:信息学院 1-101 报告厅');
    expect(ics).toContain('URL:https://events.shanghaitech.edu.cn/signup?id=42');
    expect(ics).toContain('DESCRIPTION:主办：信息科学与技术学院');
    expect(ics).toContain('来源：上科大信息学院');
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT1H');
  });

  it('没有条目时仍返回合法空日历', () => {
    const ics = buildActivityIcs([], { calendarName: 'x', now: NOW });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});

describe('buildActivityIcs —— 确认门（安全不变量）', () => {
  it('⚠️ candidate 不导出（用户确认前不能进日程）', () => {
    const ics = buildActivityIcs([activity({ status: 'candidate' })], {
      calendarName: 'x',
      now: NOW,
    });
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('dismissed / archived 也不导出', () => {
    for (const status of ['dismissed', 'archived'] as const) {
      const ics = buildActivityIcs([activity({ status })], { calendarName: 'x', now: NOW });
      expect(ics, `${status} 不该进日历`).not.toContain('BEGIN:VEVENT');
    }
  });
});

describe('buildActivityIcs —— 只有报名截止的活动', () => {
  it('没有开始时刻时导出「报名截止」事件，并用 24 小时提醒', () => {
    const ics = buildActivityIcs(
      [activity({ startsAt: null, endsAt: null, registrationDeadlineAt: '2026-10-23T04:00:00.000Z' })],
      { calendarName: 'x', now: NOW },
    );
    expect(ics).toContain('DTSTART:20261023T040000Z');
    // 零时长事件不写 DTEND：RFC 5545 要求 DTEND 晚于 DTSTART
    expect(ics).not.toContain('DTEND:');
    expect(ics).toContain('SUMMARY:报名截止：大模型与推理');
    expect(ics).toContain('TRIGGER:-PT24H');
  });

  it('既没有开始时刻也没有可解析的截止时刻 → 跳过，不编时间', () => {
    const ics = buildActivityIcs(
      [activity({ startsAt: null, endsAt: null, registrationDeadlineAt: null })],
      { calendarName: 'x', now: NOW },
    );
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('截止时刻不可解析 → 跳过', () => {
    const ics = buildActivityIcs(
      [activity({ startsAt: null, endsAt: null, registrationDeadlineAt: 'not-a-date' })],
      { calendarName: 'x', now: NOW },
    );
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});

describe('buildActivityIcs —— 时间边界', () => {
  it('没有结束时刻时省略 DTEND（零时长，不猜时长）', () => {
    const ics = buildActivityIcs([activity({ endsAt: null })], { calendarName: 'x', now: NOW });
    expect(ics).toContain('DTSTART:20261025T060000Z');
    expect(ics).not.toContain('DTEND:');
  });

  it('结束早于开始 → 省略 DTEND，而不是写一个非法的零时长', () => {
    const ics = buildActivityIcs([activity({ endsAt: '2026-10-25T05:00:00.000Z' })], {
      calendarName: 'x',
      now: NOW,
    });
    expect(ics).toContain('DTSTART:20261025T060000Z');
    expect(ics).not.toContain('DTEND:');
  });

  it('⚠️ 只有日期的 startsAt 不导出（不能按 UTC 零点漂移）', () => {
    const ics = buildActivityIcs(
      [activity({ startsAt: '2026-10-25', endsAt: null, registrationDeadlineAt: null })],
      { calendarName: 'x', now: NOW },
    );
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('开始时刻不可解析但有截止时刻 → 导出截止事件', () => {
    const ics = buildActivityIcs([activity({ startsAt: 'not-a-date' })], {
      calendarName: 'x',
      now: NOW,
    });
    expect(ics).toContain('SUMMARY:报名截止：大模型与推理');
    expect(ics).toContain('DTSTART:20261023T040000Z');
  });
});

describe('buildActivityIcs —— 转义 / 折行 / 链接安全', () => {
  it('标题里的逗号 / 分号 / 反斜杠被转义', () => {
    const ics = buildActivityIcs([activity({ title: '讲座, 第一节; 附录\\A' })], {
      calendarName: 'x',
      now: NOW,
    });
    expect(ics).toContain('SUMMARY:讲座\\, 第一节\\; 附录\\\\A');
  });

  it('描述里的换行转成字面量 \\n', () => {
    const ics = buildActivityIcs([activity()], { calendarName: 'x', now: NOW });
    expect(ics).toContain('DESCRIPTION:主办：信息科学与技术学院\\n');
  });

  it('每行不超过 75 字节，超长中文标题按字节折行且不破坏内容', () => {
    const longTitle = '这是一个非常长的活动标题用来验证折行逻辑是否按字节而不是按字符来计算因为中文一个字占三个字节';
    const ics = buildActivityIcs([activity({ title: longTitle })], { calendarName: 'x', now: NOW });
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(longTitle);
  });

  it('报名链接去掉会话参数；没有报名链接时回落到来源链接', () => {
    const sanitized = buildActivityIcs(
      [activity({ registrationUrl: 'https://example.com/signup?sid=secret&id=7' })],
      { calendarName: 'x', now: NOW },
    );
    expect(sanitized).toContain('URL:https://example.com/signup?id=7');
    expect(sanitized).not.toContain('sid=secret');

    const fallback = buildActivityIcs([activity({ registrationUrl: null })], {
      calendarName: 'x',
      now: NOW,
    });
    expect(fallback).toContain('URL:https://mp.weixin.qq.com/s/abc');
  });

  it('证据片段过长时在 DESCRIPTION 里截断到 200 字', () => {
    const ics = buildActivityIcs([activity({ evidenceText: '证'.repeat(400) })], {
      calendarName: 'x',
      now: NOW,
    });
    const description = ics
      .split('\r\n')
      .filter((line) => line.startsWith('DESCRIPTION:'))
      .join('')
      .replace(/^DESCRIPTION:/, '')
      .replace(/\r\n /g, '');
    expect(description.length).toBeLessThan(600);
    expect(ics).toContain('…');
  });

  it('URL 是 URI 值，不按 TEXT 转义逗号与分号', () => {
    const ics = buildActivityIcs(
      [activity({ registrationUrl: 'https://example.com/a,b;c?id=7' })],
      { calendarName: 'x', now: NOW },
    );
    expect(ics).toContain('URL:https://example.com/a,b;c?id=7');
    expect(ics).not.toContain('URL:https://example.com/a\\,b\\;c?id=7');
  });

  it('描述里的报名截止按 Asia/Shanghai 展示，而不是 UTC ISO', () => {
    const ics = buildActivityIcs([activity()], { calendarName: 'x', now: NOW });
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('报名截止：2026-10-23 12:00');
    expect(unfolded).not.toContain('报名截止：2026-10-23T04:00:00.000Z');
  });

  it('重复 id 只导出一次', () => {
    const ics = buildActivityIcs([activity(), activity({ title: '重复标题' })], {
      calendarName: 'x',
      now: NOW,
    });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('SUMMARY:大模型与推理');
    expect(ics).not.toContain('SUMMARY:重复标题');
  });
});

describe('buildActivityIcs —— 默认提醒 clamp 语义', () => {
  it('开始前 10 分钟导入 → 提醒 clamp 到 5 分钟后（-PT5M）', () => {
    const startsAt = new Date(NOW.getTime() + 10 * 60 * 1000).toISOString();
    const ics = buildActivityIcs(
      [activity({ startsAt, endsAt: null, registrationDeadlineAt: null })],
      { calendarName: 'x', now: NOW },
    );
    expect(ics).toContain('TRIGGER:-PT5M');
  });

  it('开始前 3 分钟 → 提醒落在开始时刻（PT0S）', () => {
    const startsAt = new Date(NOW.getTime() + 3 * 60 * 1000).toISOString();
    const ics = buildActivityIcs(
      [activity({ startsAt, endsAt: null, registrationDeadlineAt: null })],
      { calendarName: 'x', now: NOW },
    );
    expect(ics).toContain('TRIGGER:PT0S');
  });

  it('活动已开始 → 不写 VALARM（目标已过不建提醒）', () => {
    const ics = buildActivityIcs(
      [
        activity({
          startsAt: '2026-10-19T06:00:00.000Z',
          endsAt: null,
          registrationDeadlineAt: null,
        }),
      ],
      { calendarName: 'x', now: NOW },
    );
    expect(ics).toContain('DTSTART:20261019T060000Z');
    expect(ics).not.toContain('BEGIN:VALARM');
  });

  it('报名截止前 10 分钟 → 报名提醒同样 clamp 到 5 分钟后', () => {
    const deadline = new Date(NOW.getTime() + 10 * 60 * 1000).toISOString();
    const ics = buildActivityIcs(
      [activity({ startsAt: null, endsAt: null, registrationDeadlineAt: deadline })],
      { calendarName: 'x', now: NOW },
    );
    expect(ics).toContain('TRIGGER:-PT5M');
  });

  it('报名截止已过 → 不写 VALARM', () => {
    const ics = buildActivityIcs(
      [activity({ startsAt: null, endsAt: null, registrationDeadlineAt: '2026-10-19T04:00:00.000Z' })],
      { calendarName: 'x', now: NOW },
    );
    expect(ics).not.toContain('BEGIN:VALARM');
  });
});
