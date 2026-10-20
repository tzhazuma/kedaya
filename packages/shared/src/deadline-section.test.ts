/**
 * `deadline-section` 的测试。
 *
 * 这套判据的每条分支都对应一个「用户会不会被误导」的场景，所以用例名写的是
 * 场景而不是函数名。尤其注意两条：
 * - `score: 0` 是**成绩**，不是缺失（0 分也得进 graded，不能留在待办里催）；
 * - `submitted: null`（读不到）不是「未提交」，不能因此催交。
 */

import { describe, expect, it } from 'vitest';

import {
  classifyDeadlineSection,
  isHistoricalDeadline,
  parseTermRank,
  partitionDeadlines,
  type DeadlineSectionContext,
  type DeadlineSectionInput,
} from './deadline-section';

/** 2026-10-20 08:00 北京时间 */
const NOW = new Date('2026-10-20T08:00:00+08:00');

const context: DeadlineSectionContext = {
  now: NOW,
  currentTerm: 'Fall 2026',
  semesterStart: '2026-09-07',
};

const classify = (input: DeadlineSectionInput, overrides: Partial<DeadlineSectionContext> = {}) =>
  classifyDeadlineSection(input, { ...context, ...overrides });

describe('parseTermRank', () => {
  it('认多种学期写法', () => {
    expect(parseTermRank('Fall 2026')).toEqual({ year: 2026, season: 'fall' });
    expect(parseTermRank('2026-fall')).toEqual({ year: 2026, season: 'fall' });
    expect(parseTermRank('2026-autumn')).toEqual({ year: 2026, season: 'fall' });
    expect(parseTermRank('2026-秋')).toEqual({ year: 2026, season: 'fall' });
    expect(parseTermRank('Spring 2027')).toEqual({ year: 2027, season: 'spring' });
    expect(parseTermRank('2027-春')).toEqual({ year: 2027, season: 'spring' });
    expect(parseTermRank('Summer 2026')).toEqual({ year: 2026, season: 'summer' });
  });

  it('认不出返回 null（不猜学期）', () => {
    expect(parseTermRank('132')).toBeNull(); // EAMS 的学期 ID
    expect(parseTermRank('Winter 2026')).toBeNull();
    expect(parseTermRank('Fall')).toBeNull();
    expect(parseTermRank('')).toBeNull();
    expect(parseTermRank(null)).toBeNull();
  });
});

describe('isHistoricalDeadline', () => {
  it('课程学期早于当前学期 → 历史', () => {
    expect(
      isHistoricalDeadline({ courseTerm: 'Spring 2026', dueAt: '2026-10-25T23:59:00+08:00' }, context),
    ).toBe(true);
  });

  it('同学年但季节更早也算', () => {
    expect(
      isHistoricalDeadline({ courseTerm: 'Spring 2026' }, { ...context, currentTerm: '2026-summer' }),
    ).toBe(true);
  });

  it('学期相同 / 更晚不算历史', () => {
    expect(isHistoricalDeadline({ courseTerm: 'Fall 2026' }, context)).toBe(false);
    expect(isHistoricalDeadline({ courseTerm: 'Spring 2027' }, context)).toBe(false);
  });

  it('平台明确标注非本学期 → 历史', () => {
    expect(isHistoricalDeadline({ courseCurrent: false }, context)).toBe(true);
  });

  it('截止日早于学期第一天 → 历史', () => {
    expect(isHistoricalDeadline({ dueAt: '2026-08-01T23:59:00+08:00' }, context)).toBe(true);
  });

  it('按学校时区判断自然日，而不是按 UTC', () => {
    // UTC 9/6 20:00 = 上海 9/7 04:00 → 不早于 9/7
    expect(isHistoricalDeadline({ dueAt: '2026-09-06T20:00:00Z' }, context)).toBe(false);
    // UTC 9/6 10:00 = 上海 9/6 18:00 → 早于 9/7
    expect(isHistoricalDeadline({ dueAt: '2026-09-06T10:00:00Z' }, context)).toBe(true);
  });

  it('没有截止时间时只用学期判据（不因缺时间就判历史）', () => {
    expect(isHistoricalDeadline({}, context)).toBe(false);
    expect(isHistoricalDeadline({ dueAt: 'not-a-date' }, context)).toBe(false);
  });

  it('非法时区时不做自然日判定', () => {
    expect(
      isHistoricalDeadline(
        { dueAt: '2026-08-01T23:59:00+08:00' },
        { ...context, timeZone: 'Not/AZone' },
      ),
    ).toBe(false);
  });

  it('semesterStart 格式非法时忽略该判据', () => {
    expect(
      isHistoricalDeadline(
        { dueAt: '2026-08-01T23:59:00+08:00' },
        { ...context, semesterStart: '2026/09/07' },
      ),
    ).toBe(false);
  });
});

