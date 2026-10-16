/**
 * TechPie 整合 · techpie（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface TechpieLinkModel {
  key: string;
  name: string;
  category: string;
  url: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。 * 本模块支持匿名（无必填归属字段），实名身份与匿名 handle 解耦存储（契约 §9）。 */
export interface CreateTechpieLinkInput {
  key: string;
  name: string;
  category: string;
  url: string;
  status?: string;
}

/** 更新输入（全部可选） */
export interface UpdateTechpieLinkInput {
  key?: string;
  name?: string;
  category?: string;
  url?: string;
  status?: string;
}

/** 端口：service 只依赖本类型，实现见 data/techpie.repository.ts */
export type TechpieLinkRepository = ResourceRepository<
  TechpieLinkModel,
  CreateTechpieLinkInput,
  UpdateTechpieLinkInput
>;

export const TECHPIE_LINK_REPOSITORY = Symbol('KEDAYA_TECHPIE_LINK_REPOSITORY');
