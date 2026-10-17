/**
 * 常见问题 · faq（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface FaqEntryModel {
  /**
   * 游标分页与详情路由都要用到主键。
   *
   * 脚手架漏了它 —— 但 Prisma 行**总是**带 id，领域模型少写一个字段的后果
   * 是「列表拿不到 id、点不进详情」这类跑起来才发现的错，所以这里补齐。
   */
  id: string;
  question: string;
  answer: string;
  category: string;
  tags: string[];
  helpfulCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。 * 本模块支持匿名（无必填归属字段），实名身份与匿名 handle 解耦存储（契约 §9）。 */
export interface CreateFaqEntryInput {
  question: string;
  answer: string;
  category: string;
  tags?: string[];
  helpfulCount?: number;
}

/** 更新输入（全部可选） */
export interface UpdateFaqEntryInput {
  question?: string;
  answer?: string;
  category?: string;
  tags?: string[];
  helpfulCount?: number;
}

/** 端口：service 只依赖本类型，实现见 data/faq.repository.ts */
export type FaqEntryRepository = ResourceRepository<
  FaqEntryModel,
  CreateFaqEntryInput,
  UpdateFaqEntryInput
> & {
  markHelpful(id: string): Promise<FaqEntryModel>;
};

export const FAQ_ENTRY_REPOSITORY = Symbol('KEDAYA_FAQ_ENTRY_REPOSITORY');
