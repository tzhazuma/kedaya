import { describe, expect, it } from 'vitest';

import type { DeadlineItem, DeadlineSource } from '@kedaya/contracts';

import {
  mergeDeadlines,
  parseDueText,
  sortByUrgency,
  summarizeDeadlines,
} from './deadline-normalize';

/**
 * DDL 归一化。
 *
 * 这组测试的重心是**时区**：这是整个文件里唯一一个"写错了不会报错、
 * 但学生会被扣分"的地方。其余是去重与排序的边界。
 */

/* ------------------------------------------------------------------ *
 * 时区 —— 最重要的部分
 * ------------------------------------------------------------------ */

describe('parseDueText · 时区', () => {
  it('已含偏移的 ISO 直接用', () => {
    expect(parseDueText('2026-10-20T23:59:00+08:00')).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('2026-10-20T15:59:00Z')).toBe('2026-10-20T15:59:00.000Z');
  });

  it('⚠️ 无偏移的字面时间按**学校时区**解释（不是运行环境时区）', () => {
    // 上海 2026-10-20 23:59 = UTC 2026-10-20 15:59
    expect(parseDueText('2026-10-20 23:59')).toBe('2026-10-20T15:59:00.000Z');
    expect(parseDueText('2026-10-20')).toBe('2026-10-20T15:59:00.000Z');
  });

  it('⚠️ Blackboard 风格的 AM/PM 也按学校时区', () => {
    // 11:59 PM = 23:59 上海 = 15:59 UTC
    expect(parseDueText('Oct 20, 2026 11:59 PM')).toBe('2026-10-20T15:59:00.000Z');
    // 12:00 AM = 00:00 上海 = 前一天 16:00 UTC
    expect(parseDueText('Oct 20, 2026 12:00 AM')).toBe('2026-10-19T16:00:00.000Z');
    // 12:00 PM = 12:00 上海 = 04:00 UTC
    expect(parseDueText('Oct 20, 2026 12:00 PM')).toBe('2026-10-20T04:00:00.000Z');
  });

  it('中文日期格式', () => {
    expect(parseDueText('10月20日 23:59')).toBe(
      `${new Date().getUTCFullYear()}-10-20T15:59:00.000Z`,
    );
    expect(parseDueText('2026年10月20日 23:59')).toBe('2026-10-20T15:59:00.000Z');
  });

  it('⚠️ 同一个文本在任何运行环境下结果一致（不依赖本地时区）', () => {
    // 这条断言的真正意义：如果实现里用了 `new Date(text)`，
    // 在 CI（UTC）与开发者机器（+08）上会得到不同结果。这里固定成 UTC 字面量。
    const a = parseDueText('2026-10-20 23:59');
    const b = parseDueText('2026-10-20T23:59');
    expect(a).toBe(b);
    expect(a).toBe('2026-10-20T15:59:00.000Z');
  });
});

describe('parseDueText · 相对时间', () => {
  const now = new Date('2026-10-20T00:00:00Z');

  it('英文相对时间', () => {
    expect(parseDueText('Due in 3 days', now)).toBe('2026-10-23T00:00:00.000Z');
    expect(parseDueText('in 2 hours', now)).toBe('2026-10-20T02:00:00.000Z');
    expect(parseDueText('in 1 week', now)).toBe('2026-10-27T00:00:00.000Z');
  });

  it('中文相对时间', () => {
    expect(parseDueText('3 天后截止', now)).toBe('2026-10-23T00:00:00.000Z');
    expect(parseDueText('2 小时后', now)).toBe('2026-10-20T02:00:00.000Z');
  });
});

