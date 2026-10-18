import { describe, expect, it } from 'vitest';

import {
  parsePastedDeadlines,
  type DeadlineItem,
  type PasteParseOptions,
  type PasteParseResult,
} from './deadline-paste';

/**
 * DDL 粘贴解析测试。
 *
 * 重心：
 *   1. **五种真实复制形态**各至少一条（BB / Gradescope / Piazza / 中文平台 / 随手记）；
 *   2. **解析不了的行必须进 `unparsed`**（含只有日期没时间、只有时间没日期、页眉/@/闲聊）；
 *   3. **幂等** —— 同一文本 + 同一 options 两次结果完全一致，id 是确定性哈希；
 *   4. **日期只走 `parseDueText`** —— 时区是显式参数，中文无年份按「最近一次」推断；
 *   5. **跨行标题** —— 标题一行、日期一行（中间夹分数也能接上）。
 */

const NOW = new Date('2026-10-19T00:00:00.000Z'); // 上海 2026-10-19（周一）08:00
const SHANGHAI = 'Asia/Shanghai';

function parse(
  text: string,
  overrides: Partial<PasteParseOptions> = {},
): PasteParseResult {
  return parsePastedDeadlines(text, {
    source: 'blackboard',
    timeZone: SHANGHAI,
    now: NOW,
    ...overrides,
  });
}

function firstItem(result: PasteParseResult): DeadlineItem {
  const item = result.items[0];
  if (item === undefined) throw new Error('期望至少解析出一条 item');
  return item;
}

function reasons(result: PasteParseResult): string {
  return result.unparsed.map((entry) => entry.reason).join('\n');
}

/* ------------------------------------------------------------------ *
 * 形态 1：Blackboard
 * ------------------------------------------------------------------ */

describe('Blackboard 多行列表', () => {
  const TEXT = [
    'Homework 1  Due Oct 20, 2026 11:59 PM  10 pts',
    'Homework 2  Due Oct 27, 2026 11:59 PM  20 pts',
  ].join('\n');

  it('按行解析出标题 / 截止时刻 / 原文，并保持输入顺序', () => {
    const result = parse(TEXT);

    expect(result.items).toHaveLength(2);
    expect(result.unparsed).toEqual([]);

    const [first, second] = result.items;
    expect(first?.title).toBe('Homework 1');
    expect(first?.dueAt).toBe('2026-10-20T15:59:00.000Z');
    expect(first?.dueAtRaw).toBe('Oct 20, 2026 11:59 PM');
    expect(first?.source).toBe('blackboard');
    expect(first?.submitted).toBe(false);

    expect(second?.title).toBe('Homework 2');
    expect(second?.dueAt).toBe('2026-10-27T15:59:00.000Z');
    expect(result.items.map((item) => item.title)).toEqual(['Homework 1', 'Homework 2']);
  });

  it('⚠️ 10 pts 是分数不是总评占比：识别并剔除，但 weight 保持 null', () => {
    const result = parse(TEXT);

    expect(result.items.every((item) => item.weight === null)).toBe(true);
    expect(result.warnings.join('\n')).toContain('分数');
    expect(result.warnings.join('\n')).toContain('weight');
  });
});

/* ------------------------------------------------------------------ *
 * 形态 2：Gradescope
 * ------------------------------------------------------------------ */

describe('Gradescope 的 Due Date + 提交状态', () => {
  const TEXT = [
    'PA1  Due Date: Oct 25, 2026 11:59 PM  Submitted',
    'Problem Set 2  Due Date: Nov 1, 2026 11:59 PM  Not submitted',
  ].join('\n');

  it('识别标题、Due Date、Submitted / Not submitted', () => {
    const result = parse(TEXT);

    expect(result.unparsed).toEqual([]);
    expect(result.items.map((item) => item.title)).toEqual(['PA1', 'Problem Set 2']);
    expect(result.items.map((item) => item.submitted)).toEqual([true, false]);
    expect(firstItem(result).dueAt).toBe('2026-10-25T15:59:00.000Z');
    expect(firstItem(result).kind).toBe('assignment');
  });
});

