import { describe, expect, it } from 'vitest';
import {
  SLOT_TIMES,
  findConflicts,
  relativeDayLabel,
  resolveMoment,
  slotRangeLabel,
  termLabel,
  termOf,
  weekdayLabel,
  weekdayOf,
} from './timetable.domain';
import type { ScheduleCourseModel } from './schedule.domain';

/**
 * 课表纯领域规则测试。
 *
 * 这一组测试的价值在于：课表的"看起来对"与"实际对"差异极大
 * （学期算错会拉空课表；倒计时算错会让人迟到）。全部用固定时间回归。
 */

function course(partial: Partial<ScheduleCourseModel> & { startSlot: number; endSlot: number }): ScheduleCourseModel {
  return {
    id: partial.id ?? `c-${partial.startSlot}-${partial.endSlot}-${partial.weekday ?? 1}`,
    userId: partial.userId ?? 'u1',
    term: partial.term ?? '2026-2027-1',
    courseName: partial.courseName ?? '数据结构与算法',
    teacher: partial.teacher ?? null,
    location: partial.location ?? null,
    weekday: partial.weekday ?? 1,
    startSlot: partial.startSlot,
    endSlot: partial.endSlot,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  };
}

describe('课表 · 学期与星期', () => {
  it('9 月–次年 1 月属于第一学期（含跨年）', () => {
    expect(termOf(new Date(2026, 8, 1))).toBe('2026-2027-1');
    expect(termOf(new Date(2026, 9, 17))).toBe('2026-2027-1');
    expect(termOf(new Date(2027, 0, 31))).toBe('2026-2027-1');
  });

  it('2 月–8 月属于上一学年的第二学期', () => {
    expect(termOf(new Date(2027, 1, 1))).toBe('2026-2027-2');
    expect(termOf(new Date(2027, 6, 15))).toBe('2026-2027-2');
  });

  it('学期标签可读', () => {
    expect(termLabel('2026-2027-1')).toBe('2026-2027 学年 第一学期');
    expect(termLabel('2026-2027-2')).toBe('2026-2027 学年 第二学期');
    // 形状不合法时原样返回，不要抛错（脏数据不该炸掉页面）
    expect(termLabel('whatever')).toBe('whatever');
  });

  it('星期：周一 = 1，周日 = 7', () => {
    expect(weekdayOf(new Date(2026, 9, 12))).toBe(1); // 2026-10-12 是周一
    expect(weekdayOf(new Date(2026, 9, 18))).toBe(7); // 2026-10-18 是周日
    expect(weekdayLabel(1)).toBe('周一');
    expect(weekdayLabel(7)).toBe('周日');
    expect(relativeDayLabel(3, 3)).toBe('今天');
    expect(relativeDayLabel(4, 3)).toBe('明天');
    expect(relativeDayLabel(5, 3)).toBe('周五');
  });
});

describe('课表 · 节次与时间', () => {
  it('作息表覆盖 1..12 节且起止自洽', () => {
    expect(SLOT_TIMES).toHaveLength(12);
    expect(SLOT_TIMES[0]).toEqual({ slot: 1, start: '08:15', end: '09:05' });
    for (const slot of SLOT_TIMES) {
      expect(slot.start < slot.end, `第 ${slot.slot} 节起止时间颠倒`).toBe(true);
    }
  });

  it('区间标签形如 08:15–09:05；越界节次退化成"第 x-y 节"而不是崩溃', () => {
    expect(slotRangeLabel(1, 2)).toBe('08:15–10:05');
    expect(slotRangeLabel(1, 99)).toBe('第 1-99 节');
  });
});

