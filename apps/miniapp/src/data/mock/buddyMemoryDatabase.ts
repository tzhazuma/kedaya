import {
  applyHardFilters,
  explainMatch,
  feedbackAdjustment,
  fuseScore,
  ok,
  err,
  ruleScoreFor,
  type MatchSubject,
  type Result,
} from '@kedaya/shared'

import {
  BUDDY_TAG_LIMITS,
  BUDDY_CAPACITY_RANGE,
  BUDDY_TAGS,
  availabilityOverlapsPost,
  canApplyToPost,
  canTransitionApplication,
  canTransitionPost,
  derivePostStatus,
  isKnownArea,
  normalizeBuddyProfile,
  sectionOf,
  skillRank,
  validateBuddyProfile,
  validateTagKeys,
} from '../../domain/models/buddy'
import type {
  BuddyApplication,
  BuddyPost,
  BuddyProfile,
  BuddySection,
  BuddyTag,
} from '../../domain/models/buddy'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  BuddyApplicationPage,
  BuddyFeedbackResult,
  BuddyItemPage,
  BuddyRecommendation,
  BuddyRecommendationPage,
  CreateBuddyPostInput,
  DecideBuddyApplicationInput,
  JoinBuddyInput,
  ListBuddyItemsQuery,
} from '../../domain/ports/buddyRepository'
import {
  MOCK_BUDDY_APPLICATIONS,
  MOCK_BUDDY_FEEDBACK,
  MOCK_BUDDY_POSTS,
  MOCK_BUDDY_PROFILES,
  type MockBuddyFeedback,
} from './buddyFixtures'

/**
 * 找搭子内存数据库 —— mock repository 的存储内核。
 *
 * ⚠️ **本文件刻意复用 `@kedaya/shared` 的匹配纯函数**
 * （`applyHardFilters` / `ruleScoreFor` / `explainMatch` / `feedbackAdjustment` / `fuseScore`），
 * 而不是自己写一份「差不多的」排序。理由是本模块最重要的验收要求：
 * 客户端展示的「为什么推荐给你」必须与服务端**同一套算法** ——
 * 两份实现必然漂移，用户会看到与服务端排序不一致的理由。
 * mock 是这条要求在无后端时唯一能被验证的地方，因此它必须真的调那些函数。
 *
 * 匹配模式：mock **没有 embedding**，因此诚实地返回 `matchMode: 'rule'`
 * （规格 §3.5 模式 C）—— 绝不假装是语义匹配。
 */

/** 当前登录者（由装配层从会话注入；端口签名因此不需要到处传 userId） */
export interface BuddyViewer {
  id: string
  nickname: string
}

export interface BuddyMemoryDatabaseOptions {
  posts?: readonly BuddyPost[]
  profiles?: readonly BuddyProfile[]
  applications?: readonly BuddyApplication[]
  feedback?: readonly MockBuddyFeedback[]
  tags?: readonly BuddyTag[]
  now?: () => Date
  currentUser: () => BuddyViewer | null
}

export interface BuddyMemoryDatabase {
  listTags(): BuddyTag[]
  list(query?: ListBuddyItemsQuery): BuddyItemPage
  find(id: string): BuddyPost | null
  create(body: CreateBuddyPostInput, idempotencyKey?: string): Result<BuddyPost, RepositoryError>
  join(id: string, input: JoinBuddyInput): Result<BuddyApplication, RepositoryError>
  leave(id: string, idempotencyKey?: string): Result<BuddyApplication, RepositoryError>
  close(id: string, idempotencyKey?: string): Result<BuddyPost, RepositoryError>
  decide(id: string, input: DecideBuddyApplicationInput): Result<BuddyPost, RepositoryError>
  listApplications(postId: string): Result<BuddyApplicationPage, RepositoryError>
  recommendations(section: BuddySection, limit?: number): BuddyRecommendationPage
  feedback(
    id: string,
    input: { section: BuddySection; action: 'like' | 'dislike' | 'skip' },
  ): Result<BuddyFeedbackResult, RepositoryError>
  getProfile(): BuddyProfile | null
  putProfile(profile: BuddyProfile, idempotencyKey?: string): Result<BuddyProfile, RepositoryError>
  deleteProfile(): Result<true, RepositoryError>
  /** 演示控制：给某帖塞一条待审批申请（让「发起人审批」在任何帖子上都可演示） */
  addDemoApplication(postId: string): Result<BuddyApplication, RepositoryError>
  clear(): void
  reset(): void
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return fallback
  return Math.min(Math.floor(limit), 100)
}

