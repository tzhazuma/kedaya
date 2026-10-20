/**
 * `deadline-parse-html` 的测试。
 *
 * 这个模块是三个平台解析器的地基，所以测试覆盖到「单个原子操作」这一层：
 * 日期片段怎么切、时区怎么落、登录页怎么认。上面三个解析器的测试只断言
 * 「平台语义」，不重复这些边界 —— 否则一处改错要改四个文件。
 *
 * 所有用例都用固定时刻 `NOW`，任何 `Date.now()` 依赖都会让测试在别的日子变红。
 */

import { describe, expect, it } from 'vitest';

import {
  collectAnchors,
  deadlineParseFailure,
  findDateSpans,
  htmlText,
  inferYearForTerm,
  inspectPlatformPage,
  parseDateSpanToIso,
  pickDateSpanText,
  readJsStringLiterals,
  readSubmissionState,
  readTagAttribute,
  termYear,
} from './deadline-parse-html';

/** 2026-10-20 08:00 北京时间（学期中，Fall 2026） */
const NOW = new Date('2026-10-20T08:00:00+08:00');
const SHANGHAI = 'Asia/Shanghai';

const dateOptions = (term: string | null = null) => ({
  timeZone: SHANGHAI,
  now: NOW,
  term,
});

describe('htmlText', () => {
  it('折叠空白并解码实体', () => {
    expect(htmlText('<div>  Homework&nbsp;&amp;&nbsp;Lab  </div>')).toBe('Homework & Lab');
  });

  it('丢弃 script / style 内容', () => {
    expect(htmlText('<script>var x = "<div>不显示</div>";</script>DUE')).toBe('DUE');
    expect(htmlText('<style>.a{color:red}</style>正文')).toBe('正文');
  });

  it('纯文本原样返回（只折叠空白）', () => {
    expect(htmlText('  Oct 20   11:59 PM ')).toBe('Oct 20 11:59 PM');
  });

  it('空输入返回空串', () => {
    expect(htmlText('')).toBe('');
    expect(htmlText(undefined as unknown as string)).toBe('');
  });

  it('不把小于号当标签', () => {
    expect(htmlText('a < b and c > d')).toBe('a < b and c > d');
  });
});

describe('readTagAttribute', () => {
  it('读双引号 / 单引号 / 无引号属性', () => {
    expect(readTagAttribute('<a href="/x">', 'href')).toBe('/x');
    expect(readTagAttribute("<a href='/y'>", 'href')).toBe('/y');
    expect(readTagAttribute('<a href=/z>', 'href')).toBe('/z');
  });

  it('属性名大小写不敏感', () => {
    expect(readTagAttribute('<a HREF="/x">', 'href')).toBe('/x');
  });

  it('解码实体', () => {
    expect(readTagAttribute('<a href="?a=1&amp;b=2">', 'href')).toBe('?a=1&b=2');
    expect(readTagAttribute('<a href="?a=&#49;">', 'href')).toBe('?a=1');
  });

  it('缺失属性返回空串', () => {
    expect(readTagAttribute('<a href="/x">', 'class')).toBe('');
    expect(readTagAttribute('', 'href')).toBe('');
  });

  it('拒绝非法属性名（防正则注入）', () => {
    expect(readTagAttribute('<a href="/x">', '.*')).toBe('');
    expect(readTagAttribute('<a href="/x">', '')).toBe('');
  });

  it('引号里的 > 不结束标签', () => {
    expect(readTagAttribute('<a title="a>b" href="/x">', 'href')).toBe('/x');
  });
});

