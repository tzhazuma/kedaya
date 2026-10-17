/**
 * 校园卡 —— 客户端领域模型（规格 §2.5 / §9.1 Phase 0）。
 *
 * ## 为什么校园卡是独立文件
 *
 * 规格 §2.5 的**关键发现**：校园卡**不依赖 CASTGC**，
 * 它走的是 eCard 的 **OPENID** 会话（`EcardOpenIdChannel.wechat`）。
 * 这条通道与 `egate` / `cpdaily` 那条 CASTGC 链路**完全解耦** ——
 * 因此校园卡可以在「不代持任何校园会话」的前提下独立落地，
 * 是 Phase 0 里唯一能真正拿到**结构化数据**的能力。
 *
 * ## 我们**不抄** TechPie 的做法
 *
 * TechPie 用一个 **DNS-only 隧道**劫持 `ecard.shanghaitech.edu.cn` 来兑换绑定码
 * （`ecard_bind_hijack.dart:41-52`）。规格 §6.5 明确不抄，理由是：
 * ① 微信小程序**没有**配置 DNS / VPN 的能力（无此 API）；
 * ② 从校园网视角看这是可疑流量。
 * **我们在小程序端走官方 OPENID 授权流程。**
 *
 * ## 与凭证的关系
 *
 * 本文件里没有任何 cookie / CASTGC / 密码字段 —— 只有余额、流水、付款码。
 * 付款码是**一次性展示值**，不是长期凭证，因此单独用 `expiresAt` 约束它的寿命。
 */

import { fenToSignedYuan, fenToYuan } from '@kedaya/shared'

import { findForbiddenCredentialKeys } from './credentials'

/* ------------------------------------------------------------------ *
 * OPENID 通道
 * ------------------------------------------------------------------ */

/**
 * 校园卡的绑定通道标识。
 *
 * ⚠️ 只有 `wechat-openid` 一种。它**不是** CASTGC 通道，
 * 也不应该被复用为其它校园系统的绑定方式。
 */
export type CampusCardChannel = 'wechat-openid'

export const CAMPUS_CARD_CHANNEL: CampusCardChannel = 'wechat-openid'

/**
 * ⚠️ **契约缺口（必须在 UI 与文档里机器可见）**：
 *
 * 小程序**拿不到自己的 openid** —— `wx.login` 只给一个一次性 `code`，
 * openid 必须由**服务端**用 `code2session`（需要 AppSecret）换取。
 * 但冻结的 OpenAPI `TechpieLinkCreate.openid` 字段名暗示客户端直接传 openid。
 *
 * 客户端的处理：把 `wx.login` 的 code 作为「OPENID 通道凭证」传给服务端，
 * 并在类型上明确标注它是 **code 而不是 openid**。
 * 字段命名与语义不符是契约缺口，**不能靠客户端猜**。
 */
export interface CampusCardBindCredential {
  channel: CampusCardChannel
  /**
   * `wx.login` 返回的一次性 code（5 分钟有效，用后即焚）。
   *
   * **不是 openid** —— 小程序客户端在密码学上无法自己得到 openid。
   * 服务端必须用它换取 openid，再走 eCard 的 OPENID 绑定。
   */
  wechatLoginCode: string
}

/** UI / 文档必须展示的诚实说明 */
export const CAMPUS_CARD_OPENID_NOTICE =
  '校园卡使用独立的微信 OPENID 通道绑定，与课表 / 请假等需要校园会话的能力完全无关；可达鸭不会接触你的校园系统登录凭证。'

/* ------------------------------------------------------------------ *
 * 流水与余额
 * ------------------------------------------------------------------ */

