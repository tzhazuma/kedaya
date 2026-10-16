/**
 * 场馆预约 · facility（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 14 个模块各写一套。
 */
import type { ResourceRepository } from '../../../common/crud/resource';

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface FacilityBookingModel {
  id: string;
  ownerId: string;
  kind: string;
  facilityName: string | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
  feeFen: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。 * 归属字段 `ownerId` 在未登录时可由请求主体补全（见 service.create）。 */
export interface CreateFacilityBookingInput {
  ownerId?: string;
  kind: string;
  facilityName?: string | null;
  startsAt: Date;
  endsAt: Date;
  status?: string;
  feeFen: number;
}

/** 更新输入（全部可选） */
export interface UpdateFacilityBookingInput {
  ownerId?: string;
  kind?: string;
  facilityName?: string | null;
  startsAt?: Date;
  endsAt?: Date;
  status?: string;
  feeFen?: number;
}

/** 端口：service 只依赖本类型，实现见 data/facility.repository.ts */
export type FacilityBookingRepository = ResourceRepository<
  FacilityBookingModel,
  CreateFacilityBookingInput,
  UpdateFacilityBookingInput
> & {
  findOverlapping(input: {
    kind: string;
    facilityName: string | null;
    startsAt: Date;
    endsAt: Date;
  }): Promise<FacilityBookingModel | null>;
};

export const FACILITY_BOOKING_REPOSITORY = Symbol('KEDAYA_FACILITY_BOOKING_REPOSITORY');
