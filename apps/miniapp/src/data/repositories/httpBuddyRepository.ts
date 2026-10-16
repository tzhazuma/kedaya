import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

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
  BuddyRecommendationPage,
  BuddyRepository,
  CreateBuddyPostInput,
  DecideBuddyApplicationInput,
  JoinBuddyInput,
  ListBuddyItemsQuery,
} from '../../domain/ports/buddyRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端找搭子仓储 —— 契约 §6.1 的 CRUD 形状 + §11.2 的动作名：
 *
 * ```
 * GET    /api/v1/buddy/tags                  封闭标签表（§11.11 附属集合）
 * GET    /api/v1/buddy/profile
 * PUT    /api/v1/buddy/profile
 * DELETE /api/v1/buddy/profile
 * GET    /api/v1/buddy/items                 列表（游标分页）
 * POST   /api/v1/buddy/items                 发布（必需 Idempotency-Key）
 * GET    /api/v1/buddy/items/:id
 * POST   /api/v1/buddy/items/:id/join        ← §11.2 已登记
 * POST   /api/v1/buddy/items/:id/leave       ← §11.2 已登记
 * POST   /api/v1/buddy/items/:id/close       ← §11.2 已登记
 * POST   /api/v1/buddy/items/:id/decide      ← §11.2 已登记
 * POST   /api/v1/buddy/items/:id/feedback    ← §11.2 已登记
 * GET    /api/v1/buddy/items/:id/applications  （§11.11 子集合列表）
 * GET    /api/v1/buddy/recommendations
 * ```
 *
 * 这里**只**做「URL + 类型」的映射：信封解包、Bearer、trace、401 重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * ⚠️ 游标**原样透传**（契约 §11.10-E）：本文件不得解析、构造或假设游标格式。
 */
export function createHttpBuddyRepository(client: ApiClient): BuddyRepository {
  return {
    async listTags(): Promise<Result<BuddyTag[], RepositoryError>> {
      const result = await client.get<BuddyTag[]>(modulePath('buddy', 'tags'))
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async listItems(query: ListBuddyItemsQuery = {}): Promise<Result<BuddyItemPage, RepositoryError>> {
      const section = query.section
      const result = await client.get<Page<BuddyPost>>(modulePath('buddy', 'items'), {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        section: section === undefined || section === 'all' ? undefined : section,
        // 规格 §5.3：`tags` 是逗号分隔的标签 key
        tags: query.tags === undefined || query.tags.length === 0 ? undefined : query.tags.join(','),
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({
        items: result.value.items,
        nextCursor: result.value.nextCursor,
        total: result.value.total,
      })
    },

    async itemDetail(id: string): Promise<Result<BuddyPost, RepositoryError>> {
      const result = await client.get<BuddyPost>(
        modulePath('buddy', 'items', encodeURIComponent(id)),
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async createItem(
      body: CreateBuddyPostInput,
      idempotencyKey?: string,
    ): Promise<Result<BuddyPost, RepositoryError>> {
      const result = await client.post<BuddyPost, CreateBuddyPostInput>(
        modulePath('buddy', 'items'),
        body,
        idempotencyKey === undefined ? undefined : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async join(
      id: string,
      input: JoinBuddyInput,
    ): Promise<Result<BuddyApplication, RepositoryError>> {
      const result = await client.post<BuddyApplication, { message?: string | null }>(
        modulePath('buddy', 'items', encodeURIComponent(id), 'join'),
        { message: input.message ?? null },
        input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async leave(
      id: string,
      idempotencyKey?: string,
    ): Promise<Result<BuddyApplication, RepositoryError>> {
      const result = await client.post<BuddyApplication>(
        modulePath('buddy', 'items', encodeURIComponent(id), 'leave'),
        {},
        idempotencyKey === undefined ? undefined : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async close(id: string, idempotencyKey?: string): Promise<Result<BuddyPost, RepositoryError>> {
      const result = await client.post<BuddyPost>(
        modulePath('buddy', 'items', encodeURIComponent(id), 'close'),
        {},
        idempotencyKey === undefined ? undefined : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async decide(
      id: string,
      input: DecideBuddyApplicationInput,
    ): Promise<Result<BuddyPost, RepositoryError>> {
      const result = await client.post<
        BuddyPost,
        { applicationId: string; decision: DecideBuddyApplicationInput['decision'] }
      >(
        modulePath('buddy', 'items', encodeURIComponent(id), 'decide'),
        { applicationId: input.applicationId, decision: input.decision },
        input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async listApplications(postId: string): Promise<Result<BuddyApplicationPage, RepositoryError>> {
      const result = await client.get<Page<BuddyApplication>>(
        modulePath('buddy', 'items', encodeURIComponent(postId), 'applications'),
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({ items: result.value.items, nextCursor: result.value.nextCursor })
    },

    async recommendations(
      section: BuddySection,
      limit?: number,
    ): Promise<Result<BuddyRecommendationPage, RepositoryError>> {
      const result = await client.get<Omit<BuddyRecommendationPage, 'items'> & {
        items: Array<{ post: BuddyPost; score: number; reason: string }>
      }>(modulePath('buddy', 'recommendations'), { section, limit: limit ?? 10 })
      if (!result.ok) return err(toRepositoryError(result.error))

      // 服务端的 `reason` 是拼好的字符串（规格 §5.7）。结构化理由由**客户端**
      // 用同一套 `explainMatch` 纯函数补出来（见 `application/buddy/buddyRecommendations`）——
      // 仓储层不重复实现算法，只透传 wire 字段。
      return ok({
        matchMode: result.value.matchMode,
        nextCursor: result.value.nextCursor,
        items: result.value.items.map((item) => ({ ...item, reasons: [] })),
      })
    },

    async feedback(
      id: string,
      input: { section: BuddySection; action: 'like' | 'dislike' | 'skip' },
    ): Promise<Result<BuddyFeedbackResult, RepositoryError>> {
      const result = await client.post<BuddyFeedbackResult, { section: BuddySection; action: string }>(
        modulePath('buddy', 'items', encodeURIComponent(id), 'feedback'),
        { section: input.section, action: input.action },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async getProfile(): Promise<Result<BuddyProfile | null, RepositoryError>> {
      const result = await client.get<BuddyProfile | null>(modulePath('buddy', 'profile'))
      if (!result.ok) {
        // 「还没填过」在部分实现里会返回 404；对客户端而言等价于 null（不是错误）
        if (result.error.code === 'NOT_FOUND') return ok(null)
        return err(toRepositoryError(result.error))
      }
      return ok(result.value)
    },

    async putProfile(
      profile: BuddyProfile,
      idempotencyKey?: string,
    ): Promise<Result<BuddyProfile, RepositoryError>> {
      const result = await client.put<BuddyProfile, BuddyProfile>(
        modulePath('buddy', 'profile'),
        profile,
        idempotencyKey === undefined ? undefined : { idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(result.value)
    },

    async deleteProfile(): Promise<Result<true, RepositoryError>> {
      const result = await client.del<true>(modulePath('buddy', 'profile'))
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(true)
    },
  }
}
