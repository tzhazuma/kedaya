/**
 * TechPie 整合 · `techpie` 领域模型与仓储端口（契约 §2.9 + 规格 §5）
 *
 * 本文件是 **domain 层**：不 import Prisma、不 import Nest 运行时
 * （契约 §7 依赖方向 `domain ← data`）。
 *
 * ⚠️ 与脚手架占位形状的区别：占位模型是 `key/name/category/url` 的通用链接表，
 * 与"校园平台绑定"没有任何关系。本模块因此**已移出 `scripts/scaffold.mjs` 的
 * SPEC 表**（否则 `npm run scaffold` 会把这里的手写实现覆盖回占位形状）。
 */

import type { Page } from '@kedaya/contracts';
import {
  CAMPUS_PLATFORM_PHASE,
  assertBindingSummaryHasNoCredentialKeys,
  type CampusBindingSummary,
  type CampusPlatform,
  type TechpieLinkStatus,
} from './ports/campus-session.port';

/* ------------------------------------------------------------------ *
 * TechpieLink（契约 §2.9 + 规格 §5.1）
 * ------------------------------------------------------------------ */

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface TechpieLinkModel {
  id: string;
  userId: string;
  provider: CampusPlatform;
  status: TechpieLinkStatus;
  externalUserId: string | null;
  /**
   * 对端 token 密文。
   *
   * ⚠️ Phase 0 **没有任何写入者**（Gradescope/Hydro 的第三方 token 属 U13）。
   * 领域模型里保留它只是为了对齐契约 §2.9 的冻结字段；
   * 它**绝不**出现在任何响应里（`CampusBindingSummary` 里没有这个字段）。
   */
  tokenCipher: string | null;
  expiresAt: Date | null;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateTechpieLinkInput {
  userId: string;
  provider: CampusPlatform;
  status: TechpieLinkStatus;
  externalUserId?: string | null;
  expiresAt?: Date | null;
  lastSyncAt?: Date | null;
}

/** 更新输入（全部可选；`undefined` = 不改） */
export interface UpdateTechpieLinkInput {
  status?: TechpieLinkStatus;
  externalUserId?: string | null;
  expiresAt?: Date | null;
  lastSyncAt?: Date | null;
  deletedAt?: Date | null;
}

/** 分页查询参数（契约 §6.1：游标分页，不用 offset） */
export interface TechpieListParams {
  cursor?: string;
  limit: number;
}

/**
 * 领域模型 → **对外绑定摘要**（规格 §8.3 的唯一响应形状）。
 *
 * 逐字段显式挑选（不是解构 + 删除）：新增 Prisma 字段时**默认不会**进响应，
 * 因此"不小心把 `tokenCipher` 暴露出去"这种事故在结构上就不可能发生。
 * 返回前再跑一次运行时断言（I1 的镜像：摘要里绝不能出现 8 个禁用键名）。
 */
export function toBindingSummary(link: TechpieLinkModel): CampusBindingSummary {
  const summary: CampusBindingSummary = {
    id: link.id,
    platform: link.provider,
    status: link.status,
    externalUserId: link.externalUserId,
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    lastSyncAt: link.lastSyncAt ? link.lastSyncAt.toISOString() : null,
    phase: CAMPUS_PLATFORM_PHASE[link.provider] ?? 'phase1',
  };
  assertBindingSummaryHasNoCredentialKeys(summary);
  return summary;
}

export interface TechpieLinkRepository {
  listByUser(userId: string, params: TechpieListParams): Promise<Page<TechpieLinkModel>>;
  findById(id: string): Promise<TechpieLinkModel | null>;
  findByUserAndProvider(userId: string, provider: CampusPlatform): Promise<TechpieLinkModel | null>;
  create(input: CreateTechpieLinkInput): Promise<TechpieLinkModel>;
  update(id: string, input: UpdateTechpieLinkInput): Promise<TechpieLinkModel>;
  /** 解绑用**软删**（保留审计线索）；凭证副本由 `CampusSessionPort.unbind` **硬删**。 */
  softDelete(id: string): Promise<void>;
}

export const TECHPIE_LINK_REPOSITORY = Symbol('KEDAYA_TECHPIE_LINK_REPOSITORY');

/* ------------------------------------------------------------------ *
 * TechpieSyncJob（契约 §2.9 + 规格 §5.2）
 * ------------------------------------------------------------------ */

export type TechpieSyncJobKind = 'pull_schedule' | 'pull_deadline' | 'push_post';
export type TechpieSyncJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

export interface TechpieSyncJobModel {
  id: string;
  linkId: string;
  kind: string;
  status: string;
  attempts: number;
  /** ⚠️ **必须脱敏**（规格 §10.3）：不得含 cookie / token / 密码 */
  lastError: string | null;
  nextRetryAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTechpieSyncJobInput {
  linkId: string;
  kind: TechpieSyncJobKind;
  status?: TechpieSyncJobStatus;
  lastError?: string | null;
  nextRetryAt?: Date | null;
}

export interface TechpieSyncJobRepository {
  /** 我的全部同步任务（跨 link，游标分页） */
  listByUser(userId: string, params: TechpieListParams): Promise<Page<TechpieSyncJobModel>>;
  create(input: CreateTechpieSyncJobInput): Promise<TechpieSyncJobModel>;
}

export const TECHPIE_SYNC_JOB_REPOSITORY = Symbol('KEDAYA_TECHPIE_SYNC_JOB_REPOSITORY');
