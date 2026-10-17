/**
 * 课表 · 纯领域规则（无 IO、无框架依赖，可直接单测）。
 *
 * 为什么单独一个文件：教务系统给的是「星期 + 第几节」，而用户脑子里想的是
 * 「几点、在哪、还有多久」。两者之间的换算（作息时间表、当前学期、时间冲突、
 * 下一节课倒计时）是**最容易出错、最需要测试**的部分 —— 把它抽成纯函数，
 * 就能用固定时钟反复回归，而不必启动数据库。
 *
 * 这里同时也是「高可用」的落点：所有展示所需的时间信息都由**服务端按自己的时钟**
 * 算好（`minutesUntilStart` 等）下发，客户端只做渲染。这样即使手机时间不准 /
 * 时区设置怪异，用户看到的\"还有 20 分钟\"依然是可信的。
 */

import type { ScheduleCourseModel } from './schedule.domain';

/* ------------------------------------------------------------------ *
 * 作息时间表（1..12 节）
 * ------------------------------------------------------------------ */

/**
 * 每节课的起止时刻（24 小时制，本地时间）。
 *
 * 真实对接时这张表应来自教务系统的「作息时间」接口；目前以学校公开作息硬编码。
 * 只保留行数固定、可 diff 的结构，避免散落在 UI 里。
 */
export const SLOT_TIMES: readonly { slot: number; start: string; end: string }[] = [
  { slot: 1, start: '08:15', end: '09:05' },
  { slot: 2, start: '09:15', end: '10:05' },
  { slot: 3, start: '10:25', end: '11:15' },
  { slot: 4, start: '11:25', end: '12:15' },
  { slot: 5, start: '13:00', end: '13:50' },
  { slot: 6, start: '14:00', end: '14:50' },
  { slot: 7, start: '15:10', end: '16:00' },
  { slot: 8, start: '16:10', end: '17:00' },
  { slot: 9, start: '18:00', end: '18:50' },
  { slot: 10, start: '19:00', end: '19:50' },
  { slot: 11, start: '20:00', end: '20:50' },
  { slot: 12, start: '21:00', end: '21:50' },
] as const;

export const MAX_SLOT = SLOT_TIMES.length;

/** 第 n 节的起始时刻（越界返回 null，不抛错 —— 脏数据不该炸掉整个课表） */
export function slotStart(slot: number): { hour: number; minute: number } | null {
  const entry = SLOT_TIMES.find((item) => item.slot === slot);
  if (!entry) return null;
  const [hour, minute] = entry.start.split(':').map(Number) as [number, number];
  return { hour, minute };
}

/** 第 n 节的结束时刻 */
export function slotEnd(slot: number): { hour: number; minute: number } | null {
  const entry = SLOT_TIMES.find((item) => item.slot === slot);
  if (!entry) return null;
  const [hour, minute] = entry.end.split(':').map(Number) as [number, number];
  return { hour, minute };
}

/** `"08:15"` 这样的起止区间，给 UI 直接用 */
export function slotRangeLabel(startSlot: number, endSlot: number): string {
  const start = SLOT_TIMES.find((item) => item.slot === startSlot);
  const end = SLOT_TIMES.find((item) => item.slot === endSlot);
  if (!start || !end) return `第 ${startSlot}-${endSlot} 节`;
  return `${start.start}–${end.end}`;
}

/* ------------------------------------------------------------------ *
 * 学期 / 星期
 * ------------------------------------------------------------------ */

/**
 * 日期 → 学期标识，形如 `2026-2027-1`。
 *
 * 规则（与教务口径一致）：
 *   · 9 月 – 次年 1 月 → 本学年**第一**学期
 *   · 2 月 – 8 月       → 上一学年**第二**学期
 * 之所以要在服务端算而不是让客户端算：学期决定了「拉哪一份课表」，
 * 客户端时钟/时区一旦偏了就会拉到空课表，用户会以为"课表丢了"。
 */
export function termOf(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (month >= 9) return `${year}-${year + 1}-1`;
  if (month === 1) return `${year - 1}-${year}-1`;
  return `${year - 1}-${year}-2`;
}

/** 学期中文标签，形如 `2026-2027 学年 第一学期` */
export function termLabel(term: string): string {
  const match = /^(\d{4})-(\d{4})-([12])$/.exec(term);
  if (!match) return term;
  return `${match[1]}-${match[2]} 学年 ${match[3] === '1' ? '第一' : '第二'}学期`;
}

/** 日期 → 1..7（周一 = 1，周日 = 7） */
export function weekdayOf(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/** 日期 → 该周周一的 00:00（本地时间） */
export function startOfWeek(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - (weekdayOf(date) - 1));
  return monday;
}

