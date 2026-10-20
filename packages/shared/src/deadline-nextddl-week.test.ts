/**
 * `deadline-nextddl-week` 的测试。
 *
 * 重心是三个「错了不会在本机报错、只会让整张课表错一周」的地方：
 *
 *   1. **自然日算术**：用 `new Date('2026-09-07')`（UTC）或 `new Date(2026, 8, 7)`
 *      （本地时区）都会在别的时区机器上算错一天，所以这里的断言全部是固定的日期串，
 *      换台机器跑必须一样。
 *   2. **周起点与开学日不对齐**：周四开学时「第 1 周周一」在开学之前，这是日历周语义，
 *      不是 bug；反向换算必须同意同一件事。
 *   3. **`timeZone` 必填**：同一时刻在上海和 UTC 可能是不同自然日，进而落在学期内外两侧。
 *
 * 每条用例名写的是**场景**（谁会在什么情况下被误导），不是函数名。
 */

import { describe, expect, it } from 'vitest';

import {
  semesterWeekDate,
  semesterWeekOf,
  type SemesterWeekCalendar,
  type SemesterWeekday,
} from './deadline-nextddl-week';
import { parseDueText } from './deadline-normalize';

const SHANGHAI = 'Asia/Shanghai';

/** 2026 秋季学期：学期第一天是周一（最常见的情况） */
const CAL: SemesterWeekCalendar = { firstWeekStart: '2026-09-07' };

/** 2026 秋季学期：周四开学 —— 用来盯「第 1 周从哪天算」 */
const CAL_THURSDAY: SemesterWeekCalendar = { firstWeekStart: '2026-09-03' };

/** 2026 秋季学期：周日开学，且每周从周日起 */
const CAL_SUNDAY: SemesterWeekCalendar = { firstWeekStart: '2026-09-06', weekStartsOn: 7 };

const NOW = new Date('2026-09-01T00:00:00.000Z'); // 上海 2026-09-01 08:00

describe('semesterWeekDate · 正常路径', () => {
  it('第 1 周周一就是学期第一天（南科大/上科大课表口径）', () => {
    expect(semesterWeekDate(CAL, 1, 1).date).toBe('2026-09-07');
  });

  it('第 1 周周日是开学后第 6 天，不是下周一', () => {
    expect(semesterWeekDate(CAL, 1, 7).date).toBe('2026-09-13');
  });

  it('第 7 周周三是 10-21（中间隔着国庆，仍按连续 7 天算）', () => {
    expect(semesterWeekDate(CAL, 7, 3)).toEqual({
      week: 7,
      weekday: 3,
      date: '2026-10-21',
    });
  });

  it('第 16 周周五 = 2026-12-25', () => {
    expect(semesterWeekDate(CAL, 16, 5).date).toBe('2026-12-25');
  });

  it('跨年：第 19 周周一 = 2027-01-11', () => {
    expect(semesterWeekDate(CAL, 19, 1).date).toBe('2027-01-11');
  });

  it('跨闰年二月：2024-02-19 开学，第 3 周周三 = 2024-03-06', () => {
    expect(semesterWeekDate({ firstWeekStart: '2024-02-19' }, 3, 3).date).toBe('2024-03-06');
  });

  it('原样回显 week / weekday（调用方不用再自己拼回去）', () => {
    expect(semesterWeekDate(CAL, 5, 6)).toMatchObject({ week: 5, weekday: 6 });
  });

  it('不设周次上限：第 99 周照样算出真实日期（学期长度我们不知道，不猜）', () => {
    expect(semesterWeekDate(CAL, 99, 1)).toEqual({
      week: 99,
      weekday: 1,
      date: '2028-07-24',
    });
  });
});