describe('collectAnchors', () => {
  const base = 'https://www.gradescope.com/courses/42';

  it('解析相对地址并保留文本与下标', () => {
    const links = collectAnchors('<p><a href="/courses/1">CS101</a></p>', base);
    expect(links).toHaveLength(1);
    expect(links[0]?.url).toBe('https://www.gradescope.com/courses/1');
    expect(links[0]?.text).toBe('CS101');
    expect(links[0]?.index).toBe(3);
  });

  it('解析 ../ 相对路径', () => {
    const links = collectAnchors('<a href="../assignments/7">HW1</a>', 'https://x.test/courses/42/');
    expect(links[0]?.url).toBe('https://x.test/courses/assignments/7');
  });

  it('丢弃非 https 与锚点链接', () => {
    const html = [
      '<a href="http://x.test/a">http</a>',
      '<a href="javascript:void(0)">js</a>',
      '<a href="mailto:a@b.c">mail</a>',
      '<a href="#top">top</a>',
      '<a href="">empty</a>',
      '<a href="https://x.test/ok">ok</a>',
    ].join('');
    expect(collectAnchors(html, 'https://x.test/').map((link) => link.text)).toEqual(['ok']);
  });

  it('没有闭合标签时取到文档末尾', () => {
    const links = collectAnchors('<a href="https://x.test/a">尾巴', 'https://x.test/');
    expect(links[0]?.text).toBe('尾巴');
  });

  it('base 非法时返回空数组而不是抛异常', () => {
    expect(collectAnchors('<a href="/a">a</a>', 'not a url')).toEqual([]);
  });

  it('空输入返回空数组', () => {
    expect(collectAnchors('', base)).toEqual([]);
  });
});

describe('findDateSpans', () => {
  it('识别机器时间并保留偏移', () => {
    const spans = findDateSpans('due 2026-10-20T23:59:00+08:00 end');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.text).toBe('2026-10-20T23:59:00+08:00');
    expect(spans[0]?.at).toBe(4);
  });

  it('识别中文全日期（含星期与时段）', () => {
    const spans = findDateSpans('截止：2026年10月20日 星期二 下午11:59，请按时提交');
    expect(spans[0]?.text).toBe('2026年10月20日 星期二 下午11:59');
  });

  it('识别英文月份（含 at 与 AM/PM）', () => {
    expect(findDateSpans('Oct 22 at 11:59PM').map((span) => span.text)).toEqual([
      'Oct 22 at 11:59PM',
    ]);
    expect(findDateSpans('October 22, 2026 11:59 PM').map((span) => span.text)).toEqual([
      'October 22, 2026 11:59 PM',
    ]);
  });

  it('识别纯日期与斜杠日期', () => {
    expect(findDateSpans('2026-10-20').map((span) => span.text)).toEqual(['2026-10-20']);
    expect(findDateSpans('2026/10/20').map((span) => span.text)).toEqual(['2026/10/20']);
  });

  it('中文短日期必须带时间才认', () => {
    expect(findDateSpans('10月20日 23:59')).toHaveLength(1);
    // 裸「9月1日」多半是学期信息，不当作截止
    expect(findDateSpans('9月1日开学')).toHaveLength(0);
  });

  it('同一位置被多条规则命中时保留最长的', () => {
    const spans = findDateSpans('2026-10-20 23:59');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.text).toBe('2026-10-20 23:59');
  });

  it('多个日期按出现顺序返回', () => {
    const spans = findDateSpans('Oct 13 at 8:00PM   Oct 22 at 11:59PM');
    expect(spans.map((span) => span.text)).toEqual(['Oct 13 at 8:00PM', 'Oct 22 at 11:59PM']);
  });

  it('没有日期返回空数组', () => {
    expect(findDateSpans('Due soon')).toEqual([]);
    expect(findDateSpans('')).toEqual([]);
  });
});

describe('pickDateSpanText', () => {
  it('first 取第一个日期', () => {
    expect(pickDateSpanText('截止日期 2026年10月20日 23:59 提交', 'first')).toBe(
      '2026年10月20日 23:59',
    );
  });

  it('last 取最后一个日期（Gradescope 的拼接单元格）', () => {
    const cell = '5 days, 14 seconds left  Oct 13 at 8:00PM  Oct 22 at 11:59PM';
    expect(pickDateSpanText(cell, 'last')).toBe('Oct 22 at 11:59PM');
  });

  it('认不出日期时退化成长度受限的原文', () => {
    const text = '暂时还没有公布具体的截止时间，请关注课程公告与课程邮件通知，或者直接询问课程的助教老师';
    const result = pickDateSpanText(text, 'first');
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBe(41);
    expect(text.startsWith(result.slice(0, -1))).toBe(true);
  });

  it('短文本认不出时原样返回', () => {
    expect(pickDateSpanText('TBD', 'first')).toBe('TBD');
  });

  it('输入是 HTML 时先取可见文本', () => {
    expect(pickDateSpanText('<span>Oct 22 at 11:59PM</span>', 'first')).toBe('Oct 22 at 11:59PM');
  });
});

