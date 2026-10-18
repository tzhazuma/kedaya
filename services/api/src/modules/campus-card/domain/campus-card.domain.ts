/**
 * 校园卡 · campus-card（契约 §11.21-B 的正式形状）
 *
 * ⚠️ 本文件**不再是** `scripts/scaffold.mjs` 生成的通用 CRUD 形状。
 * 裁决 §11.21-B 的原话：`campus-card` 目前是脚手架生成的通用 CRUD
 * （`items` + `summary`，而 `summary` 是**汇总**不是余额；`direction: 'out'|'in'`；
 * 字段 `happenedAt`），**没有** 开通 / 余额 / 流水 / 付款码 的路由。
 * **裁决：校园卡按以下形状定契约。**
 *
 * ## 字段名裁决（取代 scaffold 形状）
 *
 * | 旧（scaffold） | 新（裁决） | 理由 |
 * | --- | --- | --- |
 * | `direction: 'out' \| 'in'` | **`DEBIT` \| `CREDIT`** | `out`/`in` 有**方向歧义**（"out" 是从谁的角度？）；大写与全仓其它枚举一致 |
 * | `happenedAt` | **`occurredAt`** | 与全仓 `observedAt`/`startsAt`/`createdAt` 一致：**交易发生时刻 vs 入库时刻**（§11.10-A） |
 * | `summary`（汇总） | **`balanceFen`**（余额） | "汇总"与"余额"是两个概念 |
 *
 * **金额一律整数分**（`amountFen` / `balanceFen` / `balanceAfterFen`，契约 §6.1）。
 *
 * 本文件是 **domain 层**：不 import Prisma、不 import Nest 运行时（契约 §7）。
 */

import type { Page } from '@kedaya/contracts';

/* ------------------------------------------------------------------ *
 * 领域模型
 * ------------------------------------------------------------------ */

/** 流水方向（契约 §11.21-B：**大写** `DEBIT` / `CREDIT`，不是 `out` / `in`） */
export type CampusCardDirection = 'DEBIT' | 'CREDIT';

export const CAMPUS_CARD_DIRECTIONS: readonly CampusCardDirection[] = ['DEBIT', 'CREDIT'];

/** 领域模型：字段与 Prisma 行字段一一对应（domain 层不 import Prisma） */
export interface CampusCardTransactionModel {
  id: string;
  userId: string;
  /** 金额，**整数分**（方向由 `direction` 决定） */
  amountFen: number;
  direction: CampusCardDirection;
  /** 该笔交易发生**之后**的余额，整数分 */
  balanceAfterFen: number;
  /** **交易发生时刻**（不是入库时刻）—— 契约 §11.21-B 的字段名裁决 */
  occurredAt: Date;
  merchant: string;
  /** 入库时刻 */
  createdAt: Date;
}

/** 分页查询参数（契约 §6.1：游标分页，不用 offset） */
export interface CampusCardListParams {
  cursor?: string;
  limit: number;
}

/* ------------------------------------------------------------------ *
 * wire 类型（`/campus-card/*` 的响应形状，契约 §11.21-B）
 * ------------------------------------------------------------------ */

/**
 * 账户（`GET /campus-card/account`）。
 *
 * `balanceFen` **是余额**（不是 `summary` 那种汇总）；`updatedAt` 是余额对应的
 * 观测时刻。⚠️ §11.22-D：**可空的可选字段为空时省略键，而不是下发 `null`** ——
 * 因此没有任何流水时 `updatedAt` **整个键都不出现**。
 */
export interface CampusCardAccount {
  /** 是否已开通（= 存在可用的 `ecard` 绑定） */
  activated: boolean;
  /** 余额，**整数分** */
  balanceFen: number;
  /** 余额对应的观测时刻；无流水时省略该键 */
  updatedAt?: string;
  /**
   * 这份数据是不是**模拟/非上游**的。
   *
   * ⚠️ 当前恒为 `true`：`HttpCampusDataAdapter.fetchCard` **没有任何调用点**，
   * 也就是说上游余额/流水从来没有被同步进本地表。`balanceFen` 是从
   * 本地 `CampusCardTransaction` 推导的（契约没有独立余额表），
   * 而那张表在 mock 模式下没有真实数据来源 —— 所以余额显示 0 时，
   * 用户必须能看出"这不是真实余额"。
   *
   * 接入真实上游后改为按数据来源标记，不要直接改成 `false`。
   */
  simulated: boolean;
  /** 数据来源：`local` = 本地推导（当前唯一形态）；`upstream` = 真实上游同步 */
  dataSource: 'local' | 'upstream';
}

/** 一条流水（`GET /campus-card/transactions` 的元素） */
export interface CampusCardTransaction {
  id: string;
  /** 金额，**整数分**（非负；方向看 `direction`） */
  amountFen: number;
  direction: CampusCardDirection;
  balanceAfterFen: number;
  occurredAt: string;
  merchant: string;
}

/** 解绑结果（`DELETE /campus-card/account`） */
export interface CampusCardUnbindResult {
  activated: false;
  unbound: true;
}

/** 付款码（`GET /campus-card/payment-code`） */
export interface CampusCardPaymentCode {
  code: string;
  expiresAt: string;
}

/**
 * ⚠️ **真实通道是否已打通** —— 机器可见的常量（裁决 §11.21-B 的原话：
 * "在真实校园卡通道打通前，服务端返回 `UPSTREAM_UNAVAILABLE` 而不是假数据"）。
 *
 * 小程序端的同名常量 `CAMPUS_CARD_PAYMENT_CODE_REGISTERED` 已按 §11.21-B
 * **置为 `true`**（形状已由该条确定）；本常量回答的是**另一个问题**：
 * 上游通道有没有接通。答案是**没有** —— 因此端点存在、形状确定，但**不返回假数据**。
 */
export const CAMPUS_CARD_PAYMENT_CODE_UPSTREAM_READY = false;

/** 付款码 TTL（秒）。短时效：付款码是**凭证**，过期即废（§10.3：不缓存、不进日志） */
export const CAMPUS_CARD_PAYMENT_CODE_TTL_SEC = 60;

/* ------------------------------------------------------------------ *
 * 仓储端口（domain ← data）
 * ------------------------------------------------------------------ */

export interface CampusCardTransactionRepository {
  /** 我的流水（游标分页，按 `occurredAt` 倒序 —— 最新的在前） */
  listByUser(userId: string, params: CampusCardListParams): Promise<Page<CampusCardTransactionModel>>;
  /** 我最新的一条流水（用来推导余额）；没有则 `null` */
  latestByUser(userId: string): Promise<CampusCardTransactionModel | null>;
}

export const CAMPUS_CARD_TRANSACTION_REPOSITORY = Symbol('KEDAYA_CAMPUS_CARD_TRANSACTION_REPOSITORY');
