/**
 * 猫鸟黑天鹅 · wildlife（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface WildlifeSpotModel {
  species: string;
  place: string;
  lat: number;
  lng: number;
  note: string | null;
  reportedBy: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。 * 本模块支持匿名（无必填归属字段），实名身份与匿名 handle 解耦存储（契约 §9）。 */
export interface CreateWildlifeSpotInput {
  species: string;
  place: string;
  lat: number;
  lng: number;
  note?: string | null;
  reportedBy?: string | null;
  status?: string;
}

/** 更新输入（全部可选） */
export interface UpdateWildlifeSpotInput {
  species?: string;
  place?: string;
  lat?: number;
  lng?: number;
  note?: string | null;
  reportedBy?: string | null;
  status?: string;
}

/** 端口：service 只依赖本类型，实现见 data/wildlife.repository.ts */
export type WildlifeSpotRepository = ResourceRepository<
  WildlifeSpotModel,
  CreateWildlifeSpotInput,
  UpdateWildlifeSpotInput
>;

export const WILDLIFE_SPOT_REPOSITORY = Symbol('KEDAYA_WILDLIFE_SPOT_REPOSITORY');