describe('parseDateSpanToIso', () => {
  it('带偏移的机器时间直接换算', () => {
    expect(parseDateSpanToIso('2026-10-20T23:59:00+08:00', dateOptions())).toBe(
      '2026-10-20T15:59:00.000Z',
    );
    expect(parseDateSpanToIso('2026-10-20T15:59:00Z', dateOptions())).toBe(
      '2026-10-20T15:59:00.000Z',
    );
  });

  it('空格分隔偏移（Blackboard 形态）也认', () => {
    expect(parseDateSpanToIso('2026-10-20 23:59:00 +0800', dateOptions())).toBe(
      '2026-10-20T15:59:00.000Z',
    );
  });

  it('无偏移按学校时区解释，而不是运行环境时区', () => {
    expect(parseDateSpanToIso('2026-10-20 23:59', dateOptions())).toBe('2026-10-20T15:59:00.000Z');
  });

  it('中文「下午」转 24 小时制', () => {
    expect(parseDateSpanToIso('2026年10月20日 星期二 下午11:59', dateOptions())).toBe(
      '2026-10-20T15:59:00.000Z',
    );
  });

  it('中文「上午 12:30」归零', () => {
    expect(parseDateSpanToIso('2026年10月20日 上午12:30', dateOptions())).toBe(
      '2026-10-19T16:30:00.000Z',
    );
  });

  it('中文「晚上 8:00」按 20 点', () => {
    expect(parseDateSpanToIso('2026年10月20日 晚上8:00', dateOptions())).toBe(
      '2026-10-20T12:00:00.000Z',
    );
  });

  it('中文短日期用学期年份补全', () => {
    expect(parseDateSpanToIso('10月20日 23:59', dateOptions('Fall 2026'))).toBe(
      '2026-10-20T15:59:00.000Z',
    );
  });

  it('秋季学期跨年：1 月截止算下一年', () => {
    expect(parseDateSpanToIso('1月5日 23:59', dateOptions('Fall 2026'))).toBe(
      '2027-01-05T15:59:00.000Z',
    );
  });

  it('没有学期时按「最近一次」推断年份', () => {
    // NOW = 2026-10-20；3 月 1 日已经过去 → 顺延到 2027
    expect(parseDateSpanToIso('3月1日 09:00', dateOptions())).toBe('2027-03-01T01:00:00.000Z');
  });

  it('英文日期（带年份与 PM）', () => {
    expect(parseDateSpanToIso('Oct 22, 2026 11:59 PM', dateOptions())).toBe(
      '2026-10-22T15:59:00.000Z',
    );
  });

  it('英文日期缺年份时用学期年份', () => {
    expect(parseDateSpanToIso('Oct 22 at 11:59PM', dateOptions('Fall 2026'))).toBe(
      '2026-10-22T15:59:00.000Z',
    );
  });

  it('英文日期缺年份、缺学期时按最近一次推断', () => {
    expect(parseDateSpanToIso('Feb 1 at 09:00', dateOptions())).toBe('2027-02-01T01:00:00.000Z');
  });

  it('只有日期没有时间 → null（不猜午夜）', () => {
    expect(parseDateSpanToIso('2026-10-20', dateOptions())).toBeNull();
    expect(parseDateSpanToIso('Oct 20, 2026', dateOptions())).toBeNull();
    expect(parseDateSpanToIso('2026年10月20日 星期二', dateOptions())).toBeNull();
  });

  it('非法日期 → null', () => {
    expect(parseDateSpanToIso('2026-02-30 10:00', dateOptions())).toBeNull();
    expect(parseDateSpanToIso('2026-13-01 10:00', dateOptions())).toBeNull();
  });

  it('认不出的文本 → null', () => {
    expect(parseDateSpanToIso('TBD', dateOptions())).toBeNull();
    expect(parseDateSpanToIso('', dateOptions())).toBeNull();
  });

  it('全角空白与零宽字符会被清理', () => {
    expect(parseDateSpanToIso('2026-10-20\u300023:59\u200b', dateOptions())).toBe(
      '2026-10-20T15:59:00.000Z',
    );
  });
});

