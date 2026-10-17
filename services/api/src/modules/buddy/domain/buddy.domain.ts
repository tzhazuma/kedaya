/**
 * 找搭子 · buddy（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface BuddyGroupModel {
  ownerId: string;
  activity: string;
  title: string;
  campusSpot: string;
  startsAt: Date;
  capacity: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。 * 归属字段 `ownerId` 在未登录时可由请求主体补全（见 service.create）。 */
export interface CreateBuddyGroupInput {
  ownerId: string;
  activity: string;
  title: string;
  campusSpot: string;
  startsAt: Date;
  capacity: number;
  status?: string;
}

/** 更新输入（全部可选） */
export interface UpdateBuddyGroupInput {
  ownerId?: string;
  activity?: string;
  title?: string;
  campusSpot?: string;
  startsAt?: Date;
  capacity?: number;
  status?: string;
}

/** 端口：service 只依赖本类型，实现见 data/buddy.repository.ts */
export type BuddyGroupRepository = ResourceRepository<
  BuddyGroupModel,
  CreateBuddyGroupInput,
  UpdateBuddyGroupInput
>;

export const BUDDY_GROUP_REPOSITORY = Symbol('KEDAYA_BUDDY_GROUP_REPOSITORY');