/** 一笔交易 —— 与冻结 OpenAPI 的 `CampusCardTxn` 逐字段对齐 */
export interface CampusCardTransaction {
  id: string
  /** 金额，**整数分**（契约冻结：全链路整数分） */
  amountFen: number
  /** 该笔交易**发生后的余额**（整数分）—— 冻结契约里余额就在流水上 */
  balanceFen: number | null
  merchant: string
  /** ISO-8601 */
  occurredAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** 归一化一笔交易；含凭证键的条目一律拒绝（契约 I1 的镜像） */
export function normalizeCampusCardTransaction(raw: unknown): CampusCardTransaction | null {
  if (!isRecord(raw)) return null
  if (findForbiddenCredentialKeys(raw).length > 0) return null

  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : null
  if (id === null) return null
  if (!isFiniteInt(raw.amountFen)) return null

  return {
    id,
    amountFen: raw.amountFen,
    balanceFen: isFiniteInt(raw.balanceFen) ? raw.balanceFen : null,
    merchant: typeof raw.merchant === 'string' ? raw.merchant : '',
    occurredAt: typeof raw.occurredAt === 'string' ? raw.occurredAt : '',
  }
}

export function normalizeCampusCardTransactions(raw: unknown): CampusCardTransaction[] {
  if (!Array.isArray(raw)) return []
  const out: CampusCardTransaction[] = []
  for (const item of raw) {
    const normalized = normalizeCampusCardTransaction(item)
    if (normalized !== null) out.push(normalized)
  }
  return out
}

/**
 * 余额的来源。
 *
 * ⚠️ 冻结契约里**没有**独立的余额端点 —— 但 `CampusCardTxn.balanceFen`
 * 是「该笔交易发生后的余额」，因此**最新一笔**的 `balanceFen` 就是当前余额。
 * 我们用这个冻结字段推导，而不是**发明**一个 `GET /campus-card/balance`
 * （发明端点会制造一个只有 mock 才存在的接口，那是在骗自己）。
 */
export interface CampusCardAccount {
  balanceFen: number | null
  /** 余额对应的时间点（最新一笔流水的时间） */
  asOf: string | null
  /** 余额的取得方式，UI 可据此如实标注 */
  source: 'latest-transaction' | 'unavailable'
}

export const EMPTY_CARD_ACCOUNT: CampusCardAccount = {
  balanceFen: null,
  asOf: null,
  source: 'unavailable',
}

/** 按发生时间取最新一笔（时间相同用 id 兜底，保证**确定性**） */
export function latestTransaction(
  transactions: readonly CampusCardTransaction[],
): CampusCardTransaction | null {
  let best: CampusCardTransaction | null = null
  for (const txn of transactions) {
    if (best === null) {
      best = txn
      continue
    }
    if (txn.occurredAt > best.occurredAt) {
      best = txn
      continue
    }
    if (txn.occurredAt === best.occurredAt && txn.id > best.id) best = txn
  }
  return best
}

/** 从流水推导余额（见 `CampusCardAccount` 的说明） */
export function deriveCardAccount(
  transactions: readonly CampusCardTransaction[],
): CampusCardAccount {
  const latest = latestTransaction(transactions)
  if (latest === null || latest.balanceFen === null) return EMPTY_CARD_ACCOUNT
  return {
    balanceFen: latest.balanceFen,
    asOf: latest.occurredAt === '' ? null : latest.occurredAt,
    source: 'latest-transaction',
  }
}

/** 展示用：余额（元） */
export function formatBalance(account: CampusCardAccount): string {
  return account.balanceFen === null ? '—' : `¥${fenToYuan(account.balanceFen)}`
}

/** 展示用：交易金额（带符号，元） */
export function formatTransactionAmount(txn: CampusCardTransaction): string {
  return `¥${fenToSignedYuan(txn.amountFen)}`
}

/* ------------------------------------------------------------------ *
 * 付款码
 * ------------------------------------------------------------------ */

/**
 * 付款码（一次性展示值）。
 *
 * ⚠️ **契约缺口**：冻结的 `packages/contracts/openapi/kedaya.v1.yaml` 里
 * **没有**付款码端点（只有 `GET /campus-card/items` 流水与 `POST /campus-card/items` 充值单）。
 * 因此本端把「付款码」实现为**显式的契约缺口**：
 *
 * - 仓储端口里有 `paymentCode()`，路径常量集中在 `CAMPUS_CARD_PAYMENT_CODE_PATH`；
 * - `CAMPUS_CARD_PAYMENT_CODE_REGISTERED = false` 是**机器可见**的标记，
 *   UI 据此如实告知用户「该接口尚未登记进冻结契约」，
 *   而不是假装它在真后端上能用；
 * - mock 模式下可以完整演示。
 *
 * 登记为交付说明里的未决问题（需要后端 / 契约同步，超出小程序写作用域）。
 */
export interface CampusCardPaymentCode {
  /** 一次性付款码（短期有效，**不是**长期凭证） */
  code: string
  /** ISO-8601 */
  issuedAt: string
  /** ISO-8601 */
  expiresAt: string
}

export const CAMPUS_CARD_PAYMENT_CODE_PATH = '/campus-card/payment-code'

/** 付款码端点是否已登记进冻结契约（当前：**否**） */
export const CAMPUS_CARD_PAYMENT_CODE_REGISTERED = false

export const CAMPUS_CARD_PAYMENT_CODE_GAP_NOTICE =
  '付款码接口尚未登记进冻结契约（packages/contracts/openapi），当前仅在 mock 模式下可演示；真实后端接通前可达鸭不会假装它能用。'

export function isPaymentCodeExpired(
  paymentCode: CampusCardPaymentCode,
  now: Date,
): boolean {
  const expiresAt = new Date(paymentCode.expiresAt).getTime()
  if (Number.isNaN(expiresAt)) return true
  return expiresAt <= now.getTime()
}

export function normalizeCampusCardPaymentCode(raw: unknown): CampusCardPaymentCode | null {
  if (!isRecord(raw)) return null
  if (findForbiddenCredentialKeys(raw).length > 0) return null

  const code = typeof raw.code === 'string' && raw.code.length > 0 ? raw.code : null
  const issuedAt = typeof raw.issuedAt === 'string' ? raw.issuedAt : null
  const expiresAt = typeof raw.expiresAt === 'string' ? raw.expiresAt : null
  if (code === null || issuedAt === null || expiresAt === null) return null

  return { code, issuedAt, expiresAt }
}

/* ------------------------------------------------------------------ *
 * 校园卡首屏视图（`campus-card` 页面的主视图）
 *
 * 与上面的「冻结契约模型」是**两层**：
 *   · 上面那层是原始流水 / 付款码，字段与 OpenAPI 逐字对齐；
 *   · 这一层是**服务端算好的首屏视图**（余额 + 还能撑几天 + 异常扣款），
 *     页面直接用，不在客户端重算「第几笔是异常」这类判断。
 *
 * `stale === true` 表示当前展示的是**缓存**数据，页面必须显著提示并给出
 * 上次成功时间 —— 绝不允许把"查不到"渲染成 0 元。
 * ------------------------------------------------------------------ */

/** 与后端常量一致的低余额阈值（分）：约两顿正餐 */
export const LOW_BALANCE_THRESHOLD_FEN = 2000

export interface CardTransactionView {
  id: string
  amountFen: number
  direction: string
  merchant: string
  happenedAt: string
  balanceAfterFen: number
  /** `"−15.00"` / `"+200.00"`（符号由服务端算好） */
  amountLabel: string
}

export interface CardAnomaly {
  merchant: string
  amountFen: number
  happenedAt: string
  /** 相对日常消费中位数的倍数，用来解释"为什么判定异常" */
  ratioToMedian: number
}

export interface CardInsight {
  todayOutFen: number
  todayOutCount: number
  weekOutFen: number
  weekOutCount: number
  avgDailyOutFen: number
  /** 余额还能撑几天（无消费记录为 null） */
  estimatedDaysLeft: number | null
  medianOutFen: number
  anomalies: CardAnomaly[]
  topMerchants: { merchant: string; totalFen: number; count: number }[]
}

export interface CardOverview {
  platform: 'CARD'
  balanceFen: number
  thresholdFen: number
  lowBalance: boolean
  /** 上游数据时间（ISO） */
  dataAsOf: string
  /** 本地上次成功同步时间；从未同步为 null */
  syncedAt: string | null
  /** true = 上游不可用，展示的是缓存 */
  stale: boolean
  staleReason: string | null
  simulated: boolean
  transactions: CardTransactionView[]
  insight: CardInsight
}

export interface CardLostReport {
  accepted: boolean
  note: string
  steps: string[]
  channels: { name: string; detail: string }[]
  audited: boolean
}

/** 分 → `¥12.34` */
export function formatYuan(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`
}

/** 余额文案 + 低余额提醒（页面里的主数字） */
export function balanceLabel(overview: CardOverview): string {
  return formatYuan(overview.balanceFen)
}

/** "还能撑几天"的一句话解释（把推算口径也讲清楚，避免用户误解） */
export function daysLeftLabel(overview: CardOverview): string | null {
  const days = overview.insight.estimatedDaysLeft
  if (days === null) return null
  return `按最近 7 天日均消费（${formatYuan(overview.insight.avgDailyOutFen)}）估算，还能撑约 ${days} 天`
}
