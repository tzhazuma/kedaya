/**
 * 校园卡 · campus-card（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface CampusCardTransactionModel {
  userId: string;
  amountFen: number;
  direction: string;
  merchant: string;
  happenedAt: Date;
  balanceAfterFen: number;
  createdAt: Date;
}

/** 创建输入。 * 归属字段 `userId` 在未登录时可由请求主体补全（见 service.create）。 */
export interface CreateCampusCardTransactionInput {
  userId: string;
  amountFen: number;
  direction: string;
  merchant: string;
  happenedAt: Date;
  balanceAfterFen: number;
}

/** 更新输入（全部可选） */
export interface UpdateCampusCardTransactionInput {
  userId?: string;
  amountFen?: number;
  direction?: string;
  merchant?: string;
  happenedAt?: Date;
  balanceAfterFen?: number;
}

/** 端口：service 只依赖本类型，实现见 data/campus-card.repository.ts */
export type CampusCardTransactionRepository = ResourceRepository<
  CampusCardTransactionModel,
  CreateCampusCardTransactionInput,
  UpdateCampusCardTransactionInput
> & {
  summarize(
    userId: string,
  ): Promise<{ totalOutFen: number; totalInFen: number; count: number }>;
};

export const CAMPUS_CARD_TRANSACTION_REPOSITORY = Symbol('KEDAYA_CAMPUS_CARD_TRANSACTION_REPOSITORY');
