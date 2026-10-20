/**
 * `deadline-parse-eams` 的测试。
 *
 * EAMS 的特殊之处：课表不是表格，而是一串 `new TaskActivity(...)` 脚本调用。
 * 我们**不执行脚本**，只读字符串字面量。所以这里的测试集中在「读出来的字段对不对」
 * 和「编码变了会不会静默错位」——后者比前者重要：周次整体错一周，学生就按错的
 * 周次去上课。
 */

import { describe, expect, it } from 'vitest';

import { EAMS_TIMETABLE_URL, parseEamsSelection, parseEamsTimetable } from './deadline-parse-eams';

const timetable = (script: string, body = '') =>
  `<html><body><div id="courseTable"><script type="text/javascript">${script}</script></div>${body}</body></html>`;

describe('parseEamsSelection', () => {
  it('从页面脚本读学号与学期', () => {
    const html =
      '<script>addInput(form, "ids", "20260101"); semesterCalendar({value:"132", year:2026});</script>';
    const result = parseEamsSelection(html);
    expect(result).toEqual({
      ok: true,
      value: {
        student: '20260101',
        semester: '132',
        body: 'setting.kind=std&startWeek=&semester.id=132&ids=20260101',
      },
    });
  });

  it('从隐藏 input 读学号与学期', () => {
    const html =
      '<input type="hidden" name="ids" value="20260101"><input type="hidden" name="semester.id" value="132">';
    const result = parseEamsSelection(html);
    expect(result.ok && result.value).toMatchObject({ student: '20260101', semester: '132' });
  });

  it('显式传入的学期优先', () => {
    const html = '<script>addInput(form, "ids", "20260101");</script><input name="semester.id" value="132">';
    const result = parseEamsSelection(html, '140');
    expect(result.ok && result.value.semester).toBe('140');
  });

  it('缺参数 → unrecognized-structure（不拼空学号请求）', () => {
    const result = parseEamsSelection('<div>请先登录</div>');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unrecognized-structure');
  });

  it('非数字参数 → unrecognized-structure', () => {
    const html = '<input name="ids" value="abc"><input name="semester.id" value="132">';
    const result = parseEamsSelection(html);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unrecognized-structure');
  });

  it('登录页 → login-required', () => {
    const result = parseEamsSelection('<form><input type="password" name="password"></form>');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('login-required');
  });
});