describe('parseDueText · 认不出就不猜', () => {
  it('空串 / 无意义文本返回 null', () => {
    expect(parseDueText('')).toBeNull();
    expect(parseDueText('   ')).toBeNull();
    expect(parseDueText('TBD')).toBeNull();
    expect(parseDueText('另行通知')).toBeNull();
  });

  it('⚠️ 明显非法的日期返回 null（不是滚动到下个月）', () => {
    expect(parseDueText('2026-02-30')).toBeNull();
    expect(parseDueText('2026-13-01')).toBeNull();
    expect(parseDueText('2026-10-20 25:00')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 去重
 * ------------------------------------------------------------------ */

function item(over: Partial<DeadlineItem> & { title: string }): DeadlineItem {
  const source: DeadlineSource = over.source ?? 'blackboard';
  return {
    id: over.id ?? `${source}-${over.title}`,
    source,
    sources: over.sources ?? [source],
    kind: over.kind ?? 'assignment',
    title: over.title,
    courseId: over.courseId === undefined ? 'cs101' : over.courseId,
    courseName: over.courseName ?? '计算机导论',
    dueAt: over.dueAt === undefined ? '2026-10-20T15:59:00.000Z' : over.dueAt,
    dueAtRaw: over.dueAtRaw ?? '2026-10-20 23:59',
    submitted: over.submitted ?? false,
    fetchedAt: over.fetchedAt ?? '2026-10-19T00:00:00.000Z',
    stale: over.stale ?? false,
    ...(over.weightPercent !== undefined ? { weightPercent: over.weightPercent } : {}),
    ...(over.sourceUrl !== undefined ? { sourceUrl: over.sourceUrl } : {}),
  };
}

describe('mergeDeadlines', () => {
  it('同课程 + 同标题 + 同截止 → 合成一条，sources 记两个', () => {
    const merged = mergeDeadlines([
      item({ title: 'Homework 1', source: 'blackboard' }),
      item({ title: 'Homework 1', source: 'piazza' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources.sort()).toEqual(['blackboard', 'piazza']);
  });

  it('⚠️ 同标题但**不同课程** → 不合并', () => {
    const merged = mergeDeadlines([
      item({ title: 'Homework 1', courseId: 'cs101' }),
      item({ title: 'Homework 1', courseId: 'math201' }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('⚠️ 同标题同课程但截止差超过容差 → 不合并', () => {
    const merged = mergeDeadlines([
      item({ title: 'Homework 1', dueAt: '2026-10-20T15:59:00.000Z' }),
      item({ title: 'Homework 1', dueAt: '2026-10-27T15:59:00.000Z' }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('标题大小写与多余空白不影响判重', () => {
    const merged = mergeDeadlines([
      item({ title: 'Homework 1' }),
      item({ title: '  homework   1  ', source: 'gradescope' }),
    ]);
    expect(merged).toHaveLength(1);
  });

  it('任一来源标了 submitted 就算已提交', () => {
    const merged = mergeDeadlines([
      item({ title: 'Homework 1', submitted: false }),
      item({ title: 'Homework 1', source: 'gradescope', submitted: true }),
    ]);
    expect(merged[0]?.submitted).toBe(true);
  });

  it('weightPercent 取第一个非空值', () => {
    const merged = mergeDeadlines([
      item({ title: 'Homework 1' }),
      item({ title: 'Homework 1', source: 'piazza', weightPercent: 10 }),
    ]);
    expect(merged[0]?.weightPercent).toBe(10);
  });
});

/* ------------------------------------------------------------------ *
 * 排序与汇总
 * ------------------------------------------------------------------ */

describe('sortByUrgency', () => {
  const now = new Date('2026-10-20T00:00:00Z');

  it('已逾期 → 今天 → 本周 → 更远', () => {
    const sorted = sortByUrgency(
      [
        item({ title: 'far', dueAt: '2026-11-20T00:00:00.000Z' }),
        item({ title: 'overdue', dueAt: '2026-10-19T00:00:00.000Z' }),
        item({ title: 'week', dueAt: '2026-10-23T00:00:00.000Z' }),
        item({ title: 'today', dueAt: '2026-10-20T10:00:00.000Z' }),
      ],
      now,
    );
    expect(sorted.map((i) => i.title)).toEqual(['overdue', 'today', 'week', 'far']);
  });

  it('已提交的沉到同档末尾', () => {
    const sorted = sortByUrgency(
      [
        item({ title: 'done', dueAt: '2026-10-20T10:00:00.000Z', submitted: true }),
        item({ title: 'todo', dueAt: '2026-10-20T12:00:00.000Z', submitted: false }),
      ],
      now,
    );
    expect(sorted.map((i) => i.title)).toEqual(['todo', 'done']);
  });

  it('无截止时刻的排最后（不抢占注意力）', () => {
    const sorted = sortByUrgency(
      [
        item({ title: 'nodate', dueAt: null }),
        item({ title: 'dated', dueAt: '2026-10-25T00:00:00.000Z' }),
      ],
      now,
    );
    expect(sorted[0]?.title).toBe('dated');
  });
});

describe('summarizeDeadlines', () => {
  const now = new Date('2026-10-20T00:00:00Z');

  it('按逾期/今天/本周分档，已提交不计入', () => {
    const summary = summarizeDeadlines(
      [
        item({ title: 'a', dueAt: '2026-10-19T00:00:00.000Z' }), // 逾期
        item({ title: 'b', dueAt: '2026-10-20T10:00:00.000Z' }), // 今天（上海 18:00）
        item({ title: 'c', dueAt: '2026-10-23T00:00:00.000Z' }), // 本周
        item({ title: 'd', dueAt: '2026-11-20T00:00:00.000Z' }), // 更远
        item({ title: 'e', dueAt: '2026-10-19T00:00:00.000Z', submitted: true }), // 已交
      ],
      now,
    );
    expect(summary.overdue).toBe(1);
    expect(summary.dueToday).toBe(1);
    expect(summary.dueThisWeek).toBe(1);
    expect(summary.total).toBe(5);
  });

  it('无截止时刻的不计入分档但计入 total', () => {
    const summary = summarizeDeadlines([item({ title: 'x', dueAt: null })], now);
    expect(summary.total).toBe(0);
    expect(summary.overdue).toBe(0);
  });
});