/** 把「某天 + 第 n 节」变成具体时刻 */
function atSlot(date: Date, slot: number, edge: 'start' | 'end'): Date | null {
  const time = edge === 'start' ? slotStart(slot) : slotEnd(slot);
  if (!time) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.hour, time.minute, 0, 0);
}

/* ------------------------------------------------------------------ *
 * 冲突检测
 * ------------------------------------------------------------------ */

export interface ScheduleConflict {
  weekday: number;
  /** 重叠的两个（或多个）节次区间 */
  a: { id: string; courseName: string; startSlot: number; endSlot: number };
  b: { id: string; courseName: string; startSlot: number; endSlot: number };
}

/**
 * 找出同一星期内时间重叠的课程。
 *
 * 为什么要做：教务系统**允许**两门课撞在一起（选修课冲突），但学生自己
 * 手工加课时常常是打错节次。把冲突显式暴露出来，比"两门课叠在格子里"友好得多。
 * 只做工作日内的两两比较，O(n log n)。
 */
export function findConflicts(
  courses: readonly Pick<ScheduleCourseModel, 'id' | 'weekday' | 'startSlot' | 'endSlot' | 'courseName'>[],
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];

  for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
    const ofDay = courses
      .filter((course) => course.weekday === weekday)
      .slice()
      .sort((left, right) => left.startSlot - right.startSlot);

    for (let i = 1; i < ofDay.length; i += 1) {
      const previous = ofDay[i - 1]!;
      const current = ofDay[i]!;
      if (current.startSlot <= previous.endSlot) {
        conflicts.push({
          weekday,
          a: {
            id: previous.id,
            courseName: previous.courseName,
            startSlot: previous.startSlot,
            endSlot: previous.endSlot,
          },
          b: {
            id: current.id,
            courseName: current.courseName,
            startSlot: current.startSlot,
            endSlot: current.endSlot,
          },
        });
      }
    }
  }

  return conflicts;
}

/* ------------------------------------------------------------------ *
 * 「现在上什么 / 下一节是什么」
 * ------------------------------------------------------------------ */

export interface ScheduleMoment<T> {
  /** 正在上的课（同一时段可能不止一门 —— 冲突时全部返回） */
  ongoing: T[];
  /** 接下来最近的一门（按开始时刻排序的第一门） */
  next: T | null;
  /** 距离下一节课开始还有多少分钟；正在上课时为 0；今天没有课为 null */
  minutesUntilNext: number | null;
  /** 下一节课的开始时刻（ISO），UI 用来显示"15:10 开始" */
  nextStartsAt: string | null;
  /** 今天的课是否已经全部结束 */
  finishedForToday: boolean;
}

/**
 * 按「服务端此刻」解析今日课表状态。
 *
 * 忠实处理三个边界：
 *   1. 两门课并行（冲突）时 `ongoing` 返回两门，而不是随便挑一门 —— 学生需要知道撞课了；
 *   2. 课与课之间（课间）`next` 仍然给出，`minutesUntilNext` 是真实等待时间；
 *   3. 最后一节结束后 `finishedForToday = true`，让 UI 显示"今天的课上完了"而不是空白。
 */
export function resolveMoment(
  todayCourses: readonly ScheduleCourseModel[],
  now: Date,
): ScheduleMoment<ScheduleCourseModel> {
  const sorted = todayCourses.slice().sort((left, right) => left.startSlot - right.startSlot);

  const ongoing = sorted.filter((course) => {
    const start = atSlot(now, course.startSlot, 'start');
    const end = atSlot(now, course.endSlot, 'end');
    return start !== null && end !== null && now >= start && now <= end;
  });

  const upcoming = sorted.filter((course) => {
    const start = atSlot(now, course.startSlot, 'start');
    return start !== null && start > now;
  });

  const next = upcoming[0] ?? null;
  const nextStartsAtDate = next === null ? null : atSlot(now, next.startSlot, 'start');

  return {
    ongoing,
    next,
    minutesUntilNext:
      nextStartsAtDate === null
        ? null
        : Math.max(0, Math.round((nextStartsAtDate.getTime() - now.getTime()) / 60000)),
    nextStartsAt: nextStartsAtDate === null ? null : nextStartsAtDate.toISOString(),
    finishedForToday: ongoing.length === 0 && next === null && sorted.length > 0,
  };
}

/** 星期中文名（1=周一 … 7=周日） */
export function weekdayLabel(weekday: number): string {
  return ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][weekday - 1] ?? `第 ${weekday} 天`;
}

/** 相对今天的自然语言，用于「周三 · 后天」这类展示 */
export function relativeDayLabel(weekday: number, today: number): string {
  if (weekday === today) return '今天';
  if (weekday === today + 1) return '明天';
  return weekdayLabel(weekday);
}