describe('parseEamsTimetable', () => {
  const script = `
    var activity = null;
    activity = new TaskActivity("1203","张老师","10908","高等数学(CS101)","1456","3-401","0101010101010101");
    activity.index = 3 * unitCount + 4;
    activity.index = 3 * unitCount + 5;
    activity = new TaskActivity("1204","","10909","大学物理","1457","3-402","0011001100110011");
    activity.index = 1 * unitCount + 0;
  `;

  const body = `
    <div>第1节 08:15-09:00</div>
    <div>第2节 09:10-09:55</div>
    <div>第5节 13:00-13:45</div>
    <div>第10节 18:00-18:45</div>
  `;

  it('把 TaskActivity 还原成课程与排课', () => {
    const result = parseEamsTimetable(timetable(script, body), '132');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.courses).toEqual([
      {
        id: 'eams:132:10908',
        title: '高等数学',
        code: 'CS101',
        term: '132',
        url: EAMS_TIMETABLE_URL,
      },
      {
        id: 'eams:132:10909',
        title: '大学物理',
        code: '',
        term: '132',
        url: EAMS_TIMETABLE_URL,
      },
    ]);

    expect(result.value.lessons).toHaveLength(2);
    expect(result.value.lessons[0]).toEqual({
      id: 'eams:132:10908:4:5:6:1.3.5.7.9.11.13.15',
      courseId: 'eams:132:10908',
      title: '高等数学',
      code: 'CS101',
      term: '132',
      teacher: '张老师',
      location: '3-401',
      weekday: 4,
      first: 5,
      last: 6,
      weeks: [1, 3, 5, 7, 9, 11, 13, 15],
    });
    // 教师字段为空/占位时不写入，避免 UI 显示一串空白
    expect(result.value.lessons[1]?.teacher).toBe('');
  });

  it('节次时间表按上午 / 下午 / 晚上归类', () => {
    const result = parseEamsTimetable(timetable(script, body), '132');
    expect(result.ok && result.value.periods).toEqual([
      { start: '08:15', end: '09:00', group: '上午' },
      { start: '09:10', end: '09:55', group: '上午' },
      { start: '13:00', end: '13:45', group: '下午' },
      { start: '18:00', end: '18:45', group: '晚上' },
    ]);
  });

  it('同一时段的连续节次合并成一条，跳节的拆开', () => {
    const result = parseEamsTimetable(
      timetable(
        'activity = new TaskActivity("1","t","9","课","2","A","0011"); activity.index = 0 * unitCount + 0; activity.index = 0 * unitCount + 1; activity.index = 0 * unitCount + 4;',
      ),
      '132',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lessons.map((lesson) => [lesson.weekday, lesson.first, lesson.last])).toEqual([
      [1, 1, 2],
      [1, 5, 5],
    ]);
  });

  it('周次首位为 1（意味着第 0 周）→ inconsistent-page，整体失败', () => {
    const result = parseEamsTimetable(
      timetable('activity = new TaskActivity("1","t","9","课","2","A","1010"); activity.index = 0 * unitCount + 0;'),
      '132',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('inconsistent-page');
  });

  it('周次编码不是 0/1 串 → inconsistent-page', () => {
    const result = parseEamsTimetable(
      timetable('activity = new TaskActivity("1","t","9","课","2","A","01x1"); activity.index = 0 * unitCount + 0;'),
      '132',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('inconsistent-page');
  });

  it('参数不足 7 个 → inconsistent-page', () => {
    const result = parseEamsTimetable(timetable('activity = new TaskActivity("1","t");'), '132');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('inconsistent-page');
  });

  it('没有节次坐标 → inconsistent-page', () => {
    const result = parseEamsTimetable(
      timetable('activity = new TaskActivity("1","t","9","课","2","A","0011");'),
      '132',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('inconsistent-page');
  });

  it('星期坐标越界 → inconsistent-page', () => {
    const result = parseEamsTimetable(
      timetable('activity = new TaskActivity("1","t","9","课","2","A","0011"); activity.index = 9 * unitCount + 0;'),
      '132',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('inconsistent-page');
  });

  it('页面明说本学期无课时返回空课表', () => {
    const result = parseEamsTimetable(timetable('', '<div>本学期无课</div>'), '132');
    expect(result).toEqual({ ok: true, value: { lessons: [], courses: [], periods: [] } });
  });

  it('一节课都没有且页面没说无课 → unrecognized-structure（不返空）', () => {
    const result = parseEamsTimetable(timetable('var x = 1;'), '132');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unrecognized-structure');
  });

  it('教务报错 → source-refused（保留旧课表）', () => {
    const result = parseEamsTimetable('<div>error.courseTable</div>', '132');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('source-refused');
  });

  it('登录页 → login-required', () => {
    const result = parseEamsTimetable('<input type="password">', '132');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('login-required');
  });

  it('课程标签里的代码括号只剥末尾那一对', () => {
    const result = parseEamsTimetable(
      timetable('activity = new TaskActivity("1","t","9","物理(实验)(PHY101)","2","A","0011"); activity.index = 0 * unitCount + 0;'),
      '132',
    );
    expect(result.ok && result.value.courses[0]).toMatchObject({
      title: '物理(实验)',
      code: 'PHY101',
    });
  });

  it('转义字符的课程名能正确还原', () => {
    const result = parseEamsTimetable(
      timetable('activity = new TaskActivity("1","t","9","\\u5927\\u5b66\\u7269\\u7406","2","A","0011"); activity.index = 0 * unitCount + 0;'),
      '132',
    );
    expect(result.ok && result.value.courses[0]?.title).toBe('大学物理');
  });
});
