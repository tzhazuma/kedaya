/**
 * 课表 · schedule（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface ScheduleCourseModel {
  /**
   * 主键。
   *
   * 注意：早期 scaffold 生成的模型**漏了 id**（类型上说没有，运行时其实有），
   * 导致 service 层无法按 id 引用课程（详情/编辑/冲突提示都要用）。
   * 这里补回来，与已交付模块（flea-market / lost-found 等）保持一致。
   */
  id: string;
  userId: string;
  term: string;
  courseName: string;
  teacher: string | null;
  location: string | null;
  weekday: number;
  startSlot: number;
  endSlot: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。 * 归属字段 `userId` 在未登录时可由请求主体补全（见 service.create）。 */
export interface CreateScheduleCourseInput {
  userId: string;
  term: string;
  courseName: string;
  teacher?: string | null;
  location?: string | null;
  weekday: number;
  startSlot: number;
  endSlot: number;
}

/** 更新输入（全部可选） */
export interface UpdateScheduleCourseInput {
  userId?: string;
  term?: string;
  courseName?: string;
  teacher?: string | null;
  location?: string | null;
  weekday?: number;
  startSlot?: number;
  endSlot?: number;
}

/** 端口：service 只依赖本类型，实现见 data/schedule.repository.ts */
export type ScheduleCourseRepository = ResourceRepository<
  ScheduleCourseModel,
  CreateScheduleCourseInput,
  UpdateScheduleCourseInput
> & {
  listByWeekday(term: string, weekday: number): Promise<ScheduleCourseModel[]>;
  /** 某人某学期的全部课程（课表页一次拉齐，避免按天请求 7 次） */
  listByUserTerm(userId: string, term: string): Promise<ScheduleCourseModel[]>;
  /** 某人有过课表的学期列表（供"查看往期课表"） */
  listTerms(userId: string): Promise<string[]>;
  /**
   * 用教务系统的一份课表**整体替换**某人某学期的课程。
   *
   * 为什么是"替换"而不是"逐条 upsert"：教务的课表没有稳定主键
   * （同一门课换个老师就是新行），逐条 upsert 会在反复同步后留下
   * 一堆"已删但没删掉"的幽灵课程。整体替换保证 DB 与教务完全一致，
   * 且必须在一个事务里完成（否则中途失败会得到半份课表）。
   */
  replaceTerm(userId: string, term: string, courses: CreateScheduleCourseInput[]): Promise<number>;
};

export const SCHEDULE_COURSE_REPOSITORY = Symbol('KEDAYA_SCHEDULE_COURSE_REPOSITORY');
