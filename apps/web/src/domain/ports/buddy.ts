/**
 * 找搭子仓储端口（依赖倒置点 —— 契约 §7）。
 *
 * domain 定义接口，data 层实现（HTTP / mock）；presentation 永远不直接发请求。
 * 错误通道用 `@kedaya/shared` 的 `Result`，错误载荷用契约的 `ApiError`
 * （冻结错误码 `UNAUTHENTICATED` / `FORBIDDEN` / `NOT_FOUND` / `VALIDATION_FAILED` /
 *   `CONFLICT` / `RATE_LIMITED` / `INTERNAL` 可一路透传到 UI）。
 *
 * 路由形状（契约 §6.1 的 CRUD 统一形状 + §11.2 已冻结的 5 个动作名）：
 *   GET    /api/v1/buddy/items                      活动列表（游标分页）
 *   POST   /api/v1/buddy/items                      发布活动
 *   GET    /api/v1/buddy/items/:id                  活动详情
 *   POST   /api/v1/buddy/items/:id/join             **已冻结 action**
 *   POST   /api/v1/buddy/items/:id/leave            **已冻结 action**
 *   POST   /api/v1/buddy/items/:id/close            **已冻结 action**
 *   POST   /api/v1/buddy/items/:id/decide           **已冻结 action**
 *   POST   /api/v1/buddy/items/:id/feedback         **已冻结 action**
 *   GET    /api/v1/buddy/recommendations            主动推荐
 *   GET    /api/v1/buddy/applications               我的申请（集合路由，§11.11）
 *   GET    /api/v1/buddy/profile                    我的匹配资料（单例资源）
 *   PUT    /api/v1/buddy/profile                    整体替换
 *   DELETE /api/v1/buddy/profile                    删除（含匹配向量）
 */
import type { ApiError, Page } from '@kedaya/contracts';
import type { MatchReason, Result } from '@kedaya/shared';

import type {
  BuddyActivity,
  BuddyApplication,
  BuddyApplicationStatus,
  BuddyFeedbackAction,
  BuddyGender,
  BuddyMatchFeedback,
  BuddyPost,
  BuddyPostDraft,
  BuddyPostStatus,
  BuddyProfile,
  BuddyProfileDraft,
  BuddySection,
  BuddySkillLevel,
} from '../models/buddy';

/** mock 适配器的可控故障模式，用于演示三态 UI（与其余切片共用同一语义） */
export type MockFailureMode = 'none' | 'error';

/** 排序：组队场景下"什么时候"比"什么时候发的"重要（规格 §5.3） */
export type BuddyPostSort = 'startsAt_asc' | 'createdAt_desc';

export interface BuddyPostListQuery {
  /**
   * 游标分页（契约 §6.1：不用 offset）。
   * ⚠️ 契约 §11.10-E：游标对客户端**完全不透明** —— 只能把服务端返回的
   * `nextCursor` 原样回传，**不得**解析、构造或假设其格式。
   * `buddy` 的 `startsAt_asc` 需要 `(startsAt, id)` 复合游标，服务端自行编码。
   */
  cursor?: string;
  limit?: number;
  section?: BuddySection;
  activity?: BuddyActivity;
  /** 标签 key，命中任一即返回（规格 §5.3） */
  tags?: string[];
  /** 只看这个时间之后开始的活动（默认 now） */
  startsAfter?: string;
  sort?: BuddyPostSort;
  /** 是否包含非 OPEN 的活动（列表默认只给 OPEN；详情不受影响） */
  includeClosed?: boolean;
}

export interface BuddyPostDetail {
  post: BuddyPost;
  /** 只有发起人视角才有值（规格 §6.1 可见性矩阵） */
  applications: BuddyApplication[];
  /** 当前用户对这条活动的申请（没有则 null） */
  viewerApplication: BuddyApplication | null;
  /** 当前用户是否是该活动发起人 */
  viewerIsCreator: boolean;
}

export interface CreateBuddyPostInput extends BuddyPostDraft {
  /** 发起人（实名 id；由调用方注入，mock 内部生成 creator 摘要） */
  creator: { id: string; nickname: string; avatarUrl?: string | null };
  /** 契约 §11.3：POST 必须带 Idempotency-Key */
  idempotencyKey?: string;
}

export interface JoinBuddyPostInput {
  postId: string;
  applicant: {
    id: string;
    nickname: string;
    /** 仅用于 F5 准入判定；**不进匹配特征**（规格 §1.2 N5） */
    gender: BuddyGender;
    skillLevel: BuddySkillLevel | null;
  };
  message?: string;
  idempotencyKey?: string;
}