/* ------------------------------------------------------------------ *
 * 形态 3：Piazza（缩进 + @ 提及 + 跨行标题）
 * ------------------------------------------------------------------ */

describe('Piazza 带缩进和 @ 提及的碎文本', () => {
  const TEXT = [
    '  @John Doe',
    '  Homework 3 · CS101',
    '    Due Oct 30, 2026 11:59 PM',
    '  @Jane Smith',
    '  Does anyone know if we need to submit the PDF?',
  ].join('\n');

  it('把下一行的日期接到上一行标题上', () => {
    const result = parse(TEXT, { source: 'piazza' });

    expect(result.items).toHaveLength(1);
    expect(firstItem(result).title).toBe('Homework 3 · CS101');
    expect(firstItem(result).dueAt).toBe('2026-10-30T15:59:00.000Z');
    expect(firstItem(result).dueAtRaw).toBe('Oct 30, 2026 11:59 PM');
  });

  it('@ 提及与闲聊不静默丢弃，全部进 unparsed', () => {
    const result = parse(TEXT, { source: 'piazza' });

    expect(result.unparsed.map((entry) => entry.line)).toEqual([
      '@John Doe',
      '@Jane Smith',
      'Does anyone know if we need to submit the PDF?',
    ]);
    expect(result.unparsed[0]?.reason).toContain('提及');
    expect(reasons(result)).toContain('截止时间');
    expect(result.warnings.join('\n')).toContain('3 行未解析');
  });
});

/* ------------------------------------------------------------------ *
 * 形态 4：中文平台（ecourse / 泛雅）
 * ------------------------------------------------------------------ */

