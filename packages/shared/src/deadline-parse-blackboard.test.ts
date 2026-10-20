/**
 * `deadline-parse-blackboard` 的测试。
 *
 * 三个必须锁住的行为（每条都对应一个真实误解）：
 * 1. 「未完成课程列表」「待完成作业」是**模块标题**，不是全文关键字 ——
 *    模块排序控件、总课程列表里也有同名字样，按标题切区块才拿得到本学期数据；
 * 2. 「没有课 / 模块在加载 / 结构不认识」是三种不同状态，只有第一种能变成空数组；
 * 3. 目录页也会出现「提交作业」，URL 不带 `content_id` 的页面必须返回 `null`，
 *    不能凭空造一条作业。
 */

import { describe, expect, it } from 'vitest';

import {
  findBlackboardModule,
  parseBlackboardAssignmentPage,
  parseBlackboardCourseLinks,
  parseBlackboardCurrentCourses,
  parseBlackboardPendingAssignments,
  type BlackboardCourse,
} from './deadline-parse-blackboard';

const NOW = new Date('2026-10-20T08:00:00+08:00');
const SHANGHAI = 'Asia/Shanghai';
const BASE = 'https://elearning.shanghaitech.edu.cn:8443/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1';

const course: BlackboardCourse = {
  id: 'blackboard:_1_1',
  nativeId: '_1_1',
  title: 'CS101 程序设计',
  url: 'https://elearning.shanghaitech.edu.cn:8443/webapps/blackboard/execute/launcher?type=Course&id=_1_1',
};

/** 两个模块相邻的页面（真实门户就是这样排布的） */
const portal = `<html><body>
  <div class="portlet" id="module-_3_1">
    <h2><span class="moduleTitle">我的课程</span></h2>
    <div class="content">
      <a href="/webapps/blackboard/execute/launcher?type=Course&id=_9_1&url=">别的学期的课</a>
    </div>
  </div>
  <div class="portlet" id="module-_1_1">
    <h2><span class="moduleTitle">未完成课程列表</span></h2>
    <div class="content">
      <ul class="courseListing">
        <li><a href="/webapps/blackboard/execute/launcher?type=Course&id=_1_1&url=">CS101 程序设计</a></li>
        <li><a href="/webapps/blackboard/execute/launcher?type=Course&id=_2_1&url=">MA201 线性代数</a></li>
      </ul>
    </div>
  </div>
  <div class="portlet" id="module-_2_1">
    <h2><span class="moduleTitle">待完成作业</span></h2>
    <div class="content">
      <ul>
        <li><a href="/webapps/assignment/uploadAssignment?content_id=_100_1&course_id=_1_1&mode=view">Homework 1</a></li>
        <li><a href="/webapps/assignment/uploadAssignment?content_id=_200_1&course_id=_9_1&mode=view">未选课程作业</a></li>
      </ul>
    </div>
  </div>
</body></html>`;

describe('findBlackboardModule', () => {
  it('按模块标题切出区块，边界到下一个 portlet', () => {
    const block = findBlackboardModule(portal, /未完成课程列表/);
    expect(block).not.toBeNull();
    expect(block).toContain('CS101 程序设计');
    expect(block).toContain('MA201 线性代数');
    // 「我的课程」模块里的内容不应混进来
    expect(block).not.toContain('别的学期的课');
  });

  it('找不到模块返回 null', () => {
    expect(findBlackboardModule('<div>没有模块</div>', /未完成课程列表/)).toBeNull();
    expect(findBlackboardModule('', /未完成课程列表/)).toBeNull();
  });
});