describe('课表 · 冲突检测', () => {
  it('相邻但不重叠不算冲突（第 1-2 节 vs 第 3-4 节）', () => {
    expect(
      findConflicts([
        course({ id: 'a', weekday: 1, startSlot: 1, endSlot: 2 }),
        course({ id: 'b', weekday: 1, startSlot: 3, endSlot: 4 }),
      ]),
    ).toHaveLength(0);
  });

  it('重叠会报出来，且带上双方课程名', () => {
    const conflicts = findConflicts([
      course({ id: 'a', weekday: 2, startSlot: 3, endSlot: 4, courseName: '线性代数' }),
      course({ id: 'b', weekday: 2, startSlot: 4, endSlot: 5, courseName: '机器学习导论' }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.a.courseName).toBe('线性代数');
    expect(conflicts[0]?.b.courseName).toBe('机器学习导论');
  });

  it('不同星期不互相干扰', () => {
    expect(
      findConflicts([
        course({ id: 'a', weekday: 1, startSlot: 1, endSlot: 2 }),
        course({ id: 'b', weekday: 2, startSlot: 1, endSlot: 2 }),
      ]),
    ).toHaveLength(0);
  });
});

describe('课表 · 「现在上什么 / 下一节」', () => {
  // 2026-10-12 是周一
  const monday = new Date(2026, 9, 12);

  const today = [
    course({ id: 'a', weekday: 1, startSlot: 1, endSlot: 2, courseName: '数据结构' }),
    course({ id: 'b', weekday: 1, startSlot: 3, endSlot: 4, courseName: '线性代数' }),
    course({ id: 'c', weekday: 1, startSlot: 7, endSlot: 8, courseName: '操作系统' }),
  ];

  it('课间：给出下一节课与真实等待分钟数', () => {
    // 09:20 仍在第 2 节（09:15–10:05）内，所以"正在上"是第一门课；
    // 下一节是 10:25 开始的线性代数 → 还有 65 分钟
    const moment = resolveMoment(today, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 9, 20));
    expect(moment.ongoing.map((item) => item.courseName)).toEqual(['数据结构']);
    expect(moment.next?.courseName).toBe('线性代数');
    expect(moment.minutesUntilNext).toBe(65);
    expect(moment.finishedForToday).toBe(false);
  });

  it('两节课之间（空档）：ongoing 为空但仍给出下一节', () => {
    // 10:10 —— 第 2 节 10:05 已下课，第 3 节 10:25 还没上
    const moment = resolveMoment(today, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 10, 10));
    expect(moment.ongoing).toHaveLength(0);
    expect(moment.next?.courseName).toBe('线性代数');
    expect(moment.minutesUntilNext).toBe(15);
  });

  it('正在上课：ongoing 命中且倒计时为 0', () => {
    // 08:30 在第 1 节（08:15–09:05）内
    const moment = resolveMoment(today, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 8, 30));
    expect(moment.ongoing.map((item) => item.courseName)).toEqual(['数据结构']);
    expect(moment.next?.courseName).toBe('线性代数');
    expect(moment.minutesUntilNext).toBe(115);
  });

  it('冲突时两门课都算"正在上"，而不是随机挑一门', () => {
    const overlapped = [
      course({ id: 'x', weekday: 1, startSlot: 5, endSlot: 6, courseName: '英语写作' }),
      course({ id: 'y', weekday: 1, startSlot: 6, endSlot: 7, courseName: '创新创业' }),
    ];
    const moment = resolveMoment(
      overlapped,
      new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 14, 30),
    );
    expect(moment.ongoing).toHaveLength(2);
  });

  it('全部上完：finishedForToday = true，next 为 null', () => {
    const moment = resolveMoment(today, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 23, 0));
    expect(moment.next).toBeNull();
    expect(moment.minutesUntilNext).toBeNull();
    expect(moment.finishedForToday).toBe(true);
  });

  it('今天本来就没课：finishedForToday = false（用来区分"没排课"和"上完了"）', () => {
    const moment = resolveMoment([], new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 10, 0));
    expect(moment.finishedForToday).toBe(false);
    expect(moment.next).toBeNull();
  });
});
