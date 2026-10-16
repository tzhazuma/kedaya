/**
 * 跑腿 · errand（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface ErrandTaskModel {
  id: string;
  requesterId: string;
  runnerId: string | null;
  title: string;
  detail: string | null;
  rewardFen: number;
  fromPlace: string;
  toPlace: string;
  deadline: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。 * 归属字段 `requesterId` 在未登录时可由请求主体补全（见 service.create）。 */
export interface CreateErrandTaskInput {
  requesterId?: string;
  runnerId?: string | null;
  title: string;
  detail?: string | null;
  rewardFen: number;
  fromPlace: string;
  toPlace: string;
  deadline: Date;
  status?: string;
}

/** 更新输入（全部可选） */
export interface UpdateErrandTaskInput {
  requesterId?: string;
  runnerId?: string | null;
  title?: string;
  detail?: string | null;
  rewardFen?: number;
  fromPlace?: string;
  toPlace?: string;
  deadline?: Date;
  status?: string;
}

/** 端口：service 只依赖本类型，实现见 data/errand.repository.ts */
export type ErrandTaskRepository = ResourceRepository<
  ErrandTaskModel,
  CreateErrandTaskInput,
  UpdateErrandTaskInput
>;

export const ERRAND_TASK_REPOSITORY = Symbol('KEDAYA_ERRAND_TASK_REPOSITORY');
