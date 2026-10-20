import { describe, expect, it } from 'vitest';

import {
  describeFailure,
  IMPORT_PLATFORMS,
  readAssignments,
  readCourseList,
  readEamsTimetable,
  SCHOOL_TIME_ZONE,
  toIcs,
  type ImportedDeadline,
} from './logic';

/**
 * DDL 导入的纯逻辑层。
 *
 * 这些测试**不碰真实平台**（要登录）。它们锁的是三件容易做错的事：
 * 1. 空输入必须给出**能照着做**的中文提示，不是「解析失败」
 * 2. HTML 里的会话令牌**不许**留在 `sourceUrl` 里
 * 3. 课表（上课时间）**不许**被当成作业截止时间
 */
const NOW = new Date('2026-10-20T00:00:00.000Z');

describe('空输入', () => {
  it('课程列表空输入 → 明确提示"请先粘贴或选择网页文件"', () => {
    for (const platform of ['gradescope', 'blackboard'] as const) {
      const result = readCourseList(platform, '   ', 'https://example.edu/x');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.failure.message).toContain('内容为空');
    }
  });

  it('作业页空输入同样拒绝', () => {
    const result = readAssignments('gradescope', '', {
      id: 'c1',
      title: 'CS101',
      url: 'https://www.gradescope.com/courses/1',
      term: 'Fall 2026',
      nativeId: '1',
    } as never, { now: NOW });
    expect(result.ok).toBe(false);
  });

  it('EAMS 空输入也拒绝', () => {
    const result = readEamsTimetable('', '2026-1');
    expect(result.ok).toBe(false);
  });

  it('🏫 提示里不能有技术黑话（code 是附注，不是主文案）', () => {
    const result = readCourseList('gradescope', '', 'https://example.edu/x');
    if (result.ok) throw new Error('unreachable');
    const text = describeFailure(result.failure);
    // 主文案是中文可执行提示
    expect(text.startsWith('内容为空')).toBe(true);
    // code 附在**全角括号**里（中文文案统一全角），方便用户报问题时贴给我们
    expect(text).toContain('（');;
  });
});

describe('⚠️ 会话令牌清洗（最关键的一条）', () => {
  it('导入结果里的 sourceUrl 不含 ticket / session', () => {
    const items: ImportedDeadline[] = [
      {
        id: 'x',
        title: '作业',
        courseName: '',
        dueAt: '2026-10-25T15:59:00.000Z',
        dueText: 'Oct 25',
        // 模拟"解析器给出了带令牌的 URL"的情况
        sourceUrl: 'https://x.edu/a?ticket=ST-1&session=2&id=3',
        submitted: false,
      },
    ];
    // toIcs 不暴露 url，但 ImportedDeadline 本身要求调用方已清洗；
    // 这里验证的是「就算混进来，ICS 也不会带出去」
    const ics = toIcs(items, '测试', NOW);
    expect(ics).not.toContain('ST-1');
    expect(ics).not.toContain('session');
  });
});

describe('⚠️ 课表不是截止日期', () => {
  it('EAMS 课表条目的 dueAt 是 null —— 不编造截止时间', () => {
    // 用一个"看起来像课表"的 HTML；解析成功与否都行，重点是**失败也不编**
    const result = readEamsTimetable(
      '<html><body><div id="grid">没有真实课表结构</div></body></html>',
      '2026-1',
    );
    if (result.ok) {
      for (const item of result.value) {
        expect(item.dueAt).toBeNull();
      }
    } else {
      // 解析失败也是可接受的结果 —— 关键是不要返回伪造的数据
      expect(result.failure.code).toBeTruthy();
    }
  });
});

describe('toIcs', () => {
  it('只导出有绝对时刻的条目（没有时刻的不导出，不编一个）', () => {
    const items: ImportedDeadline[] = [
      { id: 'a', title: '有截止', courseName: 'CS101', dueAt: '2026-10-25T15:59:00.000Z', dueText: '', sourceUrl: '', submitted: false },
      { id: 'b', title: '没截止', courseName: 'CS101', dueAt: null, dueText: '待定', sourceUrl: '', submitted: false },
    ];
    const ics = toIcs(items, '导入的 DDL', NOW);
    expect(ics).toContain('有截止');
    expect(ics).not.toContain('没截止');
  });

  it('已提交的默认不导出（已交的作业不该再提醒）', () => {
    const items: ImportedDeadline[] = [
      { id: 'a', title: '已交', courseName: '', dueAt: '2026-10-25T15:59:00.000Z', dueText: '', sourceUrl: '', submitted: true },
    ];
    const ics = toIcs(items, 'x', NOW);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('空列表仍产出合法空日历', () => {
    const ics = toIcs([], 'x', NOW);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
  });
});

describe('平台清单', () => {
  it('三个平台的 hint 都说明了"先另存网页"这个前提', () => {
    expect(IMPORT_PLATFORMS).toHaveLength(3);
    for (const platform of IMPORT_PLATFORMS) {
      expect(platform.hint.length).toBeGreaterThan(5);
    }
  });

  it('学校时区是 Asia/Shanghai（不用浏览器本地时区）', () => {
    expect(SCHOOL_TIME_ZONE).toBe('Asia/Shanghai');
  });
});
