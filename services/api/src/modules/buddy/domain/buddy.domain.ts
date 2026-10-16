/**
 * 找搭子 · 领域模型与仓储端口（规格 §2，契约 §7 分层）
 *
 * ## 分层规则（契约 §7）
 *
 * ```
 * controller → service(application) → repository(port) ← data(prisma 实现)
 * ```
 *
 * **domain 层不 import Prisma**：本文件里的所有类型都是手写的行形状，
 * 不是 `@prisma/client` 生成的类型。这样做的代价是字段改名时编译器不会
 * 跨层报错，但收益是 domain 可以被纯函数单测穷举，且 Prisma 版本升级
 * 不会把类型变化渗透进业务规则。`data/buddy.repository.ts` 里的映射函数
 * 是两层之间**唯一**的接触面。
 *
 * 依赖通过**显式 token** 注入（而非 `design:paramtypes`）——
 * 这样在 vitest 等不做 `emitDecoratorMetadata` 的转译器下 DI 依然成立。
 */

import type { AvailabilitySlot, FeedbackRecord, MatchSubject } from '@kedaya/shared';
import type { BuddySection } from './section';

/* ------------------------------------------------------------------ *
 * 领域模型
 * ------------------------------------------------------------------ */

export interface BuddyProfileModel {
  userId: string;
  sections: string[];
  interestTags: string[];
  activityTags: string[];
  skillLevel: string | null;
  availability: AvailabilitySlot[];
  preferredAreas: string[];
  department: string | null;
  bio: string | null;
  matchEnabled: boolean;
  embeddingModel: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface BuddyPostModel {
  id: string;
  creatorId: string;
  activity: string;
  status: string;
  title: string;
  description: string | null;
  location: string;
  startsAt: Date;
  durationMin: number | null;
  capacity: number;
  joinedCount: number;
  genderPreference: string;
  tags: string[];
  minSkillLevel: string | null;
  autoCloseAt: Date | null;
  embeddingModel: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface BuddyCreatorModel {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface BuddyApplicationModel {
  id: string;
  postId: string;
  applicantId: string;
  status: string;
  message: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BuddyFeedbackModel {
  id: string;
  userId: string;
  targetPostId: string;
  section: string;
  action: string;
  createdAt: Date;
}

export interface BuddyQuestionnaireModel {
  id: string;
  slug: string;
  title: string;
  section: string;
  description: string | null;
  questions: unknown;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BuddyQuestionnaireResponseModel {
  id: string;
  questionnaireId: string;
  userId: string;
  answers: unknown;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 帖子 + 发起人公开资料（列表/详情/推荐都要这一对） */
export interface PostWithCreator {
  post: BuddyPostModel;
  creator: BuddyCreatorModel;
}

/* ------------------------------------------------------------------ *
 * 输入类型
 * ------------------------------------------------------------------ */

export interface CreateBuddyPostInput {
  activity: string;
  title: string;
  description?: string | null;
  location: string;
  startsAt: Date;
  durationMin?: number | null;
  capacity: number;
  genderPreference?: string;
  tags?: string[];
  minSkillLevel?: string | null;
}

/**
 * PATCH 的 Merge Patch 输入（RFC 7396，验收 T21）。
 *
 * ⚠️ 与"可选字段"的关键区别：`undefined` = **不动**，`null` = **清空**。
 * 所以可空字段的类型是 `T | null | undefined`，而不是普通 PATCH 的 `T | undefined`。
 * 合并逻辑是 domain 的 `applyMergePatch` 纯函数，data 层只负责把结果写库。
 */
export interface UpdateBuddyPostInput {
  title?: string;
  description?: string | null;
  location?: string;
  startsAt?: Date;
  durationMin?: number | null;
  capacity?: number;
  genderPreference?: string;
  tags?: string[];
  minSkillLevel?: string | null;
}

export interface UpsertBuddyProfileInput {
  sections: string[];
  interestTags: string[];
  activityTags: string[];
  skillLevel?: string | null;
  availability: AvailabilitySlot[];
  preferredAreas: string[];
  department?: string | null;
  bio?: string | null;
  matchEnabled: boolean;
}

/** 列表查询（游标分页，**严禁 offset**，验收 T20） */
export interface PostListQuery {
  section?: BuddySection;
  activities?: string[];
  tags?: string[];
  startsAfter?: Date;
  cursor?: string;
  limit: number;
  /** 默认 `createdAt_desc`（符合契约 §3.1 的游标定义）；`startsAt_asc` 用复合游标 */
  sort: PostSort;
}

export type PostSort = 'createdAt_desc' | 'startsAt_asc';

export interface PostPage {
  items: PostWithCreator[];
  nextCursor: string | null;
}

/* ------------------------------------------------------------------ *
 * 端口：资料
 * ------------------------------------------------------------------ */

export interface BuddyProfileRepository {
  findByUserId(userId: string): Promise<BuddyProfileModel | null>;
  /** 整体替换（PUT 语义）。embedding 由 `BuddyVectorRepository` 单独写。 */
  upsert(userId: string, input: UpsertBuddyProfileInput): Promise<BuddyProfileModel>;
  /** 硬删（含 embedding 列随行删除）—— 规格 §6.3 的"可随时撤回" */
  remove(userId: string): Promise<void>;
  /**
   * 批量取资料，用于构造候选的发起人特征。
   *
   * ⚠️ 只返回 `matchEnabled = true` 的行：`matchEnabled=false` 表示
   * "不参与匹配"，其资料特征**不得**被用作打分输入（规格 §6.3）。
   * 这个过滤放在**仓储**而不是调用方，是为了不可能有人忘记加。
   */
  findEnabledByUserIds(userIds: readonly string[]): Promise<Map<string, BuddyProfileModel>>;
}

/* ------------------------------------------------------------------ *
 * 端口：帖子
 * ------------------------------------------------------------------ */

export interface BuddyPostRepository {
  list(query: PostListQuery): Promise<PostPage>;
  findById(id: string): Promise<PostWithCreator | null>;
  findByIds(ids: readonly string[]): Promise<PostWithCreator[]>;
  /** 按板块取开放候选（rule 降级档用，**不需要任何扩展**，规格 §4.5） */
  findRuleCandidates(activities: readonly string[], limit: number, now: Date): Promise<PostWithCreator[]>;
  create(creatorId: string, input: CreateBuddyPostInput): Promise<PostWithCreator>;
  update(id: string, input: UpdateBuddyPostInput): Promise<PostWithCreator>;
  /** 状态流转（只接受 `canTransition` 允许的目标，见 buddy-post.state.ts） */
  setStatus(id: string, status: string): Promise<PostWithCreator>;
  /** 批量取我的申请状态（F4），返回 postId → status */
  findMyApplicationStatuses(userId: string, postIds: readonly string[]): Promise<Map<string, string>>;
}

/* ------------------------------------------------------------------ *
 * 端口：申请（含行锁事务，规格 §5.5 硬要求）
 * ------------------------------------------------------------------ */

export type JoinFailure =
  | 'POST_NOT_FOUND'
  | 'POST_NOT_OPEN'
  | 'POST_FULL'
  | 'ALREADY_APPLIED'
  | 'CANNOT_JOIN_OWN_POST';

export type JoinOutcome =
  | { kind: 'CREATED'; application: BuddyApplicationModel }
  | { kind: 'REACTIVATED'; application: BuddyApplicationModel }
  | { kind: 'FAILED'; reason: JoinFailure };

export type DecideFailure =
  | 'POST_NOT_FOUND'
  | 'APPLICATION_NOT_FOUND'
  | 'NOT_CREATOR'
  | 'APPLICATION_NOT_PENDING'
  | 'POST_FULL';

export type DecideOutcome =
  | { kind: 'ACCEPTED'; application: BuddyApplicationModel; post: BuddyPostModel }
  | { kind: 'REJECTED'; application: BuddyApplicationModel; post: BuddyPostModel }
  | { kind: 'FAILED'; reason: DecideFailure };

export type LeaveFailure = 'POST_NOT_FOUND' | 'APPLICATION_NOT_FOUND' | 'APPLICATION_NOT_PENDING';

export type LeaveOutcome =
  | { kind: 'WITHDRAWN'; application: BuddyApplicationModel }
  | { kind: 'FAILED'; reason: LeaveFailure };

export interface BuddyApplicationRepository {
  /**
   * 申请加入。**必须**在一个事务里 `SELECT ... FOR UPDATE` 锁 `BuddyPost` 行
   * 再检查名额（规格 §5.5）—— "先查后写"会超员。
   *
   * 注意语义：`join` 是**申请**不是入队，因此**不递增** `joinedCount`；
   * 名额在 `decide(ACCEPTED)` 时递增。锁仍然必要：它防止
   * "只剩 1 个名额但有 10 人同时申请"时发起人误接受超员。
   */
  createLocked(input: { postId: string; applicantId: string; message?: string | null }): Promise<JoinOutcome>;
  /** 撤回申请：`PENDING → WITHDRAWN`（复用同一行，规格 U7） */
  withdraw(input: { postId: string; applicantId: string }): Promise<LeaveOutcome>;
  /** 接受/拒绝。**必须**在一个事务里锁 `BuddyPost` 行再改 `joinedCount`（规格 §5.6） */
  decideLocked(input: {
    postId: string;
    applicationId: string;
    creatorId: string;
    decision: 'ACCEPTED' | 'REJECTED';
  }): Promise<DecideOutcome>;
  listByApplicant(
    applicantId: string,
  ): Promise<Array<{ application: BuddyApplicationModel; post: BuddyPostModel }>>;
  listByPost(postId: string): Promise<BuddyApplicationModel[]>;
  findById(id: string): Promise<BuddyApplicationModel | null>;
}

/* ------------------------------------------------------------------ *
 * 端口：反馈
 * ------------------------------------------------------------------ */

export interface BuddyFeedbackRepository {
  /** UPSERT（`@@unique([userId,targetPostId,section])`）—— 覆盖而非累积（规格 D11） */
  upsert(input: {
    userId: string;
    targetPostId: string;
    section: BuddySection;
    action: string;
  }): Promise<BuddyFeedbackModel>;
  /**
   * 取我在**某板块**的反馈（规格 §3.6 的 section 隔离 / 验收 T6）。
   *
   * ⚠️ `section` 是**必填参数**而不是可选过滤条件：把它做成可选，
   * 就会有人忘了传，于是 academic 的 dislike 污染 daily 的排序。
   * 类型系统在这里能挡住一个真实缺陷。
   */
  listByUserAndSection(userId: string, section: BuddySection): Promise<FeedbackRecord[]>;
}

/* ------------------------------------------------------------------ *
 * 端口：问卷
 * ------------------------------------------------------------------ */

export interface BuddyQuestionnaireRepository {
  listActive(section?: BuddySection): Promise<BuddyQuestionnaireModel[]>;
  findBySlug(slug: string): Promise<BuddyQuestionnaireModel | null>;
  upsertResponse(input: {
    questionnaireId: string;
    userId: string;
    answers: unknown;
    version: number;
  }): Promise<BuddyQuestionnaireResponseModel>;
  findResponse(questionnaireId: string, userId: string): Promise<BuddyQuestionnaireResponseModel | null>;
}

/* ------------------------------------------------------------------ *
 * 端口：向量（pgvector 专用，规格 §4.4）
 * ------------------------------------------------------------------ */

export interface VectorCandidate {
  postId: string;
  distance: number;
}

export interface BuddyVectorRepository {
  /**
   * 余弦距离召回候选。实现**必须**用 `$queryRaw` + 参数绑定，
   * **严禁字符串拼接**（规格 §4.4 / 验收 T15）。
   */
  findSimilarPosts(
    embedding: readonly number[],
    activities: readonly string[],
    limit: number,
  ): Promise<VectorCandidate[]>;
  /** 读帖子的 embedding（Prisma Client 不暴露 Unsupported 字段，只能 `$queryRaw`） */
  findPostEmbeddings(postIds: readonly string[]): Promise<Map<string, number[]>>;
  /** 读资料的 embedding */
  findProfileEmbedding(userId: string): Promise<number[] | null>;
  setProfileEmbedding(userId: string, embedding: readonly number[], model: string | null): Promise<void>;
  setPostEmbedding(postId: string, embedding: readonly number[], model: string | null): Promise<void>;
  /** 清空 embedding（撤回匹配资料时用，验收 T30） */
  clearProfileEmbedding(userId: string): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * 端口：用户（只读公开资料）
 * ------------------------------------------------------------------ */

export interface BuddyUserRepository {
  findPublicByIds(ids: readonly string[]): Promise<Map<string, BuddyCreatorModel>>;
}

/* ------------------------------------------------------------------ *
 * 端口：能力探测（启动自检，规格 §3.5）
 * ------------------------------------------------------------------ */

export interface BuddyCapabilityProbePort {
  probe(): Promise<{ hasPgvectorExtension: boolean; hasEmbeddingColumn: boolean }>;
}

/* ------------------------------------------------------------------ *
 * 端口：通知（接受申请后交换联系方式，规格 §6.2）
 * ------------------------------------------------------------------ */

/**
 * 通知端口。
 *
 * ⚠️ **跨模块依赖（规格 U8）**：联系方式"匹配成功后可见"的字段属于
 * `profile` 模块，**不在本模块作用域内**。因此这里只发"结果通知"，
 * 载荷里**不带**任何联系方式 —— 需要 `profile` 模块先提供该字段。
 * 记入交付说明的未决问题。
 */
export interface BuddyNotifierPort {
  applicationAccepted(input: {
    postId: string;
    creatorId: string;
    applicantId: string;
    title: string;
  }): Promise<void>;
  applicationRejected(input: {
    postId: string;
    creatorId: string;
    applicantId: string;
    title: string;
  }): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * 注入 token（显式，见文件头）
 * ------------------------------------------------------------------ */

export const BUDDY_PROFILE_REPOSITORY = Symbol('KEDAYA_BUDDY_PROFILE_REPOSITORY');
export const BUDDY_POST_REPOSITORY = Symbol('KEDAYA_BUDDY_POST_REPOSITORY');
export const BUDDY_APPLICATION_REPOSITORY = Symbol('KEDAYA_BUDDY_APPLICATION_REPOSITORY');
export const BUDDY_FEEDBACK_REPOSITORY = Symbol('KEDAYA_BUDDY_FEEDBACK_REPOSITORY');
export const BUDDY_QUESTIONNAIRE_REPOSITORY = Symbol('KEDAYA_BUDDY_QUESTIONNAIRE_REPOSITORY');
export const BUDDY_VECTOR_REPOSITORY = Symbol('KEDAYA_BUDDY_VECTOR_REPOSITORY');
export const BUDDY_USER_REPOSITORY = Symbol('KEDAYA_BUDDY_USER_REPOSITORY');
export const BUDDY_CAPABILITY_PROBE = Symbol('KEDAYA_BUDDY_CAPABILITY_PROBE');
export const BUDDY_NOTIFIER = Symbol('KEDAYA_BUDDY_NOTIFIER');

/* ------------------------------------------------------------------ *
 * 小工具：Merge Patch（RFC 7396，验收 T21）
 * ------------------------------------------------------------------ */

/**
 * RFC 7396 Merge Patch：`undefined` = 不动，`null` = 清空。
 *
 * 注意这与"整体替换（PUT）"不同，也与"只合并已定义字段"不同 ——
 * 后两者都无法表达"把这个字段清空"，而清空 `description` / `minSkillLevel`
 * 是真实需求。
 */
export function applyMergePatch<T extends object>(current: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...(current as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue; // 不动
    out[key] = value; // 含 null = 清空
  }
  return out as T;
}

/**
 * 构造"发起人的匹配特征"（规格 §3.3）。
 *
 * 两处刻意的取舍：
 * 1. **帖子的 `tags` 是公开信息**（就写在帖子上），因此无论发起人是否开启匹配
 *    都参与打分 —— 这正是规格 §2.3 说的"`tags` 是匹配打分的主特征"。
 *    共享包的 `ruleScoreFor` 读的是 `target.creator.activityTags`，
 *    所以这里把帖子 tags 并进去。
 * 2. **`matchEnabled=false` 的发起人资料不参与**：`profile` 参数由
 *    `BuddyProfileRepository.findEnabledByUserIds` 提供，已经过滤掉了
 *    `matchEnabled=false` 的行。因此"不主动开启就不进推荐池"（规格 §6.3）
 *    在数据层就已经成立，而不是靠这里判空。
 */
export function toMatchSubject(
  profile: BuddyProfileModel | undefined,
  postTags: readonly string[],
): MatchSubject {
  return {
    department: profile?.department ?? null,
    interestTags: profile?.interestTags ?? [],
    activityTags: [...(profile?.activityTags ?? []), ...postTags],
    preferredAreas: profile?.preferredAreas ?? [],
    skillLevel: profile?.skillLevel ?? null,
  };
}
