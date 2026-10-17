import type { Result } from '@kedaya/shared'
import { err } from '@kedaya/shared'

import {
  contactHintProblem,
  descriptionProblem,
  kindProblem,
  happenedAtProblem,
  parseHappenedAtInput,
  placeProblem,
  summarize,
  titleProblem,
} from '../../domain/models/lostFound'
import type {
  LostFoundItem,
  LostFoundItemFilters,
  LostFoundItemSummary,
  UpdateLostFoundItemInput,
} from '../../domain/models/lostFound'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { LostFoundRepository } from '../../domain/ports/lostFoundRepository'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 失物招领用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 列表与详情的**机制**来自 `application/common/*`（六个模块共用、单独有测试），
 * 本文件只负责模块特有的事：
 *   1. 把筛选条件翻译成仓储查询；
 *   2. 把行数据映射成卡片直接可读的 `LostFoundItemSummary`；
 *   3. 发布前做客户端校验（含「事发时间」文本解析，5 分钟时钟偏差），
 *      保证「发布者只能是自己」——`reporterId` 由服务端从 JWT 取。
 */

const PAGE_SIZE = 10

export interface LostFoundDraft {
  kind: string
  title: string
  description: string
  place: string
  /** 表单里的本地时间文本 `YYYY-MM-DD HH:mm` */
  happenedAtText: string
  contactHint: string
}

/**
 * 客户端校验（与服务端同一套规则，只做即时提示）。
 *
 * `now` 由调用方注入（页面的实时时钟 / 用例的 ClockPort），
 * 因此「事发时间不能晚于当前时间」这条判定可复现、可测试。
 */
export function validateDraft(draft: LostFoundDraft, now: Date): string[] {
  const problems: string[] = []

  const kind = kindProblem(draft.kind)
  if (kind !== null) problems.push(kind)

  const title = titleProblem(draft.title)
  if (title !== null) problems.push(title)

  const place = placeProblem(draft.place)
  if (place !== null) problems.push(place)

  const description = descriptionProblem(draft.description)
  if (description !== null) problems.push(description)

  const contact = contactHintProblem(draft.contactHint)
  if (contact !== null) problems.push(contact)

  if (draft.happenedAtText.trim() === '') {
    problems.push('请填写事发时间')
  } else {
    const happenedAt = parseHappenedAtInput(draft.happenedAtText)
    if (happenedAt === null) {
      problems.push('请按「YYYY-MM-DD HH:mm」填写事发时间')
    } else {
      const problem = happenedAtProblem(happenedAt, now)
      if (problem !== null) problems.push(problem)
    }
  }

  return problems
}

export interface LostFoundDeps {
  repository: LostFoundRepository
  cache: CachePort
  clock: ClockPort
  /** 列表缓存 key 由装配层注入 */
  cacheKey: string
  /** 当前登录用户 id（未登录为 null）—— 用来判定「这是我发布的」 */
  viewerId: () => string | null
}

export interface LostFoundUseCases {
  list: ListUseCase<LostFoundItemFilters, LostFoundItemSummary>
  detail: DetailUseCase<LostFoundItem>
  /** 发布：本地校验 + 时间文本解析通过后才发请求 */
  create(draft: LostFoundDraft): Promise<Result<LostFoundItem, RepositoryError>>
  /** 修改 / 领域动作：成功后自动用服务端返回的实体刷新详情页 */
  update(id: string, input: UpdateLostFoundItemInput): Promise<Result<LostFoundItem, RepositoryError>>
  remove(id: string): Promise<Result<{ id: string }, RepositoryError>>
  resolve(id: string): Promise<Result<LostFoundItem, RepositoryError>>
  reopen(id: string): Promise<Result<LostFoundItem, RepositoryError>>
}

export function createLostFoundUseCases(deps: LostFoundDeps): LostFoundUseCases {
  const { repository, cache, clock, cacheKey, viewerId } = deps

  const list: ListUseCase<LostFoundItemFilters, LostFoundItemSummary> = createListUseCase<
    LostFoundItemFilters,
    LostFoundItem,
    LostFoundItemSummary
  >({
    cache,
    clock,
    cacheKey,
    defaultQuery: { sort: 'latest' },
    isCachedPage: createCachedPageGuard<LostFoundItem>(),
    fetchPage: (filters, cursor) => repository.list({ cursor, limit: PAGE_SIZE, filters }),
    // 每次映射时取当前用户：登录后重新 load 即可拿到正确的「我的」标记
    mapItem: (item, now) => summarize(item, viewerId(), now),
  })

  const detail = createDetailUseCase<LostFoundItem>((id) => repository.detail(id))

  return {
    list,
    detail,

    async create(draft) {
      if (viewerId() === null) {
        return err({ code: 'UNAUTHENTICATED', message: '请先登录后再发布失物招领' })
      }

      const problems = validateDraft(draft, clock.now())
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
      }

      // validateDraft 已保证可解析；这里再判一次只是为了让类型收窄
      const happenedAt = parseHappenedAtInput(draft.happenedAtText)
      if (happenedAt === null) {
        return err({ code: 'VALIDATION_FAILED', message: '请按「YYYY-MM-DD HH:mm」填写事发时间' })
      }

      const result = await repository.create({
        kind: draft.kind,
        title: draft.title.trim(),
        description: draft.description.trim() === '' ? null : draft.description.trim(),
        place: draft.place.trim(),
        happenedAt: happenedAt.toISOString(),
        contactHint: draft.contactHint.trim() === '' ? null : draft.contactHint.trim(),
      })
      if (result.ok) list.reset()
      return result
    },

    update: (id, input) => detail.mutate(() => repository.update(id, input)),

    async remove(id) {
      const result = await repository.remove(id)
      if (result.ok) list.reset()
      return result
    },

    resolve: (id) => detail.mutate(() => repository.resolve(id)),
    reopen: (id) => detail.mutate(() => repository.reopen(id)),
  }
}