describe('parseBlackboardCourseLinks', () => {
  it('同时认 course_id 与 launcher 两种入口，并按 id 去重', () => {
    const html = `
      <a href="/webapps/blackboard/execute/launcher?type=Course&id=_1_1&url=">CS101</a>
      <a href="/webapps/blackboard/execute/launcher?course_id=_1_1">CS101 重复</a>
      <a href="/webapps/blackboard/execute/launcher?type=Course&id=_2_1">MA201</a>`;
    const result = parseBlackboardCourseLinks(html, BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((entry) => entry.id)).toEqual(['blackboard:_1_1', 'blackboard:_2_1']);
    expect(result.value[0]?.title).toBe('CS101');
  });

  it('丢弃外站链接、无标题链接与非课程 launcher', () => {
    const html = `
      <a href="https://evil.test/x?course_id=_1_1">外站</a>
      <a href="/webapps/blackboard/execute/launcher?type=Course&id=_3_1"></a>
      <a href="/webapps/blackboard/execute/launcher?type=Organization&id=_4_1">组织</a>`;
    const result = parseBlackboardCourseLinks(html, BASE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unrecognized-structure');
  });

  it('base 非法返回 invalid-url', () => {
    const result = parseBlackboardCourseLinks('<a href="/x">x</a>', 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-url');
  });
});

describe('parseBlackboardCurrentCourses', () => {
  it('只读「未完成课程列表」模块里的课', () => {
    const result = parseBlackboardCurrentCourses(portal, BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((entry) => entry.id)).toEqual(['blackboard:_1_1', 'blackboard:_2_1']);
  });

  it('模块不存在 → module-missing（不是空数组）', () => {
    const result = parseBlackboardCurrentCourses('<div>首页</div>', BASE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('module-missing');
  });

  it('模块还在加载 → module-loading（不能当没课）', () => {
    const result = parseBlackboardCurrentCourses(
      '<div class="portlet"><span class="moduleTitle">未完成课程列表</span><div>正在加载…</div></div>',
      BASE,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('module-loading');
  });

  it('空的 courseListing 是合法的「本学期没有课」', () => {
    const result = parseBlackboardCurrentCourses(
      '<div class="portlet"><span class="moduleTitle">未完成课程列表</span><ul class="courseListing"></ul></div>',
      BASE,
    );
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('页面明说没有课程时也是空数组', () => {
    const result = parseBlackboardCurrentCourses(
      '<div class="portlet"><span class="moduleTitle">未完成课程列表</span><p>您没有未完成的课程</p></div>',
      BASE,
    );
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('列表有内容但没有课程链接 → 结构不认识', () => {
    const result = parseBlackboardCurrentCourses(
      '<div class="portlet"><span class="moduleTitle">未完成课程列表</span><ul class="courseListing"><li>占位</li></ul></div>',
      BASE,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unrecognized-structure');
  });

  it('登录页优先报 login-required', () => {
    const result = parseBlackboardCurrentCourses(
      '<form><input type="password" name="password"></form>',
      BASE,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('login-required');
  });
});

describe('parseBlackboardAssignmentPage', () => {
  const url =
    'https://elearning.shanghaitech.edu.cn:8443/webapps/assignment/uploadAssignment?content_id=_100_1&course_id=_1_1&mode=view';

  const page = (body: string) => `<html><body>${body}</body></html>`;

  it('解析作业标题、截止与状态', () => {
    const result = parseBlackboardAssignmentPage({
      html: page('<h1 id="pageTitleHeader">上传作业: Homework 1</h1><div>截止日期：2026年10月20日 下午11:59</div><div>尚未提交</div>'),
      url,
      course,
      fallbackTitle: '兜底标题',
      term: 'Fall 2026',
      timeZone: SHANGHAI,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      id: 'blackboard:_1_1:assignment:_100_1',
      courseId: 'blackboard:_1_1',
      nativeId: '_100_1',
      title: 'Homework 1',
      dueAtIso: '2026-10-20T15:59:00.000Z',
      dueText: '2026年10月20日 下午11:59',
      lateDueAtIso: null,
      submission: 'not_submitted',
    });
  });

  it('英文格式的 Due Date 也认', () => {
    const result = parseBlackboardAssignmentPage({
      html: page('<h1 id="pageTitleHeader">Lab 2</h1><div>Due Date: Oct 22, 2026 11:59 PM</div>'),
      url,
      course,
      fallbackTitle: '兜底',
      timeZone: SHANGHAI,
      now: NOW,
    });

    expect(result.ok && result.value?.dueAtIso).toBe('2026-10-22T15:59:00.000Z');
    expect(result.ok && result.value?.title).toBe('Lab 2');
  });

  it('页面完全没有标题时用兜底标题', () => {
    const result = parseBlackboardAssignmentPage({
      html: page('<div>截止日期：2026年10月20日 23:59</div>'),
      url,
      course,
      fallbackTitle: '课程作业',
      timeZone: SHANGHAI,
      now: NOW,
    });
    expect(result.ok && result.value?.title).toBe('课程作业');
  });

  it('页面没有标题时用兜底标题并剥掉平台前缀', () => {
    const result = parseBlackboardAssignmentPage({
      html: page('<h1>复查提交历史记录: Essay</h1><div>截止日期：2026年10月20日 23:59</div>'),
      url,
      course,
      fallbackTitle: '兜底',
      timeZone: SHANGHAI,
      now: NOW,
    });
    expect(result.ok && result.value?.title).toBe('Essay');
  });

  it('不是作业页 → ok + null（不猜）', () => {
    const result = parseBlackboardAssignmentPage({
      html: page('<h1>课程目录</h1>'),
      url: 'https://elearning.shanghaitech.edu.cn:8443/webapps/blackboard/content/listContent.jsp?course_id=_1_1&content_id=_9_1',
      course,
      fallbackTitle: 'x',
      timeZone: SHANGHAI,
      now: NOW,
    });
    expect(result).toEqual({ ok: true, value: null });
  });

  it('作业页但没有 content_id → ok + null', () => {
    const result = parseBlackboardAssignmentPage({
      html: page('<h1>上传作业</h1><div>截止日期：2026年10月20日 23:59</div>'),
      url: 'https://elearning.shanghaitech.edu.cn:8443/webapps/assignment/uploadAssignment?course_id=_1_1&mode=view',
      course,
      fallbackTitle: 'x',
      timeZone: SHANGHAI,
      now: NOW,
    });
    expect(result).toEqual({ ok: true, value: null });
  });

  it('有截止日期但没有时间 → dueAtIso 为 null', () => {
    const result = parseBlackboardAssignmentPage({
      html: page('<h1>上传作业</h1><div>截止日期：2026年10月20日</div>'),
      url,
      course,
      fallbackTitle: 'x',
      timeZone: SHANGHAI,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.dueAtIso).toBeNull();
    expect(result.value?.dueText).toBe('2026年10月20日');
  });

  it('有分数时为 graded', () => {
    const result = parseBlackboardAssignmentPage({
      html: page('<h1>上传作业</h1><div>截止日期：2026年10月20日 23:59</div><div>85 / 100</div>'),
      url,
      course,
      fallbackTitle: 'x',
      timeZone: SHANGHAI,
      now: NOW,
    });
    expect(result.ok && result.value?.submission).toBe('graded');
  });

  it('登录过期报 login-required', () => {
    const result = parseBlackboardAssignmentPage({
      html: '<input type="password" name="password">',
      url,
      course,
      fallbackTitle: 'x',
      timeZone: SHANGHAI,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('login-required');
  });

  it('非法 URL 返回 invalid-url', () => {
    const result = parseBlackboardAssignmentPage({
      html: page('<h1>上传作业</h1>'),
      url: 'nope',
      course,
      fallbackTitle: 'x',
      timeZone: SHANGHAI,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-url');
  });
});

describe('parseBlackboardPendingAssignments', () => {
  it('只保留已选课程的待完成作业入口', () => {
    const result = parseBlackboardPendingAssignments(portal, BASE, [course]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value?.empty).toBe(false);
    expect(result.value?.links).toEqual([
      {
        url: 'https://elearning.shanghaitech.edu.cn:8443/webapps/assignment/uploadAssignment?content_id=_100_1&course_id=_1_1&mode=view',
        title: 'Homework 1',
        courseId: 'blackboard:_1_1',
      },
    ]);
  });

  it('模块明说没有作业时 empty=true', () => {
    const result = parseBlackboardPendingAssignments(
      '<div class="portlet"><span class="moduleTitle">待完成作业</span><div>您目前没有未完成的作业</div></div>',
      BASE,
      [course],
    );
    expect(result).toEqual({ ok: true, value: { links: [], empty: true } });
  });

  it('模块不存在 → ok + null', () => {
    const result = parseBlackboardPendingAssignments('<div>首页</div>', BASE, [course]);
    expect(result).toEqual({ ok: true, value: null });
  });

  it('既没写没有作业、也没有可用链接 → null（不敢当空）', () => {
    const result = parseBlackboardPendingAssignments(
      '<div class="portlet"><span class="moduleTitle">待完成作业</span><div>模块占位</div></div>',
      BASE,
      [],
    );
    expect(result).toEqual({ ok: true, value: null });
  });

  it('base 非法返回 invalid-url', () => {
    const result = parseBlackboardPendingAssignments('<div>x</div>', 'nope', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-url');
  });
});
