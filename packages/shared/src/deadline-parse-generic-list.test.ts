import { describe, expect, it } from 'vitest';

import {
  parseAssignmentList,
  parseEcourseAssignments,
  parsePiazzaDeadlines,
} from './deadline-parse-generic-list';

/**
 * 通用作业列表解析（给 piazza / ecourse）。
 *
 * ## 这组测试锁的是什么
 *
 * 1. **三种形状都要能切出「标题 + 日期」** —— 表格行 / 定义列表 / 卡片块
 * 2. **只切分，不解释** —— `dueText` 必须保持页面原样，绝对时刻交给
 *    `parseDueText`。这里绝不能自己猜一个 Date 出来
 * 3. **「扫了很多但只切出几条」要说出来** —— `scannedWithoutMatch` 大于
 *    candidates 时说明假设可能不符，用户该知道「可能漏了」
 * 4. **表头不算作业** —— 否则每张表都会多出一条叫「标题」的假作业
 */
const URL_BASE = 'https://example.edu/courses/1/assignments';

function page(body: string): string {
  return `<!DOCTYPE html><html><head><title>作业</title></head><body>${body}</body></html>`;
}

describe('形状 1：表格行', () => {
  it('作业名 + 中文日期在同一行 → 切出来', () => {
    const html = page(`
      <table>
        <tr><th>作业名称</th><th>截止日期</th></tr>
        <tr><td>第三次编程作业</td><td>2026年10月25日 23:59 截止</td></tr>
      </table>
    `);
    const result = parseAssignmentList(html, URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.candidates).toHaveLength(1);
    expect(result.value.candidates[0]?.title).toBe('第三次编程作业');
    expect(result.value.candidates[0]?.dueText).toContain('2026年10月25日');
    expect(result.value.candidates[0]?.shape).toBe('table-row');
  });

  it('英文日期也能切', () => {
    const html = page(`
      <table>
        <tr><td>Problem Set 4</td><td>Oct 25, 2026 11:59 PM</td></tr>
      </table>
    `);
    const result = parseAssignmentList(html, URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.candidates[0]?.title).toBe('Problem Set 4');
    expect(result.value.candidates[0]?.dueText).toContain('Oct 25');
  });
});

describe('⚠️ 表头不算作业', () => {
  it('「作业名称 / 截止日期」这一行被排除', () => {
    const html = page(`
      <table>
        <tr><th>作业名称</th><th>截止日期</th></tr>
        <tr><td>作业一</td><td>10月25日</td></tr>
      </table>
    `);
    const result = parseAssignmentList(html, URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // 只有「作业一」，没有把表头当成一条
    expect(result.value.candidates).toHaveLength(1);
    expect(result.value.candidates.map((c) => c.title)).toEqual(['作业一']);
  });

  it('纯英文表头同样被排除', () => {
    const html = page(`
      <table>
        <tr><td>Title</td><td>Due Date</td></tr>
        <tr><td>Homework 1</td><td>2026-10-25</td></tr>
      </table>
    `);
    const result = parseAssignmentList(html, URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.candidates.map((c) => c.title)).toEqual(['Homework 1']);
  });
});

describe('形状 2：定义列表', () => {
  it('dt 标题 + dd 日期', () => {
    const html = page(`
      <dl>
        <dt>期中报告</dt>
        <dd>提交截止：2026年11月10日 12:00</dd>
      </dl>
    `);
    const result = parseAssignmentList(html, URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const found = result.value.candidates.find((c) => c.title.includes('期中报告'));
    expect(found).toBeDefined();
    expect(found?.dueText).toContain('2026年11月10日');
  });
});

describe('形状 3：卡片块', () => {
  it('带 assignment class 的块被扫到', () => {
    const html = page(`
      <div class="assignment-card">
        <h3>小组项目提案</h3>
        <span>截止 2026年12月1日</span>
      </div>
    `);
    const result = parseAssignmentList(html, URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const found = result.value.candidates.find((c) => c.title.includes('小组项目提案'));
    expect(found).toBeDefined();
    expect(found?.shape).toBe('card');
  });

  it('Piazza 风格的 resource 块', () => {
    const html = page(`
      <div class="resource-item">
        <div>Reading response 2</div>
        <div>Due: Oct 30, 2026</div>
      </div>
    `);
    const result = parseAssignmentList(html, URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.candidates.some((c) => c.title.includes('Reading response 2'))).toBe(true);
  });
});

describe('⚠️ 只切分，不解释', () => {
  it('dueText 保持页面原样，不产出 Date / 绝对时刻', () => {
    const html = page(`
      <table><tr><td>作业 A</td><td>2026年10月25日 23:59</td></tr></table>
    `);
    const result = parseAssignmentList(html, URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const candidate = result.value.candidates[0]!;
    // 类型上就没有 Date 字段；值上是原文
    expect(typeof candidate.dueText).toBe('string');
    expect(candidate.dueText).toContain('2026年10月25日');
    // 不该有 dueAt 这种字段
    expect(Object.keys(candidate)).not.toContain('dueAt');
  });
});

describe('⚠️ 「扫了很多但只切出几条」要说出来', () => {
  it('scannedWithoutMatch 反映被扫过的区块数', () => {
    const html = page(`
      <table>
        <tr><td>有日期的一行</td><td>10月25日</td></tr>
        <tr><td>没有日期的一行</td><td>待定</td></tr>
        <tr><td>也没有日期</td><td>-</td></tr>
      </table>
    `);
    const result = parseAssignmentList(html, URL_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.candidates).toHaveLength(1);
    // 扫了 3 行，只切出 1 条 → 说明有 2 条我们读不出来
    expect(result.value.scannedWithoutMatch).toBeGreaterThan(0);
  });
});

describe('失败路径要能照着做', () => {
  it('空页面 → empty-page', () => {
    const result = parseAssignmentList('', URL_BASE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('empty-page');
  });

  it('不是 HTML → unrecognized-structure 且提示「另存为网页」', () => {
    const result = parseAssignmentList('这不是网页，只是一段文字', URL_BASE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('unrecognized-structure');
    expect(result.error.message).toContain('另存为');
  });

  it('有内容但没有日期 → 提示「扫了 N 个区块」', () => {
    const html = page(`
      <table>
        <tr><td>作业一</td><td>待定</td></tr>
        <tr><td>作业二</td><td>待定</td></tr>
        <tr><td>作业三</td><td>待定</td></tr>
      </table>
    `);
    const result = parseAssignmentList(html, URL_BASE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.message).toContain('扫了');
  });
});

describe('平台专用入口给更具体的下一步', () => {
  it('Piazza 失败时提示看 Instructor Note', () => {
    const result = parsePiazzaDeadlines(page('<p>课程首页，没有日期</p>'), URL_BASE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.message).toContain('Instructor Note');
  });

  it('e云平台失败时提示进课程内的作业列表', () => {
    const result = parseEcourseAssignments(page('<p>课程首页，没有日期</p>'), URL_BASE);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.message).toContain('作业');
  });

  it('成功时两个入口都直接透传通用解析结果', () => {
    const html = page(`<table><tr><td>作业 X</td><td>10月25日</td></tr></table>`);
    const piazza = parsePiazzaDeadlines(html, URL_BASE);
    const ecourse = parseEcourseAssignments(html, URL_BASE);
    expect(piazza.ok && ecourse.ok).toBe(true);
    if (!piazza.ok || !ecourse.ok) throw new Error('unreachable');
    expect(piazza.value.candidates).toEqual(ecourse.value.candidates);
  });
});
