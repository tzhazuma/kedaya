/**
 * TechPie 整合 · `techpie` 领域模型与仓储端口（契约 §2.9 + 规格 §5）
 *
 * 本文件是 **domain 层**：不 import Prisma、不 import Nest 运行时
 * （契约 §7 依赖方向 `domain ← data`）。
 *
 * ⚠️ 与脚手架占位形状的区别：占位模型是 `key/name/category/url` 的通用链接表，
 * 与"校园平台绑定"没有任何关系。本模块因此**已移出 `scripts/scaffold.mjs` 的
 * SPEC 表**（否则 `npm run scaffold` 会把这里的手写实现覆盖回占位形状）。
 *
 * ## 三种形状，三个名字（契约 §11.20-A / B）
 *
 * | 名字 | 层 | 说明 |
 * | --- | --- | --- |
 * | `TechpieLinkModel` | 领域/持久化 | 与 Prisma 行一一对应，**含** `tokenCipher` |
 * | `CampusBindingState` | port | `CampusSessionPort` 的返回类型（`ports/campus-session.port.ts`） |
 * | `TechpieLink` | **wire** | `GET /techpie/links` 的元素（本文件） |
 *
 * 冻结 OpenAPI 的 `TechpieLink` 是 `/techpie/links` 的 wire 类型；
 * `CampusBindingSummary` **只属于** `/auth/campus-bindings`（§11.19-C）。
 *
 * ## ⚠️ 投影为什么先过一个窄输入类型
 *
 * `toTechpieLink` **不**直接接受 `TechpieLinkModel`（数据库模型）：
 * 那会让视图转换器**绑死在 DB 模型**上，于是当 `CampusSessionPort.bind()`
 * 返回**端口**类型 `CampusBindingState` 时就类型不兼容 ——
 * 而端口层与视图层本来就是两个层。
 * 现在转换器只依赖 `TechpieLinkViewInput`，两个来源各有一个适配器：
 * `linkModelToViewInput`（读库）与 `bindingStateToViewInput`（绑定/续期刚返回）。
 */

import type { Page } from '@kedaya/contracts';
import {
  CAMPUS_PLATFORM_LABEL,
  CAMPUS_PLATFORM_PHASE,
  assertNoCredentialKeys,
  type CampusBindingState,
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
   * 它**绝不**出现在任何响应里（`TechpieLink` 里没有这个字段）。
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
 * **wire** 类型：`GET /techpie/links` 的元素（冻结 OpenAPI `TechpieLink`）。
 *
 * ⚠️ 字段名裁决：
 *   · 用 **`provider`**（**不是** `platform`）—— §11.20-A + §11.20-C 的冻结枚举；
 *   · `status` 用 **`PENDING | ACTIVE | EXPIRED | REVOKED | FAILED`** —— §11.19-A；
 *   · **不含** `tokenCipher` / `externalUserId` 等任何对端标识或凭证。
 *
 * ⚠️ §11.22-D 通用规则：**可空的可选字段为空时省略键，而不是下发 `null`**。
 * 因此 `boundAt` / `expiresAt` / `lastSyncAt` 取不到值时**整个键都不出现**
 * （例如 `bind()` 刚返回的**端口**类型没有 `createdAt`，那是 DB 概念 ——
 * 这时**不编造**一个绑定时刻）。
 */
export interface TechpieLink {
  id: string;
  provider: CampusPlatform;
  status: TechpieLinkStatus;
  /** 面向用户的可读名（如「校园一卡通」）；服务端给，客户端不自造 */
  displayName: string;
  /** 绑定建立时刻（读库时有值；绑定刚成功时可能没有） */
  boundAt?: string;
  expiresAt?: string;
  lastSyncAt?: string;
  phase: string;
}

/** 省略 `undefined` / `null` 的可选键 —— §11.22-D 的唯一实现处 */
function withOptional<T extends object>(base: T, optional: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined && value !== null) (base as Record<string, unknown>)[key] = value;
  }
  return base;
}