describe('termYear / inferYearForTerm', () => {
  it('从学期标签取年份', () => {
    expect(termYear('Fall 2026')).toBe(2026);
    expect(termYear('2026-fall')).toBe(2026);
    expect(termYear('2026-秋')).toBe(2026);
    expect(termYear(null)).toBeNull();
    expect(termYear('Fall')).toBeNull();
  });

  it('秋季学期把 1–3 月推到下一年', () => {
    expect(inferYearForTerm(2026, 10, 'Fall 2026')).toBe(2026);
    expect(inferYearForTerm(2026, 1, 'Fall 2026')).toBe(2027);
    expect(inferYearForTerm(2026, 3, '2026-autumn')).toBe(2027);
    expect(inferYearForTerm(2026, 4, 'Fall 2026')).toBe(2026);
    expect(inferYearForTerm(2026, 1, 'Spring 2026')).toBe(2026);
  });
});

describe('inspectPlatformPage', () => {
  const ok = { html: '<div>课程</div>', url: 'https://www.gradescope.com/account' };

  it('正常页面返回 null', () => {
    expect(inspectPlatformPage(ok)).toBeNull();
  });

  it('密码框 → 登录已过期（优先于结构判断）', () => {
    expect(
      inspectPlatformPage({ html: '<input type="password" name="p">', url: 'https://x.test/anything' }),
    ).toEqual(deadlineParseFailure('login-required', '登录已过期，请重新登录后再采集'));
  });

  it('被重定向到登录路径 → 登录已过期', () => {
    const failure = inspectPlatformPage({
      html: '<div>登录</div>',
      url: 'https://x.test/authserver/login?service=a',
    });
    expect(failure?.code).toBe('login-required');
  });

  it('非 200 → http-error', () => {
    expect(inspectPlatformPage({ ...ok, status: 500 })?.code).toBe('http-error');
  });

  it('空页面 → empty-page', () => {
    expect(inspectPlatformPage({ ...ok, html: '   ' })?.code).toBe('empty-page');
  });

  it('非法 URL → invalid-url', () => {
    expect(inspectPlatformPage({ ...ok, url: 'nope' })?.code).toBe('invalid-url');
  });
});

describe('readSubmissionState', () => {
  it('未提交优先', () => {
    expect(readSubmissionState('Not submitted')).toBe('not_submitted');
    expect(readSubmissionState('尚未提交 · 提交记录')).toBe('not_submitted');
  });

  it('有分数算已批改', () => {
    expect(readSubmissionState('graded')).toBe('graded');
    expect(readSubmissionState('85 / 100')).toBe('graded');
  });

  it('已提交', () => {
    expect(readSubmissionState('Submitted')).toBe('submitted');
    expect(readSubmissionState('已提交')).toBe('submitted');
  });

  it('读不到是 unknown，不是「未提交」', () => {
    expect(readSubmissionState('')).toBe('unknown');
    expect(readSubmissionState('Assignment 1')).toBe('unknown');
  });
});

describe('readJsStringLiterals', () => {
  it('按顺序读单双引号字面量', () => {
    expect(readJsStringLiterals(`"a", 'b', "c"`)).toEqual(['a', 'b', 'c']);
  });

  it('处理常见转义', () => {
    expect(readJsStringLiterals(`"a\\nb"`)).toEqual(['a\nb']);
    expect(readJsStringLiterals(`"say \\"hi\\""`)).toEqual(['say "hi"']);
    expect(readJsStringLiterals(`"\\u4e2d\\u6587"`)).toEqual(['中文']);
    expect(readJsStringLiterals(`"\\x41"`)).toEqual(['A']);
  });

  it('忽略未闭合字符串', () => {
    expect(readJsStringLiterals(`"a", "b`)).toEqual(['a']);
  });

  it('忽略模板字符串（可能含表达式）', () => {
    expect(readJsStringLiterals('`a${b}` , "c"')).toEqual(['c']);
  });

  it('空输入返回空数组', () => {
    expect(readJsStringLiterals('')).toEqual([]);
  });
});
