import type { Result } from '@kedaya/shared'
import { err } from '@kedaya/shared'

import {
  coordinateProblem,
  noteProblem,
  placeProblem,
  resolveCoordinate,
  speciesProblem,
  summarize,
} from '../../domain/models/wildlife'
import type {
  WildlifeSpot,
  WildlifeSpotFilters,
  WildlifeSpotSummary,
} from '../../domain/models/wildlife'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { WildlifeRepository } from '../../domain/ports/wildlifeRepository'
import { createDetailUseCase } from '../common/detailUseCase'
import type { DetailUseCase } from '../common/detailUseCase'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 校园动物观察点用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 列表与详情的**机制**来自 `application/common/*`（六个模块共用、单独有测试），
 * 本文件只负责本模块特有的事：
 *   1. 把草稿翻译成上报输入（含坐标兜底与文本归一化）；
 *   2. 把行数据映射成卡片直接可读的 `WildlifeSpotSummary`；
 *   3. 发布前的客户端校验 —— 与服务端同一套规则，只为"即时提示"，
 *      真正的裁决仍在后端。
 *
 * 没有 `viewerId`：本模块匿名（后端 `create` 忽略登录主体），
 * 没有"我上报的"这类判定，也就没有归属相关的动作。
 */

const PAGE_SIZE = 10

export interface WildlifeSpotDraft {
  species: string
  place: string
  /** 选填备注 */
  note: string
  /** 坐标是可选手填：平台没有「获取当前位置」能力，留空则用校园中心 */
  latitudeText: string
  longitudeText: string
}

/**
 * 客户端校验（与服务端同一套长度规则，只做即时提示）。
 *
 * 纯函数、不读时钟也不需要注入：本模块没有时间相关的校验（动物观察点
 * 和失物招领不同 —— "什么时候看到的"用相对时间描述就够了，
 * 不需要一个容易被手机时钟搞错的必填时间字段）。
 */
export function validateDraft(draft: WildlifeSpotDraft): string[] {
  const problems: string[] = []

  const species = speciesProblem(draft.species)
  if (species !== null) problems.push(species)

  const place = placeProblem(draft.place)
  if (place !== null) problems.push(place)

  const note = noteProblem(draft.note)
  if (note !== null) problems.push(note)

  const coordinate = coordinateProblem(draft.latitudeText, draft.longitudeText)
  if (coordinate !== null) problems.push(coordinate)

  return problems
}

export interface WildlifeDeps {
  repository: WildlifeRepository
  cache: CachePort
  clock: ClockPort
  /** 列表缓存 key 由装配层注入（application 不感知存储实现） */
  cacheKey: string
}

export interface WildlifeUseCases {
  list: ListUseCase<WildlifeSpotFilters, WildlifeSpotSummary>
  detail: DetailUseCase<WildlifeSpot>
  /** 上报：本地校验通过后才发请求 */
  create(draft: WildlifeSpotDraft): Promise<Result<WildlifeSpot, RepositoryError>>
  /**
   * 「我也看到了」：调领域动作，成功后用服务端返回的实体刷新详情页。
   *
   * 走 `detail.mutate` 而不是乐观改本地状态：确认**改的是共享状态**，
   * 只有服务端返回的 `status` 才算数（"以为确认了其实没确认"不可接受）。
   */
  confirm(id: string): Promise<Result<WildlifeSpot, RepositoryError>>
}

export function createWildlifeUseCases(deps: WildlifeDeps): WildlifeUseCases {
  const { repository, cache, clock, cacheKey } = deps

  const list: ListUseCase<WildlifeSpotFilters, WildlifeSpotSummary> = createListUseCase<
    WildlifeSpotFilters,
    WildlifeSpot,
    WildlifeSpotSummary
  >({
    cache,
    clock,
    cacheKey,
    defaultQuery: {},
    isCachedPage: createCachedPageGuard<WildlifeSpot>(),
    fetchPage: (filters, cursor) => repository.list({ cursor, limit: PAGE_SIZE, filters }),
    mapItem: (spot, now) => summarize(spot, now),
  })

  const detail = createDetailUseCase<WildlifeSpot>((id) => repository.detail(id))

  return {
    list,
    detail,

    async create(draft) {
      const problems = validateDraft(draft)
      if (problems.length > 0) {
        return err({ code: 'VALIDATION_FAILED', message: problems[0] ?? '请检查填写内容' })
      }

      const coordinate = resolveCoordinate(draft.latitudeText, draft.longitudeText)
      const result = await repository.create({
        species: draft.species.trim(),
        place: draft.place.trim(),
        lat: coordinate.latitude,
        lng: coordinate.longitude,
        note: draft.note.trim() === '' ? null : draft.note.trim(),
      })
      // 新上报的观察点必须能立刻出现在列表里
      if (result.ok) list.reset()
      return result
    },

    confirm: (id) => detail.mutate(() => repository.confirm(id)),
  }
}