export interface LeaveBuddyPostInput {
  postId: string;
  applicantId: string;
  idempotencyKey?: string;
}

export interface DecideBuddyApplicationInput {
  postId: string;
  applicationId: string;
  decision: Extract<BuddyApplicationStatus, 'ACCEPTED' | 'REJECTED'>;
  /** 必须是 `post.creator.id`，否则 `FORBIDDEN` */
  actorId: string;
  idempotencyKey?: string;
}

export interface CloseBuddyPostInput {
  postId: string;
  actorId: string;
  idempotencyKey?: string;
}

export interface BuddyFeedbackInput {
  postId: string;
  userId: string;
  section: BuddySection;
  action: BuddyFeedbackAction;
  idempotencyKey?: string;
}

export interface BuddyRecommendationQuery {
  /**
   * 「我」的实名 id。
   * ⚠️ 真实 API 从 `Authorization: Bearer` 取身份、**不接受**客户端传 userId
   * （HTTP 适配器因此不下发该参数）；mock 需要它来扮演服务端。
   */
  userId: string;
  /** **必填**（规格 §5.7） */
  section: BuddySection;
  limit?: number;
  cursor?: string;
}

export interface BuddyRecommendation {
  post: BuddyPost;
  /** 0–1，保留 3 位小数（对齐 STUMatch `round(score, 3)`） */
  score: number;
  /** 中文理由，**必须非空** */
  reason: string;
  /**
   * 结构化理由 —— **就是 `@kedaya/shared` 的 `explainMatch` 输出**（UI 逐条展示）。
   * 服务端下发的是**聚合短语**（如「共同兴趣 3 项」），不是我的完整标签集：
   * 匹配结果的解释不等于资料的泄漏（规格 §6.1）。
   */
  reasons: MatchReason[];
}

export interface BuddyRecommendationPage {
  items: BuddyRecommendation[];
  nextCursor: string | null;
  /**
   * `vector` / `hash` / `rule`。**必须暴露**，让前端能诚实展示
   * （`rule` 模式下不要说"为你智能推荐"，规格 §5.7）。
   */
  matchMode: 'vector' | 'hash' | 'rule';
}

export interface BuddyRepository {
  listPosts(query: BuddyPostListQuery): Promise<Result<Page<BuddyPost>, ApiError>>;
  postDetail(id: string, viewerId: string): Promise<Result<BuddyPostDetail, ApiError>>;
  createPost(input: CreateBuddyPostInput): Promise<Result<BuddyPost, ApiError>>;
  /** 已冻结动作：`POST /items/:id/join`（**申请**，不占名额，规格 §5.5） */
  join(input: JoinBuddyPostInput): Promise<Result<BuddyApplication, ApiError>>;
  /** 已冻结动作：`POST /items/:id/leave` */
  leave(input: LeaveBuddyPostInput): Promise<Result<BuddyApplication, ApiError>>;
  /** 已冻结动作：`POST /items/:id/decide`（发起人接受 / 拒绝） */
  decide(input: DecideBuddyApplicationInput): Promise<Result<BuddyPostDetail, ApiError>>;
  /** 已冻结动作：`POST /items/:id/close`（发起人关闭 → `CLOSED`） */
  close(input: CloseBuddyPostInput): Promise<Result<BuddyPost, ApiError>>;
  /** 已冻结动作：`POST /items/:id/feedback`（UPSERT，按板块隔离） */
  feedback(input: BuddyFeedbackInput): Promise<Result<BuddyMatchFeedback, ApiError>>;
  recommendations(
    query: BuddyRecommendationQuery,
  ): Promise<Result<BuddyRecommendationPage, ApiError>>;
  /** 我的申请列表（集合路由，契约 §11.11） */
  listMyApplications(userId: string): Promise<Result<BuddyApplication[], ApiError>>;
  getProfile(userId: string): Promise<Result<BuddyProfile, ApiError>>;
  putProfile(input: BuddyProfileDraft & { userId: string; idempotencyKey?: string }): Promise<
    Result<BuddyProfile, ApiError>
  >;
  /** 硬删该行（含匹配向量），立即从推荐池移除（规格 §6.3） */
  deleteProfile(userId: string): Promise<Result<{ deleted: true }, ApiError>>;
}

/** 便于测试与 UI 复用的状态过滤：列表默认只给这些状态 */
export const BUDDY_LISTABLE_STATUSES: readonly BuddyPostStatus[] = ['OPEN', 'FULL'];