/**
 * 幂等存储（契约 §11.3）。
 *
 * 语义：同一 key + 同一 body → 返回**首次**结果（不重复创建）；
 * 同一 key + 不同 body → `CONFLICT` / `IDEMPOTENCY_KEY_REUSED`。
 * 这正是「小程序网络重试非常常见」所需要的保护。
 */
interface IdempotencyEntry {
  fingerprint: string
  value: unknown
}

export function createBuddyMemoryDatabase(
  options: BuddyMemoryDatabaseOptions,
): BuddyMemoryDatabase {
  const seedPosts = options.posts ?? MOCK_BUDDY_POSTS
  const seedProfiles = options.profiles ?? MOCK_BUDDY_PROFILES
  const seedApplications = options.applications ?? MOCK_BUDDY_APPLICATIONS
  const seedFeedback = options.feedback ?? MOCK_BUDDY_FEEDBACK
  const tags = options.tags ?? BUDDY_TAGS
  const now = options.now ?? ((): Date => new Date())
  const currentUser = options.currentUser

  let posts: BuddyPost[] = seedPosts.map(clone)
  let profiles: BuddyProfile[] = seedProfiles.map(clone)
  let applications: BuddyApplication[] = seedApplications.map(clone)
  let feedbacks: MockBuddyFeedback[] = seedFeedback.map(clone)
  let idempotency = new Map<string, IdempotencyEntry>()
  let sequence = 0

  function nextId(prefix: string): string {
    sequence += 1
    return `${prefix}-${String(sequence).padStart(4, '0')}`
  }

  function me(): BuddyViewer | null {
    return currentUser()
  }

  function requireIdempotencyKey(key: string | undefined): RepositoryError | null {
    if (key === undefined || key.trim() === '') {
      return {
        code: 'VALIDATION_FAILED',
        message: '写操作缺少 Idempotency-Key',
        details: { reason: 'IDEMPOTENCY_KEY_REQUIRED' },
      }
    }
    return null
  }

  /**
   * 幂等执行器。`scope` 把不同动作的 key 空间隔开，
   * 否则「发布」和「申请」用同一个 key 会互相污染。
   */
  function withIdempotency<T>(
    scope: string,
    key: string | undefined,
    fingerprintSource: unknown,
    work: () => Result<T, RepositoryError>,
  ): Result<T, RepositoryError> {
    const missing = requireIdempotencyKey(key)
    if (missing !== null) return err(missing)

    const storeKey = `${scope}:${key as string}`
    const fingerprint = JSON.stringify(fingerprintSource)
    const existing = idempotency.get(storeKey)

    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return err({
          code: 'CONFLICT',
          message: '同一个幂等键被用于了不同的请求内容',
          details: { reason: 'IDEMPOTENCY_KEY_REUSED' },
        })
      }
      return ok(clone(existing.value) as T)
    }

    const result = work()
    if (result.ok) {
      idempotency.set(storeKey, { fingerprint, value: clone(result.value) })
    }
    return result
  }

  /** 把帖子 + 当前登录者的申请拼成详情形状 */
  function withMyApplication(post: BuddyPost): BuddyPost {
    const viewer = me()
    if (viewer === null) return clone({ ...post, myApplication: null })
    const mine = applications.find((a) => a.postId === post.id && a.applicantId === viewer.id)
    return clone({ ...post, myApplication: mine === undefined ? null : clone(mine) })
  }

  function findRaw(id: string): BuddyPost | undefined {
    return posts.find((p) => p.id === id)
  }

  function visibleInList(post: BuddyPost, at: Date): boolean {
    // 规格 §5.3：`startsAfter` 默认 `now()` —— 已开始的活动不进列表。
    // 刻意**不**按 `status` 过滤：`FULL` / `CLOSED` 也应该被看到
    // （用户需要知道「满了 / 关了」，而不是让它凭空消失）。
    return new Date(post.startsAt).getTime() > at.getTime()
  }

  function buildMatchSubject(profile: BuddyProfile | undefined): MatchSubject {
    if (profile === undefined) {
      return {
        department: null,
        interestTags: [],
        activityTags: [],
        preferredAreas: [],
        skillLevel: null,
      }
    }
    return {
      department: profile.department,
      interestTags: profile.interestTags,
      activityTags: profile.activityTags,
      preferredAreas: profile.preferredAreas,
      skillLevel: profile.skillLevel,
    }
  }

  function feedbacksForSection(section: BuddySection, viewerId: string): MockBuddyFeedback[] {
    // ⚠️ section 隔离（规格 §3.6 / 验收 T6）：跨板块反馈互相污染是最容易写错的地方
    return feedbacks
      .filter((f) => f.userId === viewerId && f.section === section)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  return {
    listTags(): BuddyTag[] {
      return tags.filter((t) => t.isActive).map(clone)
    },

    list(query: ListBuddyItemsQuery = {}): BuddyItemPage {
      const at = now()
      const limit = clampLimit(query.limit, 20)
      const section = query.section ?? 'all'
      const wanted = query.tags ?? []

      const filtered = posts
        .filter((p) => visibleInList(p, at))
        .filter((p) => section === 'all' || sectionOf(p.activity) === section)
        .filter((p) => wanted.length === 0 || p.tags.some((t) => wanted.includes(t)))
        // 组队场景下「什么时候」比「什么时候发的」重要（规格 §5.3 默认 sort）
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))

      const cursor = query.cursor ?? null
      const startIndex = cursor === null ? 0 : filtered.findIndex((p) => p.id === cursor) + 1
      const page = filtered.slice(startIndex, startIndex + limit)
      const hasMore = startIndex + limit < filtered.length
      const last = page.length > 0 ? page[page.length - 1] : undefined

      return {
        items: page.map(withMyApplication),
        // mock 用「上一条的 id」当游标；真实服务端用不透明复合游标
        // （契约 §11.10-E）—— 对客户端而言两者都是不可解析的字符串。
        nextCursor: hasMore && last !== undefined ? last.id : null,
        total: filtered.length,
      }
    },

    find(id: string): BuddyPost | null {
      const found = findRaw(id)
      return found === undefined ? null : withMyApplication(found)
    },

    create(body, idempotencyKey): Result<BuddyPost, RepositoryError> {
      const viewer = me()
      if (viewer === null) {
        return err({ code: 'UNAUTHENTICATED', message: '登录后才能发布搭子' })
      }

      return withIdempotency('create', idempotencyKey, body, () => {
        const tagCheck = validateTagKeys(body.tags, BUDDY_TAG_LIMITS.postTags)
        if (!tagCheck.ok) {
          const first = tagCheck.error.unknown[0]
          return err({
            code: 'VALIDATION_FAILED',
            message: tagCheck.error.message ?? '标签不合法',
            details: { reason: first === undefined ? 'INVALID_TAGS' : `UNKNOWN_TAG:${first}` },
          })
        }

        if (!isKnownArea(body.location)) {
          return err({
            code: 'VALIDATION_FAILED',
            message: '请从校园地点列表里选择活动地点',
            details: { reason: 'UNKNOWN_LOCATION' },
          })
        }

        if (
          !Number.isInteger(body.capacity) ||
          body.capacity < BUDDY_CAPACITY_RANGE.min ||
          body.capacity > BUDDY_CAPACITY_RANGE.max
        ) {
          return err({
            code: 'VALIDATION_FAILED',
            message: `人数 ${BUDDY_CAPACITY_RANGE.min}–${BUDDY_CAPACITY_RANGE.max} 人`,
            details: { reason: 'capacity' },
          })
        }

        const startsAt = new Date(body.startsAt)
        if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= now().getTime()) {
          return err({
            code: 'VALIDATION_FAILED',
            message: '活动时间必须晚于当前时间',
            details: { reason: 'startsAt' },
          })
        }

        const created: BuddyPost = {
          id: nextId('bp'),
          activity: body.activity,
          status: 'OPEN',
          title: body.title,
          description: body.description ?? null,
          location: body.location,
          startsAt: startsAt.toISOString(),
          durationMin: body.durationMin,
          capacity: body.capacity,
          // 契约 §11.10-D：joinedCount **含发起人**，初值为 1
          joinedCount: 1,
          genderPreference: body.genderPreference,
          tags: tagCheck.value,
          minSkillLevel: body.minSkillLevel ?? null,
          creator: { id: viewer.id, nickname: viewer.nickname, avatarUrl: null },
          createdAt: now().toISOString(),
          updatedAt: now().toISOString(),
          myApplication: null,
        }

        posts = [...posts, created]
        return ok(clone(created))
      })
    },

    join(id, input): Result<BuddyApplication, RepositoryError> {
      const viewer = me()
      if (viewer === null) {
        return err({ code: 'UNAUTHENTICATED', message: '登录后才能申请加入' })
      }

      return withIdempotency('join', input.idempotencyKey, { id, message: input.message }, () => {
        const current = findRaw(id)
        if (current === undefined) {
          return err({ code: 'NOT_FOUND', message: '活动不存在或已被下架' })
        }

        const at = now()
        const myProfile = profiles.find((p) => p.userId === viewer.id)
        const mine = applications.find((a) => a.postId === id && a.applicantId === viewer.id)

        const eligibility = canApplyToPost(
          {
            status: current.status,
            capacity: current.capacity,
            joinedCount: current.joinedCount,
            startsAt: current.startsAt,
            creator: current.creator,
            minSkillLevel: current.minSkillLevel,
            myApplication: mine ?? null,
          },
          viewer.id,
          at,
          { mySkillLevel: myProfile?.skillLevel ?? null },
        )

        if (!eligibility.allowed) {
          const code =
            eligibility.reason === 'gender-mismatch' || eligibility.reason === 'skill-too-low'
              ? 'FORBIDDEN'
              : 'CONFLICT'
          return err({ code, message: eligibility.message, details: { reason: eligibility.reason } })
        }

        const message = input.message ?? null

        // `WITHDRAWN → PENDING`：复用同一行（规格 §2.8，`@@unique([postId, applicantId])`）
        if (mine !== undefined && mine.status === 'WITHDRAWN') {
          if (!canTransitionApplication('WITHDRAWN', 'PENDING')) {
            return err({ code: 'CONFLICT', message: '当前申请状态不允许重新申请' })
          }
          const revived: BuddyApplication = {
            ...mine,
            status: 'PENDING',
            message,
            createdAt: at.toISOString(),
            decidedAt: null,
          }
          applications = applications.map((a) => (a.id === mine.id ? revived : a))
          return ok(clone(revived))
        }

        const created: BuddyApplication = {
          id: nextId('ba'),
          postId: id,
          applicantId: viewer.id,
          applicantName: viewer.nickname,
          message,
          status: 'PENDING',
          createdAt: at.toISOString(),
          decidedAt: null,
        }
        applications = [...applications, created]
        return ok(clone(created))
      })
    },

    leave(id, idempotencyKey): Result<BuddyApplication, RepositoryError> {
      const viewer = me()
      if (viewer === null) {
        return err({ code: 'UNAUTHENTICATED', message: '登录后才能撤回申请' })
      }

      return withIdempotency('leave', idempotencyKey, { id }, () => {
        const mine = applications.find((a) => a.postId === id && a.applicantId === viewer.id)
        if (mine === undefined) {
          return err({ code: 'NOT_FOUND', message: '你还没有申请过这个活动' })
        }
        if (!canTransitionApplication(mine.status, 'WITHDRAWN')) {
          return err({
            code: 'CONFLICT',
            message: mine.status === 'ACCEPTED' ? '申请已被接受，无法撤回' : '当前申请状态无法撤回',
            details: { reason: mine.status },
          })
        }

        const withdrawn: BuddyApplication = { ...mine, status: 'WITHDRAWN' }
        applications = applications.map((a) => (a.id === mine.id ? withdrawn : a))
        return ok(clone(withdrawn))
      })
    },

    close(id, idempotencyKey): Result<BuddyPost, RepositoryError> {
      const viewer = me()
      if (viewer === null) {
        return err({ code: 'UNAUTHENTICATED', message: '登录后才能关闭招募' })
      }

      return withIdempotency('close', idempotencyKey, { id }, () => {
        const current = findRaw(id)
        if (current === undefined) {
          return err({ code: 'NOT_FOUND', message: '活动不存在或已被下架' })
        }
        if (current.creator.id !== viewer.id) {
          return err({ code: 'FORBIDDEN', message: '只有发起人可以关闭招募' })
        }

        const status = derivePostStatus(current, now())
        if (!canTransitionPost(status, 'CLOSED')) {
          return err({ code: 'CONFLICT', message: '当前状态无法关闭', details: { reason: status } })
        }

        const updated: BuddyPost = { ...current, status: 'CLOSED', updatedAt: now().toISOString() }
        posts = posts.map((p) => (p.id === id ? updated : p))
        return ok(clone({ ...updated, myApplication: null }))
      })
    },

    decide(id, input): Result<BuddyPost, RepositoryError> {
      const viewer = me()
      if (viewer === null) {
        return err({ code: 'UNAUTHENTICATED', message: '登录后才能审批申请' })
      }

      return withIdempotency(
        'decide',
        input.idempotencyKey,
        { id, applicationId: input.applicationId, decision: input.decision },
        () => {
          const current = findRaw(id)
          if (current === undefined) {
            return err({ code: 'NOT_FOUND', message: '活动不存在或已被下架' })
          }
          if (current.creator.id !== viewer.id) {
            return err({ code: 'FORBIDDEN', message: '只有发起人可以审批申请' })
          }

          const application = applications.find(
            (a) => a.id === input.applicationId && a.postId === id,
          )
          if (application === undefined) {
            return err({ code: 'NOT_FOUND', message: '申请不存在' })
          }
          if (!canTransitionApplication(application.status, input.decision)) {
            return err({
              code: 'CONFLICT',
              message: '该申请已被处理过',
              details: { reason: application.status },
            })
          }

          const at = now()
          const accepted = input.decision === 'ACCEPTED'
          if (accepted && current.joinedCount >= current.capacity) {
            return err({ code: 'CONFLICT', message: '人数已满', details: { reason: 'POST_FULL' } })
          }

          const decided: BuddyApplication = {
            ...application,
            status: input.decision,
            decidedAt: at.toISOString(),
          }
          applications = applications.map((a) => (a.id === decided.id ? decided : a))

          const joinedCount = accepted ? current.joinedCount + 1 : current.joinedCount
          const updated: BuddyPost = {
            ...current,
            joinedCount,
            status: derivePostStatus({ ...current, joinedCount }, at),
            updatedAt: at.toISOString(),
          }
          posts = posts.map((p) => (p.id === id ? updated : p))
          return ok(clone({ ...updated, myApplication: null }))
        },
      )
    },

    listApplications(postId): Result<BuddyApplicationPage, RepositoryError> {
      const viewer = me()
      if (viewer === null) {
        return err({ code: 'UNAUTHENTICATED', message: '登录后才能查看申请列表' })
      }
      const current = findRaw(postId)
      if (current === undefined) {
        return err({ code: 'NOT_FOUND', message: '活动不存在或已被下架' })
      }
      // 规格 §6.1 可见性矩阵：申请人列表**仅发起人**可见
      if (current.creator.id !== viewer.id) {
        return err({ code: 'FORBIDDEN', message: '只有发起人可以查看申请列表' })
      }
      const items = applications
        .filter((a) => a.postId === postId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      return ok({ items: items.map(clone), nextCursor: null })
    },

    recommendations(section, limit): BuddyRecommendationPage {
      const viewer = me()
      const at = now()
      const take = clampLimit(limit, 10)

      const sectionPosts = posts.filter((p) => sectionOf(p.activity) === section)
      const myProfile = viewer === null ? undefined : profiles.find((p) => p.userId === viewer.id)

      // 未开启匹配 / 没有资料：不报错，退化为「按时间排序」（规格 §5.7 末段）
      // —— 这保证「没填资料也能用」。
      if (viewer === null || myProfile === undefined || !myProfile.matchEnabled) {
        const items: BuddyRecommendation[] = sectionPosts
          .filter((p) => visibleInList(p, at) && derivePostStatus(p, at) === 'OPEN')
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
          .slice(0, take)
          .map((p) => ({ post: withMyApplication(p), score: 0, reason: '按时间排序', reasons: [] }))
        return { items, nextCursor: null, matchMode: 'rule' }
      }

      const viewerSubject = buildMatchSubject(myProfile)
      const adjustments = feedbackAdjustment(
        feedbacksForSection(section, viewer.id).map((f) => ({
          targetPostId: f.targetPostId,
          action: f.action,
          createdAt: new Date(f.createdAt),
        })),
        at,
      )

      const scored: BuddyRecommendation[] = []

      for (const p of sectionPosts) {
        const creatorProfile = profiles.find((x) => x.userId === p.creator.id)
        const target = { creator: buildMatchSubject(creatorProfile), tags: p.tags }

        const availabilityOverlaps = availabilityOverlapsPost(myProfile.availability, p)
        const alreadyApplied = applications.some(
          (a) =>
            a.postId === p.id &&
            a.applicantId === viewer.id &&
            (a.status === 'PENDING' || a.status === 'ACCEPTED'),
        )

        const hard = applyHardFilters(
          {
            status: derivePostStatus(p, at),
            joinedCount: p.joinedCount,
            capacity: p.capacity,
            startsAt: new Date(p.startsAt),
            creatorId: p.creator.id,
            viewerId: viewer.id,
            alreadyApplied,
            // ⚠️ F5 的诚实说明：`BuddyProfile` **不采集性别**（规格 §6.3），
            // 客户端无法独立判定性别准入，因此这里恒为 true ——
            // 最终判定由服务端在 `join` 时返回 `FORBIDDEN`。客户端的角色是
            // 提前给出好文案，不是替代服务端校验。
            genderCompatible: true,
            minSkillLevel: p.minSkillLevel,
            viewerSkillLevel: myProfile.skillLevel,
            availabilityOverlaps,
            skillRank,
          },
          at,
        )

        if (!hard.pass) continue

        // 与服务端**同一套**纯函数（`@kedaya/shared`）—— 这是可解释性要求的前提
        const reasons = explainMatch(section, viewerSubject, target, { availabilityOverlaps })
        const ruleScore = ruleScoreFor(section, viewerSubject, target, { availabilityOverlaps })
        const adjustment = adjustments.get(p.id) ?? 0
        const score = round3(fuseScore({ mode: 'rule', ruleScore, feedbackAdjustment: adjustment }))

        scored.push({
          post: withMyApplication(p),
          score,
          // 取前 3 条拼接（对齐 `matching.py:265-301`）；无命中时回落「有潜在匹配」
          reason:
            reasons.length === 0
              ? '有潜在匹配'
              : reasons
                  .slice(0, 3)
                  .map((r) => r.label)
                  .join('、'),
          reasons,
        })
      }

      scored.sort((a, b) => b.score - a.score || a.post.startsAt.localeCompare(b.post.startsAt))

      return { items: scored.slice(0, take), nextCursor: null, matchMode: 'rule' }
    },

    feedback(id, input): Result<BuddyFeedbackResult, RepositoryError> {
      const viewer = me()
      if (viewer === null) {
        return err({ code: 'UNAUTHENTICATED', message: '登录后才能提交反馈' })
      }
      const current = findRaw(id)
      if (current === undefined) {
        return err({ code: 'NOT_FOUND', message: '活动不存在或已被下架' })
      }
      if (input.action !== 'like' && input.action !== 'dislike' && input.action !== 'skip') {
        return err({
          code: 'VALIDATION_FAILED',
          message: '反馈动作非法',
          details: { reason: input.action },
        })
      }

      // UPSERT：(userId, targetPostId, section) 唯一 —— 同一帖同一板块只保留最后一次
      const existingIndex = feedbacks.findIndex(
        (f) => f.userId === viewer.id && f.targetPostId === id && f.section === input.section,
      )
      const record: MockBuddyFeedback = {
        userId: viewer.id,
        targetPostId: id,
        section: input.section,
        action: input.action,
        createdAt: now().toISOString(),
      }
      feedbacks =
        existingIndex === -1
          ? [...feedbacks, record]
          : feedbacks.map((f, i) => (i === existingIndex ? record : f))

      return ok({ action: input.action })
    },

    getProfile(): BuddyProfile | null {
      const viewer = me()
      if (viewer === null) return null
      const found = profiles.find((p) => p.userId === viewer.id)
      return found === undefined ? null : clone(found)
    },

    putProfile(profile, idempotencyKey): Result<BuddyProfile, RepositoryError> {
      const viewer = me()
      if (viewer === null) {
        return err({ code: 'UNAUTHENTICATED', message: '登录后才能保存匹配资料' })
      }

      // `PUT` 的幂等键是可选的（契约 §11.3）—— 有则参与幂等，无则直接执行
      const work = (): Result<BuddyProfile, RepositoryError> => {
        /**
         * ⚠️ **先校验原始输入，再规范化** —— 顺序不能反。
         *
         * `normalizeBuddyProfile` 会**静默丢弃**非法项（它面向的是从网络读回的
         * 不可信数据，防御性解析是对的）。但如果先规范化再校验，用户的非法输入
         * 会被悄悄抹掉然后「保存成功」—— 例如把「结束时间早于开始时间」的时段
         * 丢掉后留下空数组，校验通过，用户以为存上了。
         *
         * 规格 §2.2 的约束是**硬约束**：非法输入必须返回 `VALIDATION_FAILED`。
         * 因此服务端语义 = 校验 → 拒绝；规范化只用于**读**路径。
         */
        const validation = validateBuddyProfile({ ...profile, userId: viewer.id })
        if (!validation.ok) {
          const first = validation.errors[0]
          return err({
            code: 'VALIDATION_FAILED',
            message: first?.message ?? '匹配资料不合法',
            details: { field: first?.field ?? 'unknown' },
          })
        }

        const normalized = normalizeBuddyProfile({ ...profile, userId: viewer.id })
        const saved: BuddyProfile = {
          ...normalized,
          userId: viewer.id,
          updatedAt: now().toISOString(),
        }
        const exists = profiles.some((p) => p.userId === viewer.id)
        profiles = exists
          ? profiles.map((p) => (p.userId === viewer.id ? saved : p))
          : [...profiles, saved]
        return ok(clone(saved))
      }

      if (idempotencyKey === undefined || idempotencyKey.trim() === '') return work()
      return withIdempotency('profile', idempotencyKey, profile, work)
    },

    deleteProfile(): Result<true, RepositoryError> {
      const viewer = me()
      if (viewer === null) {
        return err({ code: 'UNAUTHENTICATED', message: '登录后才能删除匹配资料' })
      }
      // 硬删（含 embedding）—— 规格 §6.3：撤回后立即从推荐池移除
      profiles = profiles.filter((p) => p.userId !== viewer.id)
      return ok(true)
    },

    addDemoApplication(postId): Result<BuddyApplication, RepositoryError> {
      const viewer = me()
      if (viewer === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录' })
      }
      const current = findRaw(postId)
      if (current === undefined) {
        return err({ code: 'NOT_FOUND', message: '活动不存在' })
      }
      if (current.creator.id !== viewer.id) {
        return err({ code: 'FORBIDDEN', message: '只有发起人可以收到申请' })
      }

      // 挑一个还没申请过的种子用户，让「审批」流程可反复演示
      const candidates: Array<{ id: string; name: string }> = [
        { id: 'u-0001', name: '张同学' },
        { id: 'u-0002', name: '李同学' },
        { id: 'u-0003', name: '王同学' },
      ]
      const fallback = { id: 'u-0002', name: '李同学' }
      const used = new Set(
        applications.filter((a) => a.postId === postId).map((a) => a.applicantId),
      )
      const next = candidates.find((c) => !used.has(c.id)) ?? fallback

      const created: BuddyApplication = {
        id: nextId('ba'),
        postId,
        applicantId: next.id,
        applicantName: next.name,
        message: '（演示）我可以加入吗？',
        status: 'PENDING',
        createdAt: now().toISOString(),
        decidedAt: null,
      }
      applications = [...applications, created]
      return ok(clone(created))
    },

    clear(): void {
      posts = []
      profiles = []
      applications = []
      feedbacks = []
      idempotency = new Map()
    },

    reset(): void {
      posts = seedPosts.map(clone)
      profiles = seedProfiles.map(clone)
      applications = seedApplications.map(clone)
      feedbacks = seedFeedback.map(clone)
      idempotency = new Map()
      sequence = 0
    },
  }
}
