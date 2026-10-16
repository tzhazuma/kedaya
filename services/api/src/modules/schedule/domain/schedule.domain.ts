/**
 * 课表 · schedule（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface ScheduleCourseModel {
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
  userId?: string;
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
};

export const SCHEDULE_COURSE_REPOSITORY = Symbol('KEDAYA_SCHEDULE_COURSE_REPOSITORY');
