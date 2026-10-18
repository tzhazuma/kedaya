import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCHOOL_TIME_ZONE,
  deadlineUrgency,
  mergeDeadlines,
  normalizeDeadlineTitle,
  parseDueText,
  sortByUrgency,
  summarizeDeadlines,
  type DeadlineItemLike,
} from './deadline-normalize';

/**
 * DDL 归一化测试。
 *
 * 重心只有三个：
 *   1. **时区** —— 同一段文本在 Asia/Shanghai 与 UTC 下必须得出不同的绝对时刻；
 *   2. **不猜** —— 认不出的文本返回 null，非法日期不进位、有歧义的时区缩写不猜；
 *   3. **跨平台去重** —— 同课程 + 同归一标题 + 5 分钟内，才合并。
 */

const NOW = new Date('2026-10-19T00:00:00.000Z'); // 上海 2026-10-19 08:00
const SHANGHAI = 'Asia/Shanghai';

/* ------------------------------------------------------------------ *
 * 时区
 * ------------------------------------------------------------------ */

describe('parseDueText · 时区是显式参数', () => {
  it('⚠️ 同一文本在 Asia/Shanghai 与 UTC 下结果不同', () => {
    // 上海 23:59 = UTC 15:59；UTC 23:59 = UTC 23:59
    expect(parseDueText('Oct 20, 2026 11:59 PM', NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('Oct 20, 2026 11:59 PM', NOW, 'UTC')).toBe('2026-10-20T23:59:00.000Z');

    // 无偏移 ISO 同样按传入时区解释
    expect(parseDueText('2026-10-20 23:59', NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('2026-10-20 23:59', NOW, 'UTC')).toBe('2026-10-20T23:59:00.000Z');
    expect(parseDueText('2026-10-20T23:59', NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
  });

  it('结果不依赖运行环境本地时区（任何时区都显式换算）', () => {
    // 若实现里用了 `new Date('2026-10-20 23:59')`，在 CI（UTC）与开发机（+08）
    // 会得到不同结果 —— 这里锁定成 UTC 字面量。
    expect(parseDueText('2026-10-20 23:59', NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('2026-10-20 23:59', NOW, SHANGHAI)).toBe(
      parseDueText('2026-10-20T23:59', NOW, SHANGHAI),
    );
  });

  it('纽约夏令时：无偏移文本按 America/New_York 解释', () => {
    // 2026-10-20 是 EDT（UTC-4）
    expect(parseDueText('Oct 20, 2026 11:59 PM', NOW, 'America/New_York')).toBe(
      '2026-10-21T03:59:00.000Z',
    );
  });

  it('AM/PM 边界：12 AM = 0 点，12 PM = 12 点', () => {
    expect(parseDueText('Oct 20, 2026 12:00 AM', NOW, SHANGHAI)).toBe('2026-10-19T16:00:00.000Z');
    expect(parseDueText('Oct 20, 2026 12:00 PM', NOW, SHANGHAI)).toBe('2026-10-20T04:00:00.000Z');
  });

  it('已含偏移 / Z 的文本不受 timeZone 影响（绝对时刻已定）', () => {
    const text = '2026-10-20T23:59:00+08:00';
    expect(parseDueText(text, NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText(text, NOW, 'UTC')).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('2026-10-20T15:59:00Z', NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('2026-10-20 23:59 UTC', NOW, SHANGHAI)).toBe('2026-10-20T23:59:00.000Z');
  });

  it('夏令时重复的墙上时间取较早的一次；不存在的墙上时间返回 null', () => {
    // 2026-11-01 01:30 在纽约出现两次（EDT 05:30Z / EST 06:30Z）→ 取较早
    expect(parseDueText('2026-11-01 01:30', NOW, 'America/New_York')).toBe(
      '2026-11-01T05:30:00.000Z',
    );
    // 2026-03-08 02:30 在纽约不存在（02:00 直接跳到 03:00）→ 不猜
    expect(parseDueText('2026-03-08 02:30', NOW, 'America/New_York')).toBeNull();
  });

  it('时区名非法抛 RangeError（配置错误不能静默回退本地时区）', () => {
    expect(() => parseDueText('2026-10-20 23:59', NOW, '')).toThrow(RangeError);
    expect(() => parseDueText('2026-10-20 23:59', NOW, 'Mars/Olympus')).toThrow(RangeError);
    expect(() => deadlineUrgency('2026-10-20T00:00:00.000Z', NOW, 'Nowhere/Zone')).toThrow(
      RangeError,
    );
  });

  it('now 非法抛 RangeError', () => {
    expect(() => parseDueText('2026-10-20 23:59', new Date(Number.NaN), SHANGHAI)).toThrow(
      RangeError,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 格式
 * ------------------------------------------------------------------ */

describe('parseDueText · 支持的格式', () => {
  it('Blackboard 英文月份', () => {
    expect(parseDueText('Oct 20, 2026 11:59 PM', NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('September 3, 2026 9:05 AM', NOW, SHANGHAI)).toBe(
      '2026-09-03T01:05:00.000Z',
    );
    expect(parseDueText('Oct 20 2026 23:59', NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('October 20, 2026 at 11:59 PM', NOW, SHANGHAI)).toBe(
      '2026-10-20T15:59:00.000Z',
    );
  });

  it('中文日期（含/不含年份）', () => {
    expect(parseDueText('2026年10月20日 23:59', NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('2026年10月20日23:59', NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('10月20日 23:59', NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('10月20号 23:59', NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('10月20日 23:59', NOW, 'UTC')).toBe('2026-10-20T23:59:00.000Z');
  });

  it('缺年份时取「从现在起最近的一次」', () => {
    // 2026-10-19 看 10 月 20 日 → 今年
    expect(parseDueText('10月20日 23:59', NOW, SHANGHAI)).toBe('2026-10-20T15:59:00.000Z');
    // 2026-12-01 看 10 月 20 日 → 明年
    const december = new Date('2026-12-01T00:00:00.000Z');
    expect(parseDueText('10月20日 23:59', december, SHANGHAI)).toBe('2027-10-20T15:59:00.000Z');
    expect(parseDueText('Oct 20 11:59 PM', december, SHANGHAI)).toBe('2027-10-20T15:59:00.000Z');
  });

  it('相对时间以 now 为基准（精确保留平台倒计时的时长）', () => {
    expect(parseDueText('Due in 3 days', NOW, SHANGHAI)).toBe('2026-10-22T00:00:00.000Z');
    expect(parseDueText('in 2 hours', NOW, SHANGHAI)).toBe('2026-10-19T02:00:00.000Z');
    expect(parseDueText('in 1 week', NOW, SHANGHAI)).toBe('2026-10-26T00:00:00.000Z');
    // 相对时间与 timeZone 无关（时长是绝对的）
    expect(parseDueText('Due in 3 days', NOW, 'UTC')).toBe('2026-10-22T00:00:00.000Z');
  });

  it('中文相对时间', () => {
    expect(parseDueText('3 天后截止', NOW, SHANGHAI)).toBe('2026-10-22T00:00:00.000Z');
    expect(parseDueText('2 小时后', NOW, SHANGHAI)).toBe('2026-10-19T02:00:00.000Z');
  });

  it('平台前缀被剥掉', () => {
    expect(parseDueText('截止时间：2026-10-20 23:59', NOW, SHANGHAI)).toBe(
      '2026-10-20T15:59:00.000Z',
    );
    expect(parseDueText('Due: Oct 20, 2026 11:59 PM', NOW, SHANGHAI)).toBe(
      '2026-10-20T15:59:00.000Z',
    );
  });
});

/* ------------------------------------------------------------------ *
 * 不猜
 * ------------------------------------------------------------------ */

describe('parseDueText · 认不出就返回 null', () => {
  it('空串 / 无意义文本', () => {
    expect(parseDueText('', NOW, SHANGHAI)).toBeNull();
    expect(parseDueText('   ', NOW, SHANGHAI)).toBeNull();
    expect(parseDueText('TBD', NOW, SHANGHAI)).toBeNull();
    expect(parseDueText('另行通知', NOW, SHANGHAI)).toBeNull();
    expect(parseDueText('next Friday', NOW, SHANGHAI)).toBeNull();
  });

  it('⚠️ 缺时间的纯日期不猜（不知道几点截止）', () => {
    expect(parseDueText('2026-10-20', NOW, SHANGHAI)).toBeNull();
    expect(parseDueText('Oct 20, 2026', NOW, SHANGHAI)).toBeNull();
    expect(parseDueText('10月20日', NOW, SHANGHAI)).toBeNull();
  });

  it('⚠️ 有歧义的时区缩写不猜', () => {
    expect(parseDueText('Oct 20, 2026 11:59 PM CST', NOW, SHANGHAI)).toBeNull();
    expect(parseDueText('Oct 20, 2026 11:59 PM EST', NOW, SHANGHAI)).toBeNull();
  });

  it('非法日期不被 Date 静默进位', () => {
    expect(parseDueText('2026-02-30 23:59', NOW, SHANGHAI)).toBeNull();
    expect(parseDueText('2026-13-01 23:59', NOW, SHANGHAI)).toBeNull();
    expect(parseDueText('2026-10-20 25:00', NOW, SHANGHAI)).toBeNull();
    expect(parseDueText('2026-10-20 23:60', NOW, SHANGHAI)).toBeNull();
    expect(parseDueText('Feb 29, 2026 23:59', NOW, SHANGHAI)).toBeNull(); // 2026 非闰年
  });

  it('认不出的相对单位', () => {
    expect(parseDueText('Due in 3 fortnights', NOW, SHANGHAI)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 去重
 * ------------------------------------------------------------------ */

function item(overrides: Partial<DeadlineItemLike> & { id: string }): DeadlineItemLike {
  return {
    source: 'blackboard',
    kind: 'assignment',
    title: 'Homework 1',
    courseId: 'cs101',
    courseName: '计算机导论',
    dueAt: '2026-10-20T15:59:00.000Z',
    dueAtRaw: 'Oct 20, 2026 11:59 PM',
    sourceUrl: 'https://example.invalid/bb/cs101/hw1',
    submitted: false,
    weight: null,
    ...overrides,
  };
}

describe('normalizeDeadlineTitle', () => {
  it('空白 / 大小写 / 全角 / 分隔标点不影响判重键', () => {
    expect(normalizeDeadlineTitle('  Homework   1  ')).toBe('homework1');
    expect(normalizeDeadlineTitle('Homework-1')).toBe('homework1');
    expect(normalizeDeadlineTitle('Ｈｏｍｅｗｏｒｋ　１')).toBe('homework1');
    expect(normalizeDeadlineTitle('Lab 1: Intro')).toBe(normalizeDeadlineTitle('Lab-1 Intro'));
    expect(normalizeDeadlineTitle('作业 1')).toBe(normalizeDeadlineTitle('作业1'));
  });

  it('不截断长标题（截断会让 Part A / Part B 误合并）', () => {
    const base = 'Project milestone '.repeat(5);
    expect(normalizeDeadlineTitle(`${base} Part A`)).not.toBe(
      normalizeDeadlineTitle(`${base} Part B`),
    );
  });
});

describe('mergeDeadlines', () => {
  it('⚠️ 同一作业在 BB 与 Piazza → 一条，sources 记两个，取最早 dueAt', () => {
    const blackboard = item({ id: 'bb-1', title: 'Homework 1' });
    const piazza = item({
      id: 'pz-1',
      title: '  homework   1  ',
      source: 'piazza',
      dueAt: '2026-10-20T16:02:00.000Z', // 3 分钟后
    });

    const merged = mergeDeadlines([blackboard, piazza]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources).toEqual(['blackboard', 'piazza']);
    expect(merged[0]?.source).toBe('blackboard');
    expect(merged[0]?.dueAt).toBe('2026-10-20T15:59:00.000Z');
    expect(merged[0]?.title).toBe('Homework 1');
  });

  it('输入顺序不影响 sources 顺序（按来源优先级）', () => {
    const piazza = item({ id: 'pz', source: 'piazza' });
    const manual = item({ id: 'mn', source: 'manual' });
    const ecourse = item({ id: 'ec', source: 'ecourse' });
    const blackboard = item({ id: 'bb' });
    const merged = mergeDeadlines([piazza, manual, ecourse, blackboard]);
    expect(merged[0]?.sources).toEqual(['blackboard', 'ecourse', 'piazza', 'manual']);
    expect(merged[0]?.source).toBe('blackboard');
  });

  it('±5 分钟以内合并，超过 1 毫秒也不合并', () => {
    const base = item({ id: 'a', dueAt: '2026-10-20T15:59:00.000Z' });
    const exactlyFive = item({ id: 'b', source: 'piazza', dueAt: '2026-10-20T16:04:00.000Z' });
    expect(mergeDeadlines([base, exactlyFive])).toHaveLength(1);

    const overFive = item({ id: 'c', source: 'piazza', dueAt: '2026-10-20T16:04:00.001Z' });
    expect(mergeDeadlines([base, overFive])).toHaveLength(2);
  });

  it('⚠️ 0/4/8 分钟不会链式串成一条', () => {
    const first = item({ id: 'a', dueAt: '2026-10-20T15:59:00.000Z' });
    const second = item({ id: 'b', source: 'piazza', dueAt: '2026-10-20T16:03:00.000Z' });
    const third = item({ id: 'c', source: 'ecourse', dueAt: '2026-10-20T16:07:00.000Z' });
    const merged = mergeDeadlines([first, second, third]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.sources).toEqual(['blackboard', 'piazza']);
    expect(merged[1]?.sources).toEqual(['ecourse']);
  });

  it('不同课程 / 不同标题不合并', () => {
    expect(
      mergeDeadlines([
        item({ id: 'a', courseId: 'cs101' }),
        item({ id: 'b', courseId: 'math201' }),
      ]),
    ).toHaveLength(2);
    expect(
      mergeDeadlines([
        item({ id: 'a', title: 'Homework 1' }),
        item({ id: 'b', title: 'Homework 2' }),
      ]),
    ).toHaveLength(2);
  });

  it('任一来源 submitted → 合并后已提交', () => {
    const merged = mergeDeadlines([
      item({ id: 'a', submitted: false }),
      item({ id: 'b', source: 'piazza', submitted: true }),
    ]);
    expect(merged[0]?.submitted).toBe(true);
  });

  it('weight 取主条目；主条目为空时取优先级最高的非空值', () => {
    const noWeight = mergeDeadlines([
      item({ id: 'a', weight: null }),
      item({ id: 'b', source: 'piazza', weight: 10 }),
    ]);
    expect(noWeight[0]?.weight).toBe(10);

    const primaryWeight = mergeDeadlines([
      item({ id: 'a', weight: 20 }),
      item({ id: 'b', source: 'piazza', weight: 10 }),
    ]);
    expect(primaryWeight[0]?.weight).toBe(20);
  });

  it('任一来源 stale → 合并后 stale（本次采集有平台失败）', () => {
    const merged = mergeDeadlines([
      item({ id: 'a' }),
      item({ id: 'b', source: 'piazza', stale: true }),
    ]);
    expect(merged[0]?.stale).toBe(true);

    const fresh = mergeDeadlines([item({ id: 'a' }), item({ id: 'b', source: 'piazza' })]);
    expect('stale' in (fresh[0] ?? {})).toBe(false);
  });

  it('dueAt 无法解析的条目不参与判重，保留在末尾', () => {
    const merged = mergeDeadlines([
      item({ id: 'bad-2', dueAt: 'not-a-date' }),
      item({ id: 'good', dueAt: '2026-10-21T15:59:00.000Z' }),
      item({ id: 'bad-1', dueAt: 'not-a-date' }),
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.map((entry) => entry.id)).toEqual(['good', 'bad-1', 'bad-2']);
    expect(merged[1]?.sources).toEqual(['blackboard']);
  });

  it('输出按 dueAt 升序（同刻按 id）', () => {
    const merged = mergeDeadlines([
      item({ id: 'late', title: 'Late', dueAt: '2026-10-22T15:59:00.000Z' }),
      item({ id: 'early', title: 'Early', dueAt: '2026-10-21T15:59:00.000Z' }),
    ]);
    expect(merged.map((entry) => entry.id)).toEqual(['early', 'late']);
  });

  it('纯函数：不修改入参，返回新对象', () => {
    const input = [item({ id: 'a' }), item({ id: 'b', source: 'piazza' })];
    const before = JSON.stringify(input);
    const merged = mergeDeadlines(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(merged[0]).not.toBe(input[0]);
    expect('sources' in (input[0] ?? {})).toBe(false);
  });

  it('空输入返回空数组', () => {
    expect(mergeDeadlines([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 排序
 * ------------------------------------------------------------------ */

describe('sortByUrgency', () => {
  const items: DeadlineItemLike[] = [
    item({ id: 'far', title: 'Far', dueAt: '2026-11-01T00:00:00.000Z' }),
    item({ id: 'overdue', title: 'Overdue', dueAt: '2026-10-18T00:00:00.000Z' }),
    item({ id: 'week', title: 'Week', dueAt: '2026-10-22T00:00:00.000Z' }),
    item({ id: 'today', title: 'Today', dueAt: '2026-10-19T08:00:00.000Z' }),
    item({
      id: 'done',
      title: 'Done',
      dueAt: '2026-10-18T00:00:00.000Z',
      submitted: true,
    }),
    item({ id: 'bad', title: 'Bad', dueAt: 'not-a-date' }),
  ];

  it('已逾期 → 今天 → 本周 → 更远 → 已提交 → 未知', () => {
    expect(sortByUrgency(items, NOW, SHANGHAI).map((entry) => entry.id)).toEqual([
      'overdue',
      'today',
      'week',
      'far',
      'done',
      'bad',
    ]);
  });

  it('截止时刻恰好等于 now → 今天（不是逾期）', () => {
    expect(sortByUrgency([item({ id: 'exact', dueAt: NOW.toISOString() })], NOW, SHANGHAI)).toHaveLength(
      1,
    );
    expect(deadlineUrgency(NOW.toISOString(), NOW, SHANGHAI)).toBe('today');
  });

  it('⚠️ 同一个时刻，UTC 与上海对「今天」的判定不同', () => {
    const due = '2026-10-19T17:00:00.000Z';
    // 上海：已是 10-20 01:00 → 明天 → 本周；UTC：仍是 10-19 → 今天
    expect(deadlineUrgency(due, NOW, SHANGHAI)).toBe('thisWeek');
    expect(deadlineUrgency(due, NOW, 'UTC')).toBe('today');
  });

  it('默认时区就是学校时区', () => {
    const sorted = sortByUrgency(items, NOW);
    expect(sorted.map((entry) => entry.id)).toEqual(
      sortByUrgency(items, NOW, DEFAULT_SCHOOL_TIME_ZONE).map((entry) => entry.id),
    );
  });

  it('同档同时刻按 id 排序（结果稳定）', () => {
    const same = [
      item({ id: 'b', title: 'B', dueAt: '2026-10-19T08:00:00.000Z' }),
      item({ id: 'a', title: 'A', dueAt: '2026-10-19T08:00:00.000Z' }),
    ];
    expect(sortByUrgency(same, NOW, SHANGHAI).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('纯函数：不修改入参', () => {
    const before = [...items];
    sortByUrgency(items, NOW, SHANGHAI);
    expect(items).toEqual(before);
  });
});

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */

describe('summarizeDeadlines', () => {
  const now = new Date('2026-10-19T00:00:00.000Z');

  it('按逾期/今天/本周分档，已提交与非法日期不计入待办但计入 total', () => {
    const summary = summarizeDeadlines(
      [
        item({ id: 'a', dueAt: '2026-10-18T00:00:00.000Z' }), // 逾期
        item({ id: 'b', dueAt: '2026-10-19T08:00:00.000Z' }), // 今天
        item({ id: 'c', dueAt: '2026-10-22T00:00:00.000Z' }), // 本周
        item({ id: 'd', dueAt: '2026-11-01T00:00:00.000Z' }), // 更远
        item({ id: 'e', dueAt: '2026-10-18T00:00:00.000Z', submitted: true }), // 已提交
        item({ id: 'f', dueAt: 'not-a-date' }), // 无法分档
      ],
      now,
      SHANGHAI,
    );
    expect(summary).toEqual({ overdue: 1, dueToday: 1, dueThisWeek: 1, total: 6 });
  });

  it('⚠️ 同一时刻在 UTC 与上海的分档不同（自然日边界）', () => {
    const due = item({ id: 'x', dueAt: '2026-10-19T17:00:00.000Z' });
    expect(summarizeDeadlines([due], now, SHANGHAI)).toEqual({
      overdue: 0,
      dueToday: 0,
      dueThisWeek: 1,
      total: 1,
    });
    expect(summarizeDeadlines([due], now, 'UTC')).toEqual({
      overdue: 0,
      dueToday: 1,
      dueThisWeek: 0,
      total: 1,
    });
  });

  it('截止时刻恰好等于 now 算今天', () => {
    expect(summarizeDeadlines([item({ id: 'x', dueAt: now.toISOString() })], now, SHANGHAI)).toEqual({
      overdue: 0,
      dueToday: 1,
      dueThisWeek: 0,
      total: 1,
    });
  });

  it('已提交的不计入任何待办分档', () => {
    expect(
      summarizeDeadlines(
        [item({ id: 'x', dueAt: '2026-10-18T00:00:00.000Z', submitted: true })],
        now,
        SHANGHAI,
      ),
    ).toEqual({ overdue: 0, dueToday: 0, dueThisWeek: 0, total: 1 });
  });

  it('空列表全 0', () => {
    expect(summarizeDeadlines([], now, SHANGHAI)).toEqual({
      overdue: 0,
      dueToday: 0,
      dueThisWeek: 0,
      total: 0,
    });
  });
});
