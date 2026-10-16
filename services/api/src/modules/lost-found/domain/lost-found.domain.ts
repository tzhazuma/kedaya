/**
 * 失物招领 · lost-found（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface LostFoundItemModel {
  id: string;
  reporterId: string;
  kind: string;
  title: string;
  description: string | null;
  place: string;
  happenedAt: Date;
  contactHint: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。 * 归属字段 `reporterId` 在未登录时可由请求主体补全（见 service.create）。 */
export interface CreateLostFoundItemInput {
  reporterId?: string;
  kind: string;
  title: string;
  description?: string | null;
  place: string;
  happenedAt: Date;
  contactHint?: string | null;
  status?: string;
}

/** 更新输入（全部可选） */
export interface UpdateLostFoundItemInput {
  reporterId?: string;
  kind?: string;
  title?: string;
  description?: string | null;
  place?: string;
  happenedAt?: Date;
  contactHint?: string | null;
  status?: string;
}

/** 端口：service 只依赖本类型，实现见 data/lost-found.repository.ts */
export type LostFoundItemRepository = ResourceRepository<
  LostFoundItemModel,
  CreateLostFoundItemInput,
  UpdateLostFoundItemInput
>;

export const LOST_FOUND_ITEM_REPOSITORY = Symbol('KEDAYA_LOST_FOUND_ITEM_REPOSITORY');