describe('semesterWeekDate · 周起点', () => {
  it('weekStartsOn: 7 时，第 1 周周日 = 开学日，周一 = 次日', () => {
    expect(semesterWeekDate(CAL_SUNDAY, 1, 7).date).toBe('2026-09-06');
    expect(semesterWeekDate(CAL_SUNDAY, 1, 1).date).toBe('2026-09-07');
    expect(semesterWeekDate(CAL_SUNDAY, 2, 7).date).toBe('2026-09-13');
  });

  it('周四开学、默认周一起：第 1 周周一落在开学日之前（日历周语义）', () => {
    expect(semesterWeekDate(CAL_THURSDAY, 1, 1).date).toBe('2026-08-31');
    expect(semesterWeekDate(CAL_THURSDAY, 1, 4).date).toBe('2026-09-03');
    expect(semesterWeekDate(CAL_THURSDAY, 2, 1).date).toBe('2026-09-07');
  });

  it('同一份配置的正反方向必须同意「周四开学那一周是第 1 周」', () => {
    const pos = semesterWeekOf('2026-09-03T12:00:00+08:00', CAL_THURSDAY, SHANGHAI);
    expect(pos).toEqual({ week: 1, weekday: 4, date: '2026-09-03' });
    // 开学前的那个周一也属于第 1 周 —— 正向给出 08-31，反向不能说是第 0 周
    expect(semesterWeekOf('2026-08-31T08:00:00+08:00', CAL_THURSDAY, SHANGHAI)).toEqual({
      week: 1,
      weekday: 1,
      date: '2026-08-31',
    });
  });
});

describe('semesterWeekDate · 非法入参（配置错误要吵，不能静默）', () => {
  it.each([0, -1, 1.5, Number.NaN])('week = %s 抛 RangeError', (week) => {
    expect(() => semesterWeekDate(CAL, week, 1)).toThrow(RangeError);
  });

  it.each([0, 8, 1.5])('weekday = %s 抛 RangeError', (weekday) => {
    expect(() => semesterWeekDate(CAL, 1, weekday as SemesterWeekday)).toThrow(RangeError);
  });

  it.each([0, 8])('weekStartsOn = %s 抛 RangeError', (weekStartsOn) => {
    expect(() =>
      semesterWeekDate({ firstWeekStart: '2026-09-07', weekStartsOn: weekStartsOn as SemesterWeekday }, 1, 1),
    ).toThrow(RangeError);
  });

  it.each(['2026/09/07', '2026-9-7', '2026-02-30', '', '2026-13-01'])(
    'firstWeekStart = %s 抛 RangeError（不是返回 null）',
    (firstWeekStart) => {
      expect(() => semesterWeekDate({ firstWeekStart }, 1, 1)).toThrow(RangeError);
    },
  );

  it('错误信息点名是哪个字段，便于定位配置', () => {
    expect(() => semesterWeekDate({ firstWeekStart: 'oops' }, 1, 1)).toThrow(/firstWeekStart/);
  });

  it('TS 之外传了 null 也能拿到可读的 RangeError', () => {
    expect(() => semesterWeekDate(null as unknown as SemesterWeekCalendar, 1, 1)).toThrow(
      /calendar/,
    );
  });
});

describe('semesterWeekOf · 正常路径', () => {
  it('上海时间 23:59 仍算当天（不能被 UTC 拉到前一天）', () => {
    expect(semesterWeekOf('2026-09-07T15:59:00Z', CAL, SHANGHAI)).toEqual({
      week: 1,
      weekday: 1,
      date: '2026-09-07',
    });
  });

  it('第 1 周最后一天 23:59 = 第 1 周周日', () => {
    expect(semesterWeekOf('2026-09-13T23:59:00+08:00', CAL, SHANGHAI)).toEqual({
      week: 1,
      weekday: 7,
      date: '2026-09-13',
    });
  });

  it('周一 00:01 立刻进入第 2 周（不拖到周二）', () => {
    expect(semesterWeekOf('2026-09-14T00:01:00+08:00', CAL, SHANGHAI)).toEqual({
      week: 2,
      weekday: 1,
      date: '2026-09-14',
    });
  });

  it('学期第一天 00:00 就是第 1 周周一', () => {
    expect(semesterWeekOf('2026-09-07T00:00:00+08:00', CAL, SHANGHAI)).toEqual({
      week: 1,
      weekday: 1,
      date: '2026-09-07',
    });
  });

  it('第 7 周周三 12:00', () => {
    expect(semesterWeekOf('2026-10-21T12:00:00+08:00', CAL, SHANGHAI)).toEqual({
      week: 7,
      weekday: 3,
      date: '2026-10-21',
    });
  });

  it('学期开始之前返回 null（不编「第 0 周」）', () => {
    expect(semesterWeekOf('2026-09-06T23:59:00+08:00', CAL, SHANGHAI)).toBeNull();
    expect(semesterWeekOf('2026-01-01T12:00:00+08:00', CAL, SHANGHAI)).toBeNull();
  });

  it('⚠️ timeZone 必填且真的参与判断：同一个 UTC 时刻在上海是第 1 周、在 UTC 是学期前', () => {
    const instant = '2026-09-06T20:00:00.000Z'; // 上海 09-07 04:00 / UTC 09-06 20:00
    expect(semesterWeekOf(instant, CAL, SHANGHAI)).toEqual({
      week: 1,
      weekday: 1,
      date: '2026-09-07',
    });
    expect(semesterWeekOf(instant, CAL, 'UTC')).toBeNull();
    expect(semesterWeekOf(instant, CAL, 'America/New_York')).toBeNull();
  });

  it('周日开学 + weekStartsOn: 7：周六属第 1 周，次日周日进入第 2 周', () => {
    expect(semesterWeekOf('2026-09-12T23:59:00+08:00', CAL_SUNDAY, SHANGHAI)).toEqual({
      week: 1,
      weekday: 6,
      date: '2026-09-12',
    });
    expect(semesterWeekOf('2026-09-13T00:00:00+08:00', CAL_SUNDAY, SHANGHAI)).toEqual({
      week: 2,
      weekday: 7,
      date: '2026-09-13',
    });
  });

  it('纯日期按 UTC 午夜解释；上海时区下仍是同一天（我们不额外修正）', () => {
    expect(semesterWeekOf('2026-10-21', CAL, SHANGHAI)).toEqual({
      week: 7,
      weekday: 3,
      date: '2026-10-21',
    });
  });
});

