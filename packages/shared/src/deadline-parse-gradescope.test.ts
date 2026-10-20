/**
 * `deadline-parse-gradescope` 的测试。
 *
 * 重点不是「能解析」，而是三种会让**学生错过截止**的情况：
 * 1. 截止单元格里堆了发布日、截止日、迟交日三个日期，取错一个就差好几天；
 * 2. 页面只有 `datetime` 属性没有可见日期，或者反过来；
 * 3. 侧栏重复渲染同一门课且没有学期，把 Dashboard 的学期冲掉。
 *
 * 所有 HTML 都是手工构造的**结构等价样本**，不是从真实页面转存的（不携带平台内容）。
 */

import { describe, expect, it } from 'vitest';

import type { GradescopeCourse } from './deadline-parse-gradescope';
import {
  parseGradescopeAssignments,
  parseGradescopeCourseList,
} from './deadline-parse-gradescope';

const NOW = new Date('2026-10-20T08:00:00+08:00');
const SHANGHAI = 'Asia/Shanghai';

const course: GradescopeCourse = {
  id: 'gradescope:1001',
  nativeId: '1001',
  name: 'CS 101',
  term: 'Fall 2026',
  url: 'https://www.gradescope.com/courses/1001',
};

const options = { timeZone: SHANGHAI, now: NOW };

