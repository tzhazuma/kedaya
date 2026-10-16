/**
 * 拼单 · groupbuy（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface GroupbuyOrderModel {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  category: string;
  targetCount: number;
  unitPriceFen: number;
  status: string;
  deadline: Date;
  pickupSpot: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。 * 归属字段 `ownerId` 在未登录时可由请求主体补全（见 service.create）。 */
export interface CreateGroupbuyOrderInput {
  ownerId?: string;
  title: string;
  description?: string | null;
  category: string;
  targetCount: number;
  unitPriceFen: number;
  status?: string;
  deadline: Date;
  pickupSpot?: string | null;
}

/** 更新输入（全部可选） */
export interface UpdateGroupbuyOrderInput {
  ownerId?: string;
  title?: string;
  description?: string | null;
  category?: string;
  targetCount?: number;
  unitPriceFen?: number;
  status?: string;
  deadline?: Date;
  pickupSpot?: string | null;
}

/** 端口：service 只依赖本类型，实现见 data/groupbuy.repository.ts */
export type GroupbuyOrderRepository = ResourceRepository<
  GroupbuyOrderModel,
  CreateGroupbuyOrderInput,
  UpdateGroupbuyOrderInput
> & {
  join(
    orderId: string,
    userId: string,
    quantity: number,
  ): Promise<{ memberId: string; quantity: number }>;
  memberCount(orderId: string): Promise<number>;
};

export const GROUPBUY_ORDER_REPOSITORY = Symbol('KEDAYA_GROUPBUY_ORDER_REPOSITORY');