describe('中文平台 · 截止时间 + 提交状态 + 占比', () => {
  const TEXT = [
    '作业一  截止时间：2026年10月20日 23:59  未提交',
    '作业二  截止时间：2026年11月3日 23:59  已提交  占 10%',
  ].join('\n');

  it('解析中文日期、全角冒号、已/未提交', () => {
    const result = parse(TEXT, { source: 'ecourse' });

    expect(result.unparsed).toEqual([]);
    expect(result.items.map((item) => item.title)).toEqual(['作业一', '作业二']);
    expect(result.items.map((item) => item.submitted)).toEqual([false, true]);
    expect(result.items.map((item) => item.dueAt)).toEqual([
      '2026-10-20T15:59:00.000Z',
      '2026-11-03T15:59:00.000Z',
    ]);
    expect(result.items.map((item) => item.dueAtRaw)).toEqual([
      '2026年10月20日 23:59',
      '2026年11月3日 23:59',
    ]);
  });

  it('占 10% 写入 weight，并从标题中剔除', () => {
    const result = parse(TEXT, { source: 'ecourse' });

    expect(result.items.map((item) => item.weight)).toEqual([null, 10]);
    expect(result.items.every((item) => !item.title.includes('10%'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 形态 5：纯文本随手记
 * ------------------------------------------------------------------ */

describe('纯文本随手记 · 中文相对星期', () => {
  it('下周三 23:59 按时区换算成绝对时刻', () => {
    const result = parse('CS101 作业2 下周三 23:59');

    expect(result.unparsed).toEqual([]);
    expect(firstItem(result).title).toBe('CS101 作业2');
    // 上海 2026-10-19 是周一，下周三 = 10-28
    expect(firstItem(result).dueAt).toBe('2026-10-28T15:59:00.000Z');
    expect(firstItem(result).dueAtRaw).toBe('下周三 23:59');
  });

  it('明天 / 本周五 / 今天 都按自然日推', () => {
    const tomorrow = parse('实验报告 明天 09:00');
    const thisFriday = parse('小测 本周五 23:59');
    const today = parse('随堂测 今天 18:00');

    expect(firstItem(tomorrow).dueAt).toBe('2026-10-20T01:00:00.000Z');
    expect(firstItem(thisFriday).dueAt).toBe('2026-10-23T15:59:00.000Z');
    expect(firstItem(today).dueAt).toBe('2026-10-19T10:00:00.000Z');
    expect(firstItem(thisFriday).kind).toBe('quiz');
  });

  it('裸「周五」取从今天起最近的周五；已过则顺延到下周', () => {
    expect(firstItem(parse('作业 周五 23:59')).dueAt).toBe('2026-10-23T15:59:00.000Z');

    // 2026-10-24 是周六，最近的周五已过 → 10-30
    const saturday = new Date('2026-10-24T00:00:00.000Z');
    expect(firstItem(parse('作业 周五 23:59', { now: saturday })).dueAt).toBe(
      '2026-10-30T15:59:00.000Z',
    );
  });
});

/* ------------------------------------------------------------------ *
 * unparsed：解析不了的行必须回显
 * ------------------------------------------------------------------ */

describe('unparsed · 解析不了的行原样回显', () => {
  it('没有日期的行进 unparsed，不会被丢弃', () => {
    const result = parse(['CS101 作业2 下周三 23:59', '老师会在课上通知'].join('\n'));

    expect(result.items).toHaveLength(1);
    expect(result.unparsed).toHaveLength(1);
    expect(result.unparsed[0]?.line).toBe('老师会在课上通知');
    expect(result.unparsed[0]?.reason).toContain('未找到可识别的截止时间');
  });

  it('只有日期没有时间：不猜具体几点，进 unparsed', () => {
    const result = parse('Essay  Due Oct 20, 2026');

    expect(result.items).toEqual([]);
    expect(result.unparsed).toHaveLength(1);
    expect(result.unparsed[0]?.line).toBe('Essay  Due Oct 20, 2026');
    expect(result.unparsed[0]?.reason).toContain('缺少具体时刻');
    expect(result.warnings.join('\n')).toContain('未解析');
  });

  it('只有时间没有日期：进 unparsed 并指出缺年月日', () => {
    const result = parse('Homework 5  23:59');

    expect(result.items).toEqual([]);
    expect(result.unparsed[0]?.reason).toContain('只找到时间');
  });

  it('非法日期（2026-02-30）不静默进位，进 unparsed', () => {
    const result = parse('Homework 6  Due 2026-02-30 23:59');

    expect(result.items).toEqual([]);
    expect(result.unparsed[0]?.reason).toContain('无法解析');
  });

  it('每个非空行要么成为 item、要么出现在 unparsed（不静默丢弃）', () => {
    const text = ['Assignments', 'Homework 1  Due Oct 20, 2026 11:59 PM', 'TBD'].join('\n');
    const result = parse(text);

    const covered = new Set<string>(result.items.map((item) => item.title));
    for (const line of ['Assignments', 'TBD']) {
      expect(result.unparsed.map((entry) => entry.line)).toContain(line);
      covered.add(line);
    }
    expect(covered.size).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * 幂等
 * ------------------------------------------------------------------ */

describe('幂等 · 同一文本两次解析结果完全一致', () => {
  const TEXT = [
    'Homework 1  Due Oct 20, 2026 11:59 PM  10 pts',
    'PA2  Due Date: Oct 25, 2026 11:59 PM  Submitted',
    '作业三  截止时间：2026年10月21日 23:59  未提交',
  ].join('\n');

  it('深比较完全相等', () => {
    const first = parse(TEXT, { source: 'gradescope', courseName: 'CS101' });
    const second = parse(TEXT, { source: 'gradescope', courseName: 'CS101' });

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('id 是确定性哈希（不含随机数 / 自增序号）', () => {
    const first = parse(TEXT, { source: 'gradescope', courseName: 'CS101' });
    const second = parse(TEXT, { source: 'gradescope', courseName: 'CS101' });

    for (const item of first.items) {
      expect(item.id).toMatch(/^ddl-paste-[0-9a-f]{16}$/);
    }
    expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
  });

  it('来源参与 id：同一文本从不同来源粘贴，id 不同', () => {
    const blackboard = parse(TEXT, { source: 'blackboard' });
    const piazza = parse(TEXT, { source: 'piazza' });

    expect(blackboard.items[0]?.id).not.toBe(piazza.items[0]?.id);
  });

  it('完全重复的行按同一 id 合并，并给出 warning', () => {
    const text = [
      'Homework 1  Due Oct 20, 2026 11:59 PM',
      'Homework 1  Due Oct 20, 2026 11:59 PM',
    ].join('\n');
    const result = parse(text);

    expect(result.items).toHaveLength(1);
    expect(result.warnings.join('\n')).toContain('重复');
  });
});

/* ------------------------------------------------------------------ *
 * 日期边界
 * ------------------------------------------------------------------ */

describe('日期 · 中文与无年份', () => {
  it('中文无年份：取从现在起最近的一次', () => {
    expect(firstItem(parse('作业三 截止时间：10月20日 23:59')).dueAt).toBe(
      '2026-10-20T15:59:00.000Z',
    );

    const december = new Date('2026-12-01T00:00:00.000Z');
    expect(
      firstItem(parse('作业三 截止时间：10月20日 23:59', { now: december })).dueAt,
    ).toBe('2027-10-20T15:59:00.000Z');
  });

  it('英文无年份：Oct 20 11:59 PM', () => {
    const result = parse('Reading 1  Oct 20 11:59 PM');

    expect(firstItem(result).dueAt).toBe('2026-10-20T15:59:00.000Z');
    expect(firstItem(result).dueAtRaw).toBe('Oct 20 11:59 PM');
    expect(firstItem(result).kind).toBe('reading');
  });

  it('平台倒计时式的相对时间：in 3 days / 3 天后截止', () => {
    expect(firstItem(parse('Essay  Due in 3 days')).dueAt).toBe('2026-10-22T00:00:00.000Z');
    expect(firstItem(parse('作业三 3 天后截止')).dueAt).toBe('2026-10-22T00:00:00.000Z');
  });

  it('中文「号」写法也能解析', () => {
    expect(firstItem(parse('作业三 截止时间：10月20号 23:59')).dueAt).toBe(
      '2026-10-20T15:59:00.000Z',
    );
  });

  it('过去的年份不被吞掉（Oct 20, 1999）', () => {
    expect(firstItem(parse('Homework  Due Oct 20, 1999 11:59 PM')).dueAt).toBe(
      '1999-10-20T15:59:00.000Z',
    );
  });

  it('⚠️ 时区是显式参数：上海与 UTC 下同一文本结果不同', () => {
    const text = 'Homework 1  Due Oct 20, 2026 11:59 PM';

    expect(firstItem(parse(text)).dueAt).toBe('2026-10-20T15:59:00.000Z');
    expect(firstItem(parse(text, { timeZone: 'UTC' })).dueAt).toBe(
      '2026-10-20T23:59:00.000Z',
    );
  });

  it('同一行有 Posted 和 Due 两个日期时优先取 Due 后面的', () => {
    const result = parse('Homework 1  Posted Oct 1, 2026 9:00 AM  Due Oct 20, 2026 11:59 PM');

    expect(firstItem(result).dueAt).toBe('2026-10-20T15:59:00.000Z');
    expect(firstItem(result).dueAtRaw).toBe('Oct 20, 2026 11:59 PM');
  });
});

/* ------------------------------------------------------------------ *
 * 跨行标题
 * ------------------------------------------------------------------ */

describe('跨行标题', () => {
  it('标题一行、日期下一行', () => {
    const result = parse(['Problem Set 4', 'Due Nov 5, 2026 11:59 PM'].join('\n'));

    expect(result.unparsed).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(firstItem(result).title).toBe('Problem Set 4');
    expect(firstItem(result).dueAt).toBe('2026-11-05T15:59:00.000Z');
  });

  it('标题与日期之间夹一行分数，也能接上', () => {
    const result = parse(['Lab Report 2', '100 pts', 'Due Nov 6, 2026 11:59 PM'].join('\n'));

    expect(result.items).toHaveLength(1);
    expect(firstItem(result).title).toBe('Lab Report 2');
    expect(result.unparsed).toEqual([]);
  });

  it('日期行在前、标题在后时，从日期另一侧切标题', () => {
    const result = parse('Due Nov 5, 2026 11:59 PM — Problem Set 4');

    expect(firstItem(result).title).toBe('Problem Set 4');
    expect(firstItem(result).dueAt).toBe('2026-11-05T15:59:00.000Z');
  });

  it('页眉（Assignments）不会被当成标题挪用', () => {
    const result = parse(['Assignments', 'Due Nov 5, 2026 11:59 PM'].join('\n'));

    // 日期行没有可用标题 → 用整行原文兜底 + warning；页眉仍在 unparsed
    expect(result.items).toHaveLength(1);
    expect(firstItem(result).title).toContain('Due Nov 5, 2026');
    expect(result.unparsed.map((entry) => entry.line)).toContain('Assignments');
    expect(result.warnings.join('\n')).toContain('未识别出标题');
  });
});

/* ------------------------------------------------------------------ *
 * 其它字段
 * ------------------------------------------------------------------ */

describe('其它字段', () => {
  it('课程名可选：填了进 courseId/courseName，没填给 warning', () => {
    const text = 'Homework 1  Due Oct 20, 2026 11:59 PM';

    const withCourse = parse(text, { courseName: '  CS101  ' });
    expect(firstItem(withCourse).courseName).toBe('CS101');
    expect(firstItem(withCourse).courseId).toBe('pasted:CS101');

    const withoutCourse = parse(text);
    expect(firstItem(withoutCourse).courseName).toBe('');
    expect(firstItem(withoutCourse).courseId).toBe('pasted:unspecified');
    expect(withoutCourse.warnings.join('\n')).toContain('未填写课程名');
  });

  it('回源链接：原文带 URL 就取，不编平台地址', () => {
    const result = parse(
      'Homework 1  Due Oct 20, 2026 11:59 PM  https://bb.example.edu/webapps/assignment?id=1',
    );

    expect(firstItem(result).sourceUrl).toBe(
      'https://bb.example.edu/webapps/assignment?id=1',
    );
    expect(firstItem(result).title).toBe('Homework 1');
  });

  it('种类只按标题关键词推断（仅展示）', () => {
    expect(firstItem(parse('Final Project  Due Oct 20, 2026 11:59 PM')).kind).toBe('project');
    expect(firstItem(parse('Midterm Exam  Due Oct 20, 2026 11:59 PM')).kind).toBe('exam');
    expect(firstItem(parse('Quiz 3  Due Oct 20, 2026 11:59 PM')).kind).toBe('quiz');
  });

  it('占比超出 0–100 不夹逼，不写入 weight 并 warning', () => {
    const result = parse('Homework 1  Due Oct 20, 2026 11:59 PM  占 150%');

    expect(firstItem(result).weight).toBeNull();
    expect(result.warnings.join('\n')).toContain('0–100');
  });

  it('空文本返回空结果 + 提示', () => {
    const result = parse('   \n  \n');

    expect(result.items).toEqual([]);
    expect(result.unparsed).toEqual([]);
    expect(result.warnings.join('\n')).toContain('为空');
  });

  it('非法 options 抛 RangeError（配置错误不静默回退）', () => {
    const text = 'Homework 1  Due Oct 20, 2026 11:59 PM';

    expect(() => parse(text, { timeZone: '' })).toThrow(RangeError);
    expect(() => parse(text, { timeZone: 'Mars/Olympus' })).toThrow(RangeError);
    expect(() => parse(text, { now: new Date(Number.NaN) })).toThrow(RangeError);
  });
});
