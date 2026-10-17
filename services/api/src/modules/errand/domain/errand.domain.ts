import type { Page } from '@kedaya/contracts';

/**
 * 跑腿 · errand（契约 §4 模块 id：`errand`）
 *
 * ⚠️ 本模块**不再是脚手架生成的占位实现**：它已经承载真实的领域规则
 * （归属校验、状态机、筛选与搜索）。请直接改本文件，不要重跑 `npm run scaffold`。
 *
 * 安全基线（所有模块统一）：
 *   1. `requesterId` **永远**来自 JWT 解出的主体，不接受请求体传入 —— 否则任何人
 *      都能以别人的名义发布任务；
 *   2. 改 / 删 / 接单 / 送达 / 完成 / 取消都只允许对应的角色；
 *   3. 状态机由服务层强制，非法跃迁返回 CONFLICT 而不是静默改写。
 */

/** 状态机：open → accepted → delivered → completed；cancelled 为终态 */
export const ERRAND_STATUS = {
  open: 'open',
  accepted: 'accepted',
  delivered: 'delivered',
  completed: 'completed',
  cancelled: 'cancelled',
} as const;
export type ErrandStatus = (typeof ERRAND_STATUS)[keyof typeof ERRAND_STATUS];

/** 供 Zod `z.enum` 复用的状态白名单 */
export const ERRAND_STATUSES = [
  ERRAND_STATUS.open,
  ERRAND_STATUS.accepted,
  ERRAND_STATUS.delivered,
  ERRAND_STATUS.completed,
  ERRAND_STATUS.cancelled,
] as const;

/** 排序方式（默认最新） */
export const ERRAND_SORTS = ['latest', 'reward-desc', 'deadline'] as const;
export type ErrandSort = (typeof ERRAND_SORTS)[number];

/** 单笔悬赏上限：1000 元（分）—— 跑腿是校园内的轻量互助，防止误填出荒谬金额 */
export const ERRAND_MAX_REWARD_FEN = 100_000;

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface ErrandTaskModel {
  id: string;
  requesterId: string;
  /** 接单者，未接单为 null */
  runnerId: string | null;
  title: string;
  detail: string | null;
  /** 悬赏，单位 **分**（契约 §6.1 硬规则：金额不用浮点） */
  rewardFen: number;
  fromPlace: string;
  toPlace: string;
  deadline: Date;
  status: string;
  acceptedAt: Date | null;
  deliveredAt: Date | null;
  settledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 创建输入。`requesterId` 由服务层从登录主体补全，客户端传了也会被忽略。 */
export interface CreateErrandTaskInput {
  requesterId?: string;
  title: string;
  detail?: string | null;
  rewardFen: number;
  fromPlace: string;
  toPlace: string;
  deadline: Date;
}

/** 更新输入（全部可选；不允许改 requesterId / status —— 状态只能走领域动作） */
export interface UpdateErrandTaskInput {
  title?: string;
  detail?: string | null;
  rewardFen?: number;
  fromPlace?: string;
  toPlace?: string;
  deadline?: Date;
}

/**
 * 状态机可写的字段集合。
 *
 * 单独开 `applyState`（而不是塞进 `update`）是为了让「客户端可改的字段」
 * 与「状态动作可改的字段」在类型层面就分开，避免将来有人从 `update`
 * 把 `status` 传进来绕过状态机。
 */
export interface ErrandStatePatch {
  status: ErrandStatus;
  runnerId?: string | null;
  acceptedAt?: Date | null;
  deliveredAt?: Date | null;
  settledAt?: Date | null;
}

/** 列表查询条件 */
export interface ErrandTaskListQuery {
  cursor?: string;
  limit: number;
  status?: string;
  /** 标题 / 明细模糊搜索 */
  keyword?: string;
  fromPlace?: string;
  toPlace?: string;
  /** 我发布的任务（`mine=1` / `role=requester` 由服务层填成当前用户） */
  requesterId?: string;
  /** 我接下的任务（`role=runner` 由服务层填成当前用户） */
  runnerId?: string;
  sort: ErrandSort;
}

/** 端口：service 只依赖本类型，实现见 data/errand.repository.ts */
export interface ErrandTaskRepository {
  list(query: ErrandTaskListQuery): Promise<Page<ErrandTaskModel>>;
  create(input: CreateErrandTaskInput & { requesterId: string }): Promise<ErrandTaskModel>;
  findById(id: string): Promise<ErrandTaskModel | null>;
  update(id: string, input: UpdateErrandTaskInput): Promise<ErrandTaskModel>;
  applyState(id: string, patch: ErrandStatePatch): Promise<ErrandTaskModel>;
  remove(id: string): Promise<void>;
}

export const ERRAND_TASK_REPOSITORY = Symbol('KEDAYA_ERRAND_TASK_REPOSITORY');
