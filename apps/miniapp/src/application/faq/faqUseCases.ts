import { err } from '@kedaya/shared'
import type { Result } from '@kedaya/shared'

import {
  answerProblem,
  categoryProblem,
  parseTagsText,
  questionProblem,
  summarize,
  tagsProblem,
} from '../../domain/models/faq'
import type { FaqEntry, FaqEntryFilters, FaqEntrySummary } from '../../domain/models/faq'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { FaqRepository } from '../../domain/ports/faqRepository'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 常见问题用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 列表与详情的**机制**来自 `application/common/*`（六个模块共用、单独有测试），
 * 本文件只负责模块特有的事：
 *   1. 把筛选条件翻译成仓储查询（分类精确 + 关键词模糊）；
 *   2. 把行数据映射成卡片直接可读的 `FaqEntrySummary`；
 *   3. 新增前做客户端校验（与后端同一套规则，只做即时提示）；
 *   4. **帮助有它的去重**（见下）。
 *
 * ## 为什么「有帮助」的去重要放在这里
 *
 * 后端 `POST /faq/items/:id/helpful` 是**无脑 +1**（`helpfulCount: { increment: 1 }`）：
 * 它既不知道是谁点的（本模块允许匿名），也没有投票实体可以查重。于是
 * 「同一个人连点五次」会真的把热度刷成 6 —— 这不是后端偷懒，而是"无主体
 * 计数"这一设计下的必然结果。所以客户端必须自己记住「我标记过哪几条」，
 * 并且**不重复发请求**：本地记录写在 `CachePort` 里（默认 Taro Storage），
 * 重开小程序仍然生效。
 *
 * 要强调的边界：这层去重只能拦住**本机**的重复点击，拦不住换设备或直接
 * 调接口刷量。真要做到一人一票需要服务端加投票表（按主体去重），
 * 那是产品决策而不是客户端能兜住的 —— 页面上因此只把它显示成热度，
 * 不写成「N 人觉得有用」。
 */

const PAGE_SIZE = 10

/**
 * 本地「已标记有帮助」的记忆上限。
 *
 * 只用来避免重复点击，超出这个数量之后最早的那几条会被遗忘（用户很少
 * 回头翻几百条问答再点一次）。不设上限的话，这个数组会随使用时间无限增长，
 * 而小程序本地存储是有配额的（单 key 1 MB / 单域名 10 MB）。
 */
const HELPFUL_MARKS_MAX = 200

export interface FaqDraft {
  question: string
  answer: string
  /** 分类短码（来自 `FAQ_CATEGORIES` 白名单） */
  category: string
  /** 表单里的标签文本：`校园卡、补办` */
  tagsText: string
}

/**
 * 客户端校验（与服务端同一套规则，只做即时提示）。
 *
 * 返回**全部**问题而不是第一个：表单里一次把该改的地方都指出来，
 * 比让用户「改一个、再报一个」少几轮往返。
 */
export function validateDraft(draft: FaqDraft): string[] {
  const problems: string[] = []

  const question = questionProblem(draft.question)
  if (question !== null) problems.push(question)

  const answer = answerProblem(draft.answer)
  if (answer !== null) problems.push(answer)

  const category = categoryProblem(draft.category)
  if (category !== null) problems.push(category)

  const tags = tagsProblem(parseTagsText(draft.tagsText))
  if (tags !== null) problems.push(tags)

  return problems
}

export interface FaqDeps {
  repository: FaqRepository
  cache: CachePort
  clock: ClockPort
  /** 列表缓存 key 由装配层注入（application 不感知存储实现） */
  cacheKey: string
  /**
   * 「我已标记有帮助」的本地记录 key。
   * 与列表缓存分开：它是**用户行为**（不该被一次列表刷新覆盖），
   * 形状也不同（`string[]` vs `{ items, nextCursor, updatedAt }`）。
   */
  helpfulMarksKey: string
}

export interface FaqUseCases {
  list: ListUseCase<FaqEntryFilters, FaqEntrySummary>
  detail: DetailUseCase<FaqEntry>
  /** 新增条目：本地校验通过后提交，成功即让列表失效（返回列表能看到它） */
  create(draft: FaqDraft): Promise<Result<FaqEntry, RepositoryError>>
  /**
   * 标记有帮助。本机已标记过时**不发请求**，直接返回 CONFLICT
   * （页面把它当成「你已经点过了」而不是错误弹窗）。
   */
  markHelpful(id: string): Promise<Result<FaqEntry, RepositoryError>>
  /** 本机是否已经标记过这一条（同步读缓存，供按钮初态使用） */
  isMarkedHelpful(id: string): boolean
}

export function createFaqUseCases(deps: FaqDeps): FaqUseCases {
  const { repository, cache, clock, cacheKey, helpfulMarksKey } = deps

  function readMarks(): string[] {
    const stored = cache.read<unknown>(helpfulMarksKey)
    if (!Array.isArray(stored)) return []
    return stored.filter((item): item is string => typeof item === 'string')
  }

  function writeMarks(marks: readonly string[]): void {
    cache.write(helpfulMarksKey, marks.slice(0, HELPFUL_MARKS_MAX))
  }

  const list: ListUseCase<FaqEntryFilters, FaqEntrySummary> = createListUseCase<
    FaqEntryFilters,
    FaqEntry,
    FaqEntrySummary
  >({
    cache,
    clock,
    cacheKey,
    // 默认不带任何筛选：首屏就是全库最新，筛选是用户的主动动作
    defaultQuery: {},
    isCachedPage: createCachedPageGuard<FaqEntry>(),
    fetchPage: (filters, cursor) => repository.list({ cursor, limit: PAGE_SIZE, filters }),
    mapItem: (entry, now) => summarize(entry, now),
  })

  const detail = createDetailUseCase<FaqEntry>((id) => repository.detail(id))

  return {
    list,
    detail,

    async create(draft) {
      const problems = validateDraft(draft)
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
      }

      const result = await repository.create({
        question: draft.question.trim(),
        answer: draft.answer.trim(),
        category: draft.category,
        tags: parseTagsText(draft.tagsText),
      })
      // 新条目要能立刻在列表里被检索到：清掉缓存与状态，由页面重新 load
      if (result.ok) list.reset()
      return result
    },

    async markHelpful(id) {
      const marks = readMarks()
      if (marks.includes(id)) {
        return err({ code: 'CONFLICT', message: '你已经标记过这一条有帮助了' })
      }

      const result = await repository.markHelpful(id)
      // 只有服务端确认之后才记本地：请求失败时应该允许用户重试
      if (result.ok) writeMarks([id, ...marks])
      return result
    },

    isMarkedHelpful: (id) => readMarks().includes(id),
  }
}
