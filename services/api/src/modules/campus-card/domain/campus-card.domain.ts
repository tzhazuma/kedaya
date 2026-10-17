/**
 * 校园卡 · campus-card（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface CampusCardTransactionModel {
  /** 主键（早期 scaffold 漏了它，运行时其实一直返回；补回来以便按 id 引用流水） */
  id: string;
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
  /** 最近 N 笔（时间倒序）—— 缓存降级时用它渲染"上次成功的数据" */
  listRecent(userId: string, limit: number): Promise<CampusCardTransactionModel[]>;
  /**
   * 用上游快照**整体替换**本地缓存（一个事务内先删后插）。
   *
   * 为什么是整体替换：本表是上游的**缓存**，没有稳定主键，
   * 逐条 upsert 会在反复同步后留下幽灵流水（上游已撤销但本地还在）。
   * 替换保证「界面上的流水」与「卡里的流水」一致。
   */
  replaceAll(userId: string, rows: CreateCampusCardTransactionInput[]): Promise<number>;
  /** 最近一次成功写入缓存的时间（= 上次同步时间），无缓存为 null */
  lastCachedAt(userId: string): Promise<Date | null>;
};

export const CAMPUS_CARD_TRANSACTION_REPOSITORY = Symbol('KEDAYA_CAMPUS_CARD_TRANSACTION_REPOSITORY');