describe('classifyDeadlineSection', () => {
  it('本学期、开放、未提交、未到期 → pending', () => {
    expect(
      classify({
        dueAt: '2026-10-22T23:59:00+08:00',
        submitted: false,
        availability: 'open',
        courseTerm: 'Fall 2026',
      }),
    ).toBe('pending');
  });

  it('本学期、开放、未提交、已过期 → late', () => {
    expect(
      classify({
        dueAt: '2026-10-19T23:59:00+08:00',
        submitted: false,
        availability: 'open',
      }),
    ).toBe('late');
  });

  it('已提交且有分数 → graded（0 分也算成绩）', () => {
    expect(
      classify({ dueAt: '2026-10-19T23:59:00+08:00', submitted: true, score: 0 }),
    ).toBe('graded');
    expect(classify({ submitted: true, score: 85 })).toBe('graded');
  });

  it('有分数但没读到提交状态 → graded（成绩本身就是证据）', () => {
    expect(classify({ submitted: null, score: 92 })).toBe('graded');
  });

  it('已提交但没出分 → completed', () => {
    expect(classify({ submitted: true, score: null })).toBe('completed');
  });

  it('提交是终态：来源已关闭也不影响 graded / completed', () => {
    expect(classify({ submitted: true, availability: 'closed' })).toBe('completed');
    expect(classify({ submitted: true, score: 77, availability: 'closed' })).toBe('graded');
  });

  it('来源已关闭 → ended（不进入待办）', () => {
    expect(classify({ submitted: false, availability: 'closed' })).toBe('ended');
    expect(classify({ submitted: false, availability: 'scheduled' })).toBe('ended');
    expect(classify({ submitted: false, availability: 'unknown' })).toBe('ended');
  });

  it('调用方不给 availability 时不拿它判（与上游的有意差异）', () => {
    expect(classify({ dueAt: '2026-10-22T23:59:00+08:00', submitted: false })).toBe('pending');
    expect(classify({ dueAt: '2026-10-19T23:59:00+08:00', submitted: false })).toBe('late');
  });

  it('历史学期的旧作业即使来源还开放、截止在未来 → ended', () => {
    expect(
      classify({
        dueAt: '2026-10-25T23:59:00+08:00',
        submitted: false,
        availability: 'open',
        courseTerm: 'Spring 2026',
      }),
    ).toBe('ended');
  });

  it('时间待定（缺 dueAt 或非法）→ pending，不当作逾期', () => {
    expect(classify({ submitted: false, availability: 'open' })).toBe('pending');
    expect(classify({ dueAt: 'TBD', submitted: false, availability: 'open' })).toBe('pending');
  });

  it('恰好等于当前时刻算逾期（<=）', () => {
    expect(classify({ dueAt: NOW.toISOString(), submitted: false, availability: 'open' })).toBe(
      'late',
    );
  });
});

describe('partitionDeadlines', () => {
  const items = [
    { id: 'p', dueAt: '2026-10-25T23:59:00+08:00', submitted: false, availability: 'open' as const },
    { id: 'l', dueAt: '2026-10-01T23:59:00+08:00', submitted: false, availability: 'open' as const },
    { id: 'g', submitted: true, score: 0 },
    { id: 'c', submitted: true },
    { id: 'e', courseTerm: 'Spring 2026' },
  ];

  it('按五区归类且组内保持输入顺序', () => {
    const groups = partitionDeadlines(items, context);
    expect(groups.pending.map((item) => item.id)).toEqual(['p']);
    expect(groups.late.map((item) => item.id)).toEqual(['l']);
    expect(groups.graded.map((item) => item.id)).toEqual(['g']);
    expect(groups.completed.map((item) => item.id)).toEqual(['c']);
    expect(groups.ended.map((item) => item.id)).toEqual(['e']);
  });

  it('每条都恰好落进一个分区', () => {
    const groups = partitionDeadlines(items, context);
    const total = Object.values(groups).reduce((sum, group) => sum + group.length, 0);
    expect(total).toBe(items.length);
  });

  it('空输入返回五个空数组', () => {
    expect(partitionDeadlines([], context)).toEqual({
      pending: [],
      late: [],
      graded: [],
      completed: [],
      ended: [],
    });
  });

  it('不修改入参', () => {
    const frozen = [Object.freeze({ id: 'x', submitted: true })];
    expect(() => partitionDeadlines(frozen, context)).not.toThrow();
    expect(frozen[0]?.id).toBe('x');
  });
});