/**
 * 领域模型 → **port 类型** `CampusBindingState`。
 *
 * 逐字段显式挑选（不是解构 + 删除）：新增 Prisma 字段时**默认不会**进投影，
 * 因此"不小心把 `tokenCipher` 暴露出去"这种事故在结构上就不可能发生。
 * 返回前再跑一次运行时断言（I1 的镜像：身份侧投影里绝不能出现 8 个禁用键名）。
 */
export function toCampusBindingState(link: TechpieLinkModel): CampusBindingState {
  const state: CampusBindingState = {
    id: link.id,
    provider: link.provider,
    status: link.status,
    externalUserId: link.externalUserId,
    expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
    lastSyncAt: link.lastSyncAt ? link.lastSyncAt.toISOString() : null,
    phase: CAMPUS_PLATFORM_PHASE[link.provider] ?? 'phase1',
  };
  assertNoCredentialKeys(state);
  return state;
}

/**
 * `toTechpieLink` 的输入 —— **只包含视图需要的字段**（见文件头的说明）。
 */
export interface TechpieLinkViewInput {
  id: string;
  provider: CampusPlatform;
  status: TechpieLinkStatus;
  /** 绑定时刻；端口类型没有这个字段时传 `null`（视图里 `boundAt` 会被**省略**） */
  boundAt: Date | null;
  expiresAt: Date | null;
  lastSyncAt: Date | null;
}

/**
 * 视图输入 → **wire 类型** `TechpieLink`（`/techpie/links` 的**唯一**投影实现）。
 *
 * ⚠️ `ticket` 是 I1 的禁用键之一，但 I1 的**精确化措辞**（§11.22-A）只约束
 * `KedaYaIdentitySession` 与 `/auth/*` 的响应 —— 本条端点在 `/techpie/*`，
 * 因此这里跑的是"**没有**对端标识/凭证"的字段白名单，而不是禁用键扫描。
 * 逐字段挑选本身就是保证：`externalUserId` 与 `tokenCipher` 都没有出口。
 */
export function toTechpieLink(input: TechpieLinkViewInput): TechpieLink {
  return withOptional<TechpieLink>(
    {
      id: input.id,
      provider: input.provider,
      status: input.status,
      displayName: CAMPUS_PLATFORM_LABEL[input.provider] ?? input.provider,
      phase: CAMPUS_PLATFORM_PHASE[input.provider] ?? 'phase1',
    },
    {
      boundAt: input.boundAt ? input.boundAt.toISOString() : undefined,
      expiresAt: input.expiresAt ? input.expiresAt.toISOString() : undefined,
      lastSyncAt: input.lastSyncAt ? input.lastSyncAt.toISOString() : undefined,
    },
  );
}

/** 适配器：DB 模型 → 视图输入（读库路径） */
export function linkModelToViewInput(link: TechpieLinkModel): TechpieLinkViewInput {
  return {
    id: link.id,
    provider: link.provider,
    status: link.status,
    boundAt: link.createdAt,
    expiresAt: link.expiresAt,
    lastSyncAt: link.lastSyncAt,
  };
}

/** 适配器：端口类型 → 视图输入（绑定 / 续期刚返回的路径） */
export function bindingStateToViewInput(state: CampusBindingState): TechpieLinkViewInput {
  return {
    id: state.id,
    provider: state.provider,
    status: state.status,
    // 端口类型没有 `createdAt`（DB 概念）—— 不编造绑定时刻（§11.22-D：为空省略键）
    boundAt: null,
    expiresAt: state.expiresAt ? new Date(state.expiresAt) : null,
    lastSyncAt: state.lastSyncAt ? new Date(state.lastSyncAt) : null,
  };
}

/** `TechpieLinkModel` → wire（`/techpie/links` 列表与详情的投影入口） */
export function toTechpieLinkFromModel(link: TechpieLinkModel): TechpieLink {
  return toTechpieLink(linkModelToViewInput(link));
}

/** `CampusBindingState` → wire（绑定 / 续期刚返回时的投影入口） */
export function toTechpieLinkFromBindingState(state: CampusBindingState): TechpieLink {
  return toTechpieLink(bindingStateToViewInput(state));
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
