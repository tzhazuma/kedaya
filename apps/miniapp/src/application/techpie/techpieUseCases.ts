import { err, type Result } from '@kedaya/shared'

import {
  categoryProblem,
  generateLinkKey,
  nameProblem,
  summarize,
  urlProblem,
} from '../../domain/models/techpie'
import type {
  TechpieLink,
  TechpieLinkFilters,
  TechpieLinkSummary,
} from '../../domain/models/techpie'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { TechpieRepository } from '../../domain/ports/techpieRepository'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 服务目录用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 列表与详情的**机制**来自 `application/common/*`（各模块共用、单独有测试），
 * 本文件只负责本模块特有的事：
 *   1. 把筛选条件（分类精确 / 关键词模糊）翻译成仓储查询；
 *   2. 把行数据映射成卡片直接可读的 `TechpieLinkSummary`（分类标签、状态标签、
 *      最后核对时间、地址域名）；
 *   3. 发布前做客户端校验并生成后端要求的 `key`。
 *
 * 没有 `viewerId`：本模块匿名共建（后端 `create` 忽略登录主体），
 * 没有"我添加的"这类判定，也就没有归属相关的动作。
 */

const PAGE_SIZE = 10

/**
 * 新建表单的草稿。
 *
 * 只有三样：名称 / 分类 / 地址。**没有"说明"**——因为服务端那张表没有说明列
 * （见 `domain/models/techpie.ts` 文件头）。宁可表单里少一个字段，
 * 也不放一个提交后会被服务端静默丢掉的假字段。
 */
export interface TechpieDraft {
  name: string
  category: string
  url: string
}

/** 客户端校验（与服务端同一套规则，只做即时提示）。返回空数组表示可以提交。 */
export function validateDraft(draft: TechpieDraft): string[] {
  const problems: string[] = []
  const push = (problem: string | null): void => {
    if (problem !== null) problems.push(problem)
  }

  push(nameProblem(draft.name))
  push(categoryProblem(draft.category))
  push(urlProblem(draft.url))

  return problems
}

export interface TechpieDeps {
  repository: TechpieRepository
  cache: CachePort
  clock: ClockPort
  /** 列表缓存 key 由装配层注入（application 不感知存储实现） */
  cacheKey: string
}

export interface TechpieUseCases {
  list: ListUseCase<TechpieLinkFilters, TechpieLinkSummary>
  detail: DetailUseCase<TechpieLink>
  /** 新增服务条目：本地校验通过后才发请求；`key` 由客户端生成 */
  create(draft: TechpieDraft): Promise<Result<TechpieLink, RepositoryError>>
  /**
   * 「我核对过了」。
   *
   * ⚠️ 它**不是**去对方系统同步：后端只是把 `status` 写成 `synced`
   * （见 `domain/ports/techpieRepository.ts` 的说明）。
   * 走 `detail.mutate`：成功后用服务端返回的实体刷新详情，而不是乐观改本地状态
   * ——「以为核对过了其实没写进去」不可接受。
   */
  sync(id: string): Promise<Result<TechpieLink, RepositoryError>>
}

export function createTechpieUseCases(deps: TechpieDeps): TechpieUseCases {
  const { repository, cache, clock, cacheKey } = deps

  const list: ListUseCase<TechpieLinkFilters, TechpieLinkSummary> = createListUseCase<
    TechpieLinkFilters,
    TechpieLink,
    TechpieLinkSummary
  >({
    cache,
    clock,
    cacheKey,
    defaultQuery: {},
    isCachedPage: createCachedPageGuard<TechpieLink>(),
    fetchPage: (filters, cursor) => repository.list({ cursor, limit: PAGE_SIZE, filters }),
    mapItem: (link, now) => summarize(link, now),
  })

  const detail = createDetailUseCase<TechpieLink>((id) => repository.detail(id))

  return {
    list,
    detail,

    async create(draft) {
      const problems = validateDraft(draft)
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
      }

      const result = await repository.create({
        // key 是技术标识（后端唯一索引），交给客户端生成，不麻烦用户去想
        key: generateLinkKey(clock.now()),
        name: draft.name.trim(),
        category: draft.category,
        url: draft.url.trim(),
      })
      // 新条目必须能立刻出现在列表里，让列表缓存失效，下次进入重新拉取
      if (result.ok) list.reset()
      return result
    },

    sync: (id) => detail.mutate(() => repository.sync(id)),
  }
}