describe('parseGradescopeCourseList', () => {
  const dashboard = `<!doctype html><html><body>
    <h2>Fall 2026</h2>
    <div class="courseList">
      <div class="courseList--course">
        <a href="/courses/1001"><h3 class="courseName">CS 101 Intro to Programming</h3></a>
      </div>
      <div class="courseList--course">
        <a href="/courses/1002"><h3 class="courseName">MA 201 Linear Algebra</h3></a>
      </div>
    </div>
    <h2>Spring 2026</h2>
    <div class="courseList">
      <a href="/courses/1003"><h3>PHY 100 Physics</h3></a>
    </div>
  </body></html>`;

  it('读出课程、学期与稳定 ID', () => {
    const result = parseGradescopeCourseList(dashboard, 'https://www.gradescope.com/account');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual([
      {
        id: 'gradescope:1001',
        nativeId: '1001',
        name: 'CS 101 Intro to Programming',
        term: 'Fall 2026',
        url: 'https://www.gradescope.com/courses/1001',
      },
      {
        id: 'gradescope:1002',
        nativeId: '1002',
        name: 'MA 201 Linear Algebra',
        term: 'Fall 2026',
        url: 'https://www.gradescope.com/courses/1002',
      },
      {
        id: 'gradescope:1003',
        nativeId: '1003',
        name: 'PHY 100 Physics',
        term: 'Spring 2026',
        url: 'https://www.gradescope.com/courses/1003',
      },
    ]);
  });

  it('div.courseList--term 也能当学期分组', () => {
    const html = `
      <div class="courseList--term">Winter 2027</div>
      <a href="/courses/7">STAT 300</a>`;
    const result = parseGradescopeCourseList(html, 'https://www.gradescope.com/account');
    expect(result.ok && result.value[0]?.term).toBe('Winter 2027');
  });

  it('学期也可以写在链接文本里', () => {
    const html = '<a href="/courses/9">BIO 101 Fall 2026</a>';
    const result = parseGradescopeCourseList(html, 'https://www.gradescope.com/account');
    expect(result.ok && result.value[0]?.term).toBe('Fall 2026');
  });

  it('侧栏重复课程（无学期）不覆盖 Dashboard 卡片的学期', () => {
    const html = `
      <a href="/courses/1001">CS 101</a>
      <h2>Fall 2026</h2>
      <a href="/courses/1001"><h3>CS 101 Intro to Programming</h3></a>
      <a href="/courses/1001">CS 101</a>`;
    const result = parseGradescopeCourseList(html, 'https://www.gradescope.com/account');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.term).toBe('Fall 2026');
    expect(result.value[0]?.name).toBe('CS 101 Intro to Programming');
  });

  it('先有学期卡片、后有无学期侧栏时保留学期', () => {
    const html = `
      <h2>Fall 2026</h2>
      <a href="/courses/1001">CS 101</a>
      <a href="/courses/1001">CS 101</a>`;
    const result = parseGradescopeCourseList(html, 'https://www.gradescope.com/account');
    expect(result.ok && result.value[0]?.term).toBe('Fall 2026');
  });

  it('页面明确写「没有课程」时返回空数组', () => {
    const result = parseGradescopeCourseList(
      '<h1>No active courses</h1>',
      'https://www.gradescope.com/account',
    );
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('结构不认识时失败，而不是返回空数组', () => {
    const result = parseGradescopeCourseList(
      '<div>正在加载…</div>',
      'https://www.gradescope.com/account',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unrecognized-structure');
  });

  it('登录页失败码是 login-required', () => {
    const result = parseGradescopeCourseList(
      '<form><input type="password" name="session[password]"></form>',
      'https://www.gradescope.com/login',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('login-required');
  });

  it('忽略非本平台的课程链接', () => {
    const result = parseGradescopeCourseList(
      '<a href="https://evil.test/courses/1">X</a><h1>No active courses</h1>',
      'https://www.gradescope.com/account',
    );
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('非法 base 返回 invalid-url', () => {
    const result = parseGradescopeCourseList('<div>x</div>', 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-url');
  });
});

describe('parseGradescopeAssignments', () => {
  const page = (rows: string) => `<html><body><table class="assignmentsTable"><tbody>${rows}</tbody></table></body></html>`;

  it('从 --dueDate 的 datetime 属性取截止（含偏移）', () => {
    const result = parseGradescopeAssignments(
      page(`
      <tr>
        <td class="table--primaryLink"><a href="/courses/1001/assignments/555">Homework 1</a></td>
        <td class="submissionTimeChart--dueDate">
          <span class="submissionTimeChart--dueDate" datetime="2026-10-22T23:59:00-07:00">Oct 22</span>
        </td>
        <td>Not submitted</td>
      </tr>`),
      course,
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      id: 'gradescope:1001:assignment:555',
      courseId: 'gradescope:1001',
      nativeId: '555',
      title: 'Homework 1',
      url: 'https://www.gradescope.com/courses/1001/assignments/555',
      dueAtIso: '2026-10-23T06:59:00.000Z',
      submission: 'not_submitted',
    });
  });

  it('没有 datetime 时：切掉迟交段，取剩下最后一个日期当截止', () => {
    const result = parseGradescopeAssignments(
      page(`
      <tr>
        <td><a href="/courses/1001/assignments/556">Homework 2</a></td>
        <td class="submissionTimeChart--dueDate">5 days, 14 seconds left  Oct 13 at 8:00PM  Oct 22 at 11:59PM  Late Due Date: Oct 25 at 11:59PM</td>
        <td>Submitted</td>
      </tr>`),
      course,
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const assignment = result.value[0];
    expect(assignment?.dueAtIso).toBe('2026-10-22T15:59:00.000Z');
    expect(assignment?.dueText).toBe('Oct 22 at 11:59PM');
    expect(assignment?.lateDueAtIso).toBe('2026-10-25T15:59:00.000Z');
    expect(assignment?.submission).toBe('submitted');
  });

  it('页面没写迟交日期时 lateDueAtIso 为 null（不拿第二个时间凑）', () => {
    const result = parseGradescopeAssignments(
      page(`
      <tr>
        <td><a href="/courses/1001/assignments/557">Homework 3</a></td>
        <td class="dueDate">
          <span datetime="2026-10-01T00:00:00-07:00">Oct 1</span>
          <span datetime="2026-10-20T23:59:00-07:00">Oct 20</span>
        </td>
        <td>85 / 100</td>
      </tr>`),
      course,
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.dueAtIso).toBe('2026-10-21T06:59:00.000Z');
    expect(result.value[0]?.lateDueAtIso).toBeNull();
    expect(result.value[0]?.submission).toBe('graded');
  });

  it('忽略 releaseDate，只认截止', () => {
    const result = parseGradescopeAssignments(
      page(`
      <tr>
        <td><a href="/courses/1001/assignments/558">Lab 1</a></td>
        <td class="dueDate">
          <span class="submissionTimeChart--releaseDate" datetime="2026-10-01T00:00:00-07:00">Oct 1</span>
          <span class="submissionTimeChart--dueDate" datetime="2026-10-20T23:59:00-07:00">Oct 20</span>
        </td>
      </tr>`),
      course,
      options,
    );

    expect(result.ok && result.value[0]?.dueAtIso).toBe('2026-10-21T06:59:00.000Z');
  });

  it('缺时间时保留原文、dueAtIso 为 null（不猜午夜）', () => {
    const result = parseGradescopeAssignments(
      page(`
      <tr>
        <td><a href="/courses/1001/assignments/559">Project Proposal</a></td>
        <td class="dueDate">Oct 30</td>
      </tr>`),
      course,
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.dueAtIso).toBeNull();
    expect(result.value[0]?.dueText).toBe('Oct 30');
    expect(result.value[0]?.submission).toBe('unknown');
  });

  it('其他课程的作业行被忽略', () => {
    const result = parseGradescopeAssignments(
      page(`
      <tr>
        <td><a href="/courses/9999/assignments/1">别的课的作业</a></td>
        <td class="dueDate">Oct 20 at 11:59PM</td>
      </tr>`),
      { ...course, term: 'Fall 2026' },
      options,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it('页面明确写「没有作业」时返回空数组', () => {
    const result = parseGradescopeAssignments(
      '<div class="assignmentsEmptyState">No assignments yet</div>',
      course,
      options,
    );
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('结构不认识时失败（保留上次数据）', () => {
    const result = parseGradescopeAssignments('<div>Loading</div>', course, options);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unrecognized-structure');
  });

  it('作业 id 按课程隔离', () => {
    const result = parseGradescopeAssignments(
      page(`<tr><td><a href="/courses/1001/assignments/1">HW</a></td><td class="dueDate">Oct 20 at 11:59PM</td></tr>`),
      { ...course, id: 'gradescope:1001', nativeId: '1001' },
      options,
    );
    expect(result.ok && result.value[0]?.id).toBe('gradescope:1001:assignment:1');
  });

  it('课程 URL 非法时返回 invalid-url', () => {
    const result = parseGradescopeAssignments('<div>x</div>', { ...course, url: 'nope' }, options);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid-url');
  });
});
