import { describe, expect, it } from 'vitest';

import { buildDeadlineIcs, looksLikeIcs, type IcsDeadlineInput } from './deadline-ics';

/**
 * ICS 导出。
 *
 * 测试重心是三个**格式硬约束** —— 它们错了不会在本机报错，
 * 只会在用户日历里静默不显示：
 *   1. 行分隔符必须 CRLF
 *   2. 每行 ≤ 75 字节，超出折行
 *   3. 文本必须转义
 */
const NOW = new Date('2026-10-19T04:00:00.000Z');

function item(over: Partial<IcsDeadlineInput> = {}): IcsDeadlineInput {
  return {
    id: 'ddl-1',
    title: '作业 3',
    courseName: 'CS101',
    dueAt: '2026-10-20T15:59:00.000Z',
    sourceLabel: 'Blackboard',
    submitted: false,
    ...over,
  };
}

describe('buildDeadlineIcs —— 基本结构', () => {
  it('是合法的 VCALENDAR 外壳', () => {
    const ics = buildDeadlineIcs([item()], { calendarName: '可达鸭 DDL', now: NOW });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('X-WR-CALNAME:可达鸭 DDL');
  });

  it('⚠️ 行分隔符必须是 CRLF（用 \\n 会被 Apple 日历整份拒绝）', () => {
    const ics = buildDeadlineIcs([item()], { calendarName: 'x', now: NOW });
    // 不允许出现"非 \r 引导的 \n"
    expect(/(?<!\r)\n/.test(ics)).toBe(false);
  });

  it('一条 DDL 生成一个 VEVENT', () => {
    const ics = buildDeadlineIcs([item()], { calendarName: 'x', now: NOW });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('SUMMARY:作业 3');
    expect(ics).toContain('DTSTART:20261020T155900Z');
    expect(ics).toContain('UID:ddl-1@kedaya');
  });

  it('已提交的默认跳过（已交的作业不该再提醒）', () => {
    const ics = buildDeadlineIcs([item({ submitted: true })], { calendarName: 'x', now: NOW });
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('skipSubmitted: false 时保留已提交', () => {
    const ics = buildDeadlineIcs([item({ submitted: true })], {
      calendarName: 'x',
      now: NOW,
      skipSubmitted: false,
    });
    expect(ics).toContain('BEGIN:VEVENT');
  });

  it('⚠️ 截止时刻不可解析 → 跳过，不编一个时间', () => {
    const ics = buildDeadlineIcs([item({ dueAt: 'not-a-date' })], { calendarName: 'x', now: NOW });
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('⚠️ 没有条目时仍返回合法空日历（不是空字符串）', () => {
    const ics = buildDeadlineIcs([], { calendarName: 'x', now: NOW });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
  });
});

describe('buildDeadlineIcs —— 转义', () => {
  it('标题里的逗号 / 分号 / 反斜杠被转义', () => {
    const ics = buildDeadlineIcs([item({ title: '作业 3, 第四章; 附录\\A' })], {
      calendarName: 'x',
      now: NOW,
    });
    expect(ics).toContain('SUMMARY:作业 3\\, 第四章\\; 附录\\\\A');
  });

  it('描述里的换行转成字面量 \\n', () => {
    const ics = buildDeadlineIcs([item()], { calendarName: 'x', now: NOW });
    expect(ics).toContain('DESCRIPTION:课程：CS101\\n来源：Blackboard');
  });

  it('日历名也转义', () => {
    const ics = buildDeadlineIcs([], { calendarName: '我的, 日历', now: NOW });
    expect(ics).toContain('X-WR-CALNAME:我的\\, 日历');
  });
});

describe('buildDeadlineIcs —— 折行（75 字节）', () => {
  it('短行不折', () => {
    const ics = buildDeadlineIcs([item({ title: '短' })], { calendarName: 'x', now: NOW });
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it('⚠️ 超长中文标题按**字节**折行，且续行以空格开头', () => {
    const longTitle = '这是一个非常长的作业标题用来验证折行逻辑是否按字节而不是按字符来计算因为中文一个字占三个字节';
    const ics = buildDeadlineIcs([item({ title: longTitle })], { calendarName: 'x', now: NOW });
    const lines = ics.split('\r\n');
    for (const line of lines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // 折行后的续行以单个空格开头
    expect(lines.some((line) => line.startsWith(' ') && line.trim() !== '')).toBe(true);
  });

  it('折行不破坏内容（去掉折行标记后能还原）', () => {
    const longTitle = '很长很长的标题'.repeat(10);
    const ics = buildDeadlineIcs([item({ title: longTitle })], { calendarName: 'x', now: NOW });
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(longTitle);
  });
});

describe('looksLikeIcs', () => {
  it('同时有 BEGIN/END 才算', () => {
    expect(looksLikeIcs('BEGIN:VCALENDAR\nEND:VCALENDAR')).toBe(true);
    expect(looksLikeIcs('BEGIN:VCALENDAR')).toBe(false);
    expect(looksLikeIcs('随便一段文本')).toBe(false);
  });
});
