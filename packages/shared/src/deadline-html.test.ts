import { describe, expect, it } from 'vitest';

import {
  decodeHtmlEntities,
  extractDeadlineBlock,
  htmlToLines,
  looksLikeHtml,
} from './deadline-html';

/**
 * HTML 预处理层。
 *
 * 这层的职责只有一个：把用户剪贴板里的 HTML **压成保留结构的文本行**，
 * 好让 `deadline-paste` 的解析器能吃掉它。
 *
 * 测试重心在「**降级不崩**」：用户贴进来的 HTML 什么形状都可能有，
 * 一个未闭合的 `<div>` 不该让整个粘贴流程挂掉。
 */

describe('decodeHtmlEntities', () => {
  it('命名实体全解码', () => {
    expect(decodeHtmlEntities('a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;')).toBe(
      'a & b < c > d "e" \'f\'',
    );
  });

  it('&nbsp; 变普通空格', () => {
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a b');
  });

  it('数字实体（十进制与十六进制）', () => {
    expect(decodeHtmlEntities('&#20013;&#25991;')).toBe('中文');
    expect(decodeHtmlEntities('&#x4E2D;&#x6587;')).toBe('中文');
  });

  it('未知实体原样保留，不吞字符', () => {
    expect(decodeHtmlEntities('&notarealentity;')).toBe('&notarealentity;');
  });

  it('裸 & 不动', () => {
    expect(decodeHtmlEntities('a & b')).toBe('a & b');
  });
});

describe('looksLikeHtml —— 保守判据', () => {
  it('结构标签 → true', () => {
    for (const html of [
      '<html><body>x</body></html>',
      '<div class="a">x</div>',
      '<table><tr><td>x</td></tr></table>',
      '<body>x</body>',
    ]) {
      expect(looksLikeHtml(html), html).toBe(true);
    }
  });

  it('⚠️ 颜文字 <3 不算 HTML', () => {
    expect(looksLikeHtml('i <3 u')).toBe(false);
  });

  it('⚠️ 纯文本里的数学比较不算 HTML', () => {
    expect(looksLikeHtml('a < b and c > d')).toBe(false);
  });

  it('纯文本 → false', () => {
    expect(looksLikeHtml('Homework 1  Due Oct 20, 2026 11:59 PM')).toBe(false);
  });
});

describe('htmlToLines', () => {
  it('块级标签变行，行内标签不换行', () => {
    const lines = htmlToLines('<div>第一行</div><div>第二行</div>');
    expect(lines).toEqual(['第一行', '第二行']);
  });

  it('<br> 变换行', () => {
    expect(htmlToLines('a<br>b<br/>c')).toEqual(['a', 'b', 'c']);
  });

  it('⚠️ 表格单元格同行分隔（Blackboard 的「一行三门课」）', () => {
    const lines = htmlToLines('<table><tr><td>作业1</td><td>10月20日</td><td>已提交</td></tr></table>');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('作业1');
    expect(lines[0]).toContain('10月20日');
    expect(lines[0]).toContain('已提交');
  });

  it('⚠️ <script> / <style> 的**内容**被丢弃，标签外的文字保留', () => {
    const lines = htmlToLines(
      '<div>保留</div><script>var x = "不该出现";</script><style>.a{color:red}</style><div>也保留</div>',
    );
    const joined = lines.join('\n');
    expect(joined).toContain('保留');
    expect(joined).toContain('也保留');
    expect(joined).not.toContain('不该出现');
    expect(joined).not.toContain('color:red');
  });

  it('中文平台的嵌套 div', () => {
    const lines = htmlToLines(
      '<div class="item"><div class="t">作业一</div><div class="d">截止时间：2026年10月20日 23:59</div></div>',
    );
    expect(lines.join('\n')).toContain('作业一');
    expect(lines.join('\n')).toContain('2026年10月20日 23:59');
  });

  it('⚠️ 畸形 HTML 不抛异常', () => {
    for (const bad of [
      '<div>没有闭合',
      '<div><span>交叉</div></span>',
      '孤立 < 符号',
      '<div class="x"',
      '',
    ]) {
      expect(() => htmlToLines(bad)).not.toThrow();
    }
  });

  it('实体在转行时已被解码', () => {
    expect(htmlToLines('<div>a &amp; b</div>')).toEqual(['a & b']);
  });

  it('空 HTML → 空数组', () => {
    expect(htmlToLines('')).toEqual([]);
  });
});

describe('extractDeadlineBlock', () => {
  it('按提示选择器切出区块，丢掉导航与页脚', () => {
    const html = `
      <nav>导航不该出现</nav>
      <div id="assignments"><div>Homework 1</div></div>
      <footer>页脚不该出现</footer>`;
    const block = extractDeadlineBlock(html, ['#assignments']);
    expect(block).toContain('Homework 1');
    expect(block).not.toContain('导航不该出现');
  });

  it('⚠️ 找不到提示区域时**退化成整页**，不返回空', () => {
    const html = '<main><div>Homework 9</div></main>';
    const block = extractDeadlineBlock(html, ['#not-there']);
    expect(block).toContain('Homework 9');
  });

  it('不传 hints 也不崩', () => {
    expect(() => extractDeadlineBlock('<div>x</div>')).not.toThrow();
  });
});