describe('semesterWeekOf · 两个方向互为逆运算', () => {
  it('第 1…20 周的每一天都能原样往返', () => {
    for (let week = 1; week <= 20; week += 1) {
      for (let weekday = 1; weekday <= 7; weekday += 1) {
        const forward = semesterWeekDate(CAL, week, weekday as SemesterWeekday);
        const back = semesterWeekOf(`${forward.date}T12:00:00+08:00`, CAL, SHANGHAI);
        expect(back, `第 ${week} 周 星期 ${weekday}`).toEqual(forward);
      }
    }
  });

  it('跨年与周四开学的配置同样往返一致', () => {
    for (const calendar of [CAL_THURSDAY, { firstWeekStart: '2024-02-19' }]) {
      for (const [week, weekday] of [
        [1, 1],
        [1, 4],
        [18, 7],
        [19, 1],
      ] as const) {
        const forward = semesterWeekDate(calendar, week, weekday);
        expect(semesterWeekOf(`${forward.date}T12:00:00+08:00`, calendar, SHANGHAI)).toEqual(forward);
      }
    }
  });
});

describe('semesterWeekOf · 数据问题返回 null，配置问题抛异常', () => {
  it.each(['', '   ', 'not-a-date', 'TBD', '2026-02-30T12:00:00+08:00'])(
    'dueAt = %j 返回 null（一行坏数据不中断整批）',
    (dueAt) => {
      expect(semesterWeekOf(dueAt, CAL, SHANGHAI)).toBeNull();
    },
  );

  it.each(['', 'Not/AZone'])('timeZone = %j 抛 RangeError', (timeZone) => {
    expect(() => semesterWeekOf('2026-10-21T12:00:00+08:00', CAL, timeZone)).toThrow(RangeError);
  });

  it('firstWeekStart 非法时抛 RangeError，即使 dueAt 本身也认不出', () => {
    expect(() => semesterWeekOf('not-a-date', { firstWeekStart: '2026/09/07' }, SHANGHAI)).toThrow(
      RangeError,
    );
  });

  it('weekStartsOn 非法时两个方向都报错（同一份配置不能一个方向静默）', () => {
    const bad = { firstWeekStart: '2026-09-07', weekStartsOn: 0 as SemesterWeekday };
    expect(() => semesterWeekDate(bad, 1, 1)).toThrow(RangeError);
    expect(() => semesterWeekOf('2026-10-21T12:00:00+08:00', bad, SHANGHAI)).toThrow(RangeError);
  });
});

describe('与 parseDueText 组合：本模块只给日期，时刻仍由唯一的日期入口算', () => {
  it('第 7 周周三 23:59（上海）= 2026-10-21T15:59:00Z', () => {
    const { date } = semesterWeekDate(CAL, 7, 3);
    expect(parseDueText(`${date} 23:59`, NOW, SHANGHAI)).toBe('2026-10-21T15:59:00.000Z');
  });

  it('换时区就是换绝对时刻，日期部分不动', () => {
    const { date } = semesterWeekDate(CAL, 7, 3);
    expect(parseDueText(`${date} 23:59`, NOW, 'UTC')).toBe('2026-10-21T23:59:00.000Z');
  });
});
