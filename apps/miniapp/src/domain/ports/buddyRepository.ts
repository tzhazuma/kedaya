import type { FeedbackAction, MatchMode, MatchReason } from '@kedaya/shared'
import type { Result } from '@kedaya/shared'

import type {
  BuddyActivity,
  BuddyApplication,
  BuddyGenderPreference,
  BuddyPost,
  BuddyProfile,
  BuddySection,
  BuddySkillLevel,
  BuddyTag,
} from '../models/buddy'
import type { RepositoryError } from './errors'

/**
 * 找搭子仓储端口 —— 由 `data/repositories/*` 实现（http / mock 两套）。
 *
 * 契约 §7 硬规则 3：所有网络访问必须经过 `data/api/`，
 * `presentation` 禁止直接发请求，只能通过用例层调用本端口。
 *
 * 路径映射（规格 §5.1 端点总表 + 契约 §6.1 / §11.2 / §11.11）：
 *
 * ```
 * GET    /buddy/tags                    封闭标签表（§11.11 附属集合，无需登记动作名）
 * GET    /buddy/profile                 读我的匹配资料
 * PUT    /buddy/profile                 整体替换（§11.3：PUT 的幂等键可选）
 * DELETE /buddy/profile                 删除匹配资料（含 embedding，规格 §6.3）
 * GET    /buddy/items                   活动列表（游标分页）
 * POST   /buddy/items                   发布活动（动作名无需登记：CRUD 形状）
 * GET    /buddy/items/:id               活动详情
 * POST   /buddy/items/:id/join          §11.2 已登记动作 `join`
 * POST   /buddy/items/:id/leave         §11.2 已登记动作 `leave`
 * POST   /buddy/items/:id/close         §11.2 已登记动作 `close`
 * POST   /buddy/items/:id/decide        §11.2 已登记动作 `decide`
 * POST   /buddy/items/:id/feedback      §11.2 已登记动作 `feedback`
 * GET    /buddy/recommendations         主动推荐（必带 section）
 * ```
 *
 * ⚠️ **游标对客户端完全不透明**（契约 §11.10-E）：本端只原样回传，
 * **不解析、不构造、不假设格式**。`sort=startsAt_asc` 时服务端用复合游标
 * `(startsAt, id)` 编码 —— 客户端因此**不需要**知道它是什么形状。
 */

export interface ListBuddyItemsQuery {
  cursor?: string | null
  limit?: number
  /** 不传或 `'all'` 表示不过滤（规格 §5.3） */
  section?: BuddySection | 'all'
  /** 命中任一标签即返回（规格 §5.3 `tags`） */
  tags?: readonly string[]
}

export interface BuddyItemPage {
  items: BuddyPost[]
  nextCursor: string | null
  total?: number
}

/** 一条推荐（规格 §5.7） */
export interface BuddyRecommendation {
  post: BuddyPost
  /** 0–1，保留 3 位小数（对齐 `matching.py:466`） */
  score: number
  /** 服务端下发的中文理由（**必须非空**，无命中时回落「有潜在匹配」） */
  reason: string
  /**
   * 客户端用 `explainMatch()` 算出的**结构化理由**（本端新增，不改变 wire 形状）。
   *
   * 为什么要有：规格 §5.7 的 `reason` 是一个拼好的字符串，用户看不出
   * 「为什么是这个权重」。可解释性要求（G3）要求展示**理由条目**，
   * 而 `explainMatch` 与服务端排序用的是同一套纯函数 —— 因此这里的条目
   * 与 `score` 的排序依据必然一致，不会出现「理由说同院系、排序却不是」。
   */
  reasons: MatchReason[]
}

export interface BuddyRecommendationPage {
  items: BuddyRecommendation[]
  nextCursor: string | null
  /** `vector` / `hash` / `rule`。**必须暴露**，让前端诚实展示（规格 §5.7） */
  matchMode: MatchMode
}

export interface CreateBuddyPostInput {
  activity: BuddyActivity
  title: string
  description?: string | null
  location: string
  /** ISO-8601 UTC */
  startsAt: string
  durationMin: number
  capacity: number
  genderPreference: BuddyGenderPreference
  tags: readonly string[]
  minSkillLevel?: BuddySkillLevel | null
}

export interface JoinBuddyInput {
  /** 申请留言（可选，≤200 字） */
  message?: string | null
  /** 契约 §11.3：`POST` 必须带 `Idempotency-Key` */
  idempotencyKey?: string
}

export type BuddyDecision = 'ACCEPTED' | 'REJECTED'

export interface DecideBuddyApplicationInput {
  applicationId: string
  decision: BuddyDecision
  idempotencyKey?: string
}

export interface BuddyFeedbackInput {
  section: BuddySection
  action: FeedbackAction
}

export interface BuddyFeedbackResult {
  action: FeedbackAction
}

/**
 * 发起人视角的申请列表（规格 §5.6 的副作用要求 + §6.1 可见性矩阵）。
 *
 * ⚠️ **只有发起人能拿到自己帖子的申请列表**（服务端强制）；
 * 申请人只能看到自己那一条（`BuddyPost.myApplication`）。
 */
export interface BuddyApplicationPage {
  items: BuddyApplication[]
  nextCursor: string | null
}

export interface BuddyRepository {
  /** 封闭标签表（规格 §3.2）—— 发布页与资料页**必须**从这里取可选标签 */
  listTags(): Promise<Result<BuddyTag[], RepositoryError>>

  listItems(query?: ListBuddyItemsQuery): Promise<Result<BuddyItemPage, RepositoryError>>
  itemDetail(id: string): Promise<Result<BuddyPost, RepositoryError>>
  createItem(
    body: CreateBuddyPostInput,
    idempotencyKey?: string,
  ): Promise<Result<BuddyPost, RepositoryError>>

  join(id: string, input: JoinBuddyInput): Promise<Result<BuddyApplication, RepositoryError>>
  leave(id: string, idempotencyKey?: string): Promise<Result<BuddyApplication, RepositoryError>>
  close(id: string, idempotencyKey?: string): Promise<Result<BuddyPost, RepositoryError>>
  decide(
    id: string,
    input: DecideBuddyApplicationInput,
  ): Promise<Result<BuddyPost, RepositoryError>>

  /** 发起人查看某帖的申请列表 */
  listApplications(postId: string): Promise<Result<BuddyApplicationPage, RepositoryError>>

  recommendations(
    section: BuddySection,
    limit?: number,
  ): Promise<Result<BuddyRecommendationPage, RepositoryError>>

  feedback(
    id: string,
    input: BuddyFeedbackInput,
  ): Promise<Result<BuddyFeedbackResult, RepositoryError>>

  /** 读我的匹配资料；从未创建过时返回 `null`（不是错误） */
  getProfile(): Promise<Result<BuddyProfile | null, RepositoryError>>
  putProfile(
    profile: BuddyProfile,
    idempotencyKey?: string,
  ): Promise<Result<BuddyProfile, RepositoryError>>
  /** 撤回匹配资料（硬删，含 embedding）—— 规格 §6.3 */
  deleteProfile(): Promise<Result<true, RepositoryError>>
}
