import type { ResourceRepository } from '../../../common/crud/resource';

/**
 * 偷外卖 · takeout-guard（契约 §4 模块 id：`takeout-guard`）
 *
 * ⚠️ 本模块**已不再是脚手架生成的占位实现**：它是一条高名誉风险的垂直切片
 * （内容本质是"指控有人拿走了我的外卖"）。因此在一般 CRUD 之上多了四条安全约束，
 * 改本文件前请先读完：
 *
 *   1. **归属只来自 JWT**。`reporterId` 不在请求体里（`createSchema` 没有这个字段），
 *      由服务层用登录主体补全；`anonHandle` 也**不再由客户端决定** —— 本模块**不做匿名**，
 *      真有匿名诉求的场景是 `dorm-harmony`（那才是匿名模块，靠追踪码寻址）。
 *      这里保留 `anonHandle` 列只是不想为了删一个字段去改 Prisma 迁移。
 *   2. **记录是私有的**。列表强制 `reporterId = 当前登录用户`；详情 / 改 / 删 / 升级 /
 *      解决全部要求"这条是我的"，非本人一律 `NOT_FOUND`（连"存在但不是你的"都不透露）。
 *      订单号 + 取餐点 + 时间 + 经过组合起来足以识别到具体的人，所以**不存在**任何
 *      "看别人的举报"的合法路径。
 *   3. **状态机白名单**：`pending → escalated → resolved`。新建恒为 `pending`，
 *      请求体里没有 `status`，只能经 `POST /items/:id/escalate`、`/resolve` 两个领域动作跃迁。
 *   4. **写入字段白名单**。`UpdateTakeoutReportInput` 里没有 `status` / `reporterId`，
 *      因此 `PATCH` 无法绕过状态机去改归属或改状态。
 */

/**
 * 状态机（单向，不可回退）：
 *   pending   —— 已记录，等对方回应 / 自己先私下沟通
 *   escalated —— 已升级，请平台或辅导员协助（"升级处理"领域动作的目标态）
 *   resolved  —— 已解决（对方归还 / 事情已说清楚）
 */
export const TAKEOUT_REPORT_STATUS = {
  pending: 'pending',
  escalated: 'escalated',
  resolved: 'resolved',
} as const;
export type TakeoutReportStatus = (typeof TAKEOUT_REPORT_STATUS)[keyof typeof TAKEOUT_REPORT_STATUS];

/** 供 Zod `z.enum` 与 data 层 `buildWhere` 复用的白名单（客户端 `TAKEOUT_GUARD_STATUSES` 与之对齐） */
export const TAKEOUT_REPORT_STATUSES = [
  TAKEOUT_REPORT_STATUS.pending,
  TAKEOUT_REPORT_STATUS.escalated,
  TAKEOUT_REPORT_STATUS.resolved,
] as const;

/** 新建记录的初始状态。由服务层写入，客户端无法指定 */
export const TAKEOUT_REPORT_DEFAULT_STATUS: TakeoutReportStatus = TAKEOUT_REPORT_STATUS.pending;

/* 文本上限（与小程序 `domain/models/takeoutGuard.ts` 同值，客户端只做即时提示） */
export const TAKEOUT_ORDER_NO_MAX = 64;
export const TAKEOUT_PLACE_MAX = 60;
export const TAKEOUT_DETAIL_MAX = 1000;

/**
 * 发生时间允许的时钟偏差：5 分钟。
 *
 * 手机时钟略快不该导致提交失败；但"未来发生的外卖被拿错"没有意义，
 * 超出偏差一律拒绝（与 `lost-found` 同一套判定）。
 */
export const TAKEOUT_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface TakeoutReportModel {
  id: string;
  /** 记录人。永远来自 JWT；列可空只是为了兼容脚手架时期的遗留数据 */
  reporterId: string | null;
  /** 脚手架遗留列：本模块已不做匿名，客户端写入不了，保留列以避免动 Prisma 迁移 */
  anonHandle: string | null;
  /** 外卖订单号（列表页只展示后四位，见客户端 `orderNoTail`） */
  orderNo: string;
  /** 取餐点，例如「生活区 5 号楼一层外卖架」 */
  place: string;
  /** 发生时间 */
  happenedAt: Date;
  /** 经过描述（必填：说清楚发生了什么，是后续沟通的依据） */
  detail: string | null;
  /** 最多一张证据图（只可能是本平台上传的地址；上传时已剥离 EXIF GPS） */
  evidenceUrl: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 客户端可见的创建输入 —— **没有** `reporterId` / `anonHandle` / `status`。
 * 归属与初始状态由服务层决定，Zod schema 与它保持同形。
 */
export interface CreateTakeoutReportInput {
  orderNo: string;
  place: string;
  happenedAt: Date;
  detail: string;
  evidenceUrl?: string | null;
}

/** data 层落库用的完整输入：在客户端输入之上补上服务层决定的归属与状态 */
export interface TakeoutReportCreateRecord extends CreateTakeoutReportInput {
  reporterId: string;
  status: TakeoutReportStatus;
}

/**
 * 更新输入（全部可选）。
 *
 * 刻意**不含** `reporterId` / `status` / `anonHandle`：状态只能走领域动作，
 * 归属永远不可变（否则 `PATCH` 就成了绕过状态机与越权的口子）。
 */
export interface UpdateTakeoutReportInput {
  orderNo?: string;
  place?: string;
  happenedAt?: Date;
  detail?: string;
  evidenceUrl?: string | null;
}

/** 列表查询条件。`reporterId` 由服务层强制填成当前登录主体 */
export interface TakeoutReportListQuery {
  cursor?: string;
  limit: number;
  /** 强制来源：服务层从 JWT 取，调用方无法指定"别人的" reporterId */
  reporterId: string;
  /** 精确筛选状态（白名单） */
  status?: string;
}

/**
 * 端口：service 只依赖本类型，实现见 data/takeout-guard.repository.ts。
 *
 * 比通用 `ResourceRepository` 多一个 `applyStatus`：状态跃迁是**领域动作**，
 * 不走通用的 `update`（否则任何 `PATCH` 都能写 status，白名单就失去了意义）。
 */
export interface TakeoutReportRepository
  extends ResourceRepository<TakeoutReportModel, TakeoutReportCreateRecord, UpdateTakeoutReportInput> {
  /** 领域动作专用：由服务层校验状态机后调用 */
  applyStatus(id: string, status: TakeoutReportStatus): Promise<TakeoutReportModel>;
}

export const TAKEOUT_REPORT_REPOSITORY = Symbol('KEDAYA_TAKEOUT_REPORT_REPOSITORY');
