import { err, ok, type Result } from '@kedaya/shared'
import type { Page } from '@kedaya/contracts'

import {
  LOST_FOUND_STATUS,
  contactHintProblem,
  descriptionProblem,
  happenedAtProblem,
  isLostFoundKind,
  isLostFoundSort,
  isLostFoundStatus,
  kindProblem,
  placeProblem,
  titleProblem,
} from '../../domain/models/lostFound'
import type {
  CreateLostFoundItemInput,
  LostFoundItem,
  LostFoundItemFilters,
  LostFoundSort,
  UpdateLostFoundItemInput,
} from '../../domain/models/lostFound'
import type { CachePort } from '../../domain/ports/cachePort'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListLostFoundItemsQuery,
  LostFoundRepository,
} from '../../domain/ports/lostFoundRepository'
import { StorageKeys } from '../storage/keys'

/**
 * Mock 失物招领仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 与「假列表」不同，它**复刻了后端 `LostFoundItemService` 的领域规则**：
 *   · 归属：只有发布者能改 / 删 / resolve / reopen，否则 FORBIDDEN；
 *   · 状态机：open ↔ resolved —— resolve 幂等冲突、reopen 反向且清空 resolvedAt；
 *   · 校验：类型白名单、标题 / 地点必填、事发时间 5 分钟时钟偏差、文本长度；
 *   · 筛选与排序：kind / status / 关键词 / 地点 / mine，按 happenedAt（+ id）排序。
 *
 * 数据落在 `CachePort`（默认 Taro Storage），因此**刷新页面后自己发布的信息还在**，
 * 真的可以当「轻量本地后端」用。存储 key 刻意与列表缓存 key 分开：
 * 列表缓存存的是 `{ items, nextCursor, updatedAt }`（契约 §8 hydrate 用），
 * 若两者共用同一个 key，一次 `list.load()` 就会把数据集覆盖成缓存载荷。
 *
 * 当前用户通过 `viewerId()` 注入 —— 用户从「我的」登录后切换，
 * mock 才能正确判定「这是我发布的」。
 */

export interface MockLostFoundRepositoryOptions {
  cache: CachePort
  viewerId: () => string | null
  latencyMs?: number
  now?: () => Date
}

export interface MockLostFoundRepository extends LostFoundRepository {
  readonly kind: 'mock'
  reset(): void
  /** 让接下来 N 次请求失败（页面用它演示错误态，而不是硬编码假状态） */
  failNextRequests(times: number): void
  /** 清空数据集（演示空态）；`reset()` 之后仍能恢复种子 */
  clearAll(): void
  /** 仅供测试 / 演示：直接替换数据集，保证用例确定可复现 */
  seed(items: readonly LostFoundItem[]): void
}

const MOCK_DB_KEY = `${StorageKeys.lostFoundListCache}:mock-db`

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function defaultSeed(now: Date): LostFoundItem[] {
  const iso = (minutesAgo: number): string =>
    new Date(now.getTime() - minutesAgo * 60_000).toISOString()

  const items: Array<Omit<LostFoundItem, 'createdAt' | 'updatedAt' | 'imageUrls'>> = [
    {
      id: 'lf-demo-1',
      reporterId: 'mock-reporter-1',
      kind: 'lost',
      title: '黑色雨伞（伞柄贴了小黄鸭贴纸）',
      description: '周三下午在图书馆四楼自习时忘在座位上了，伞套是灰色的。',
      place: '图书馆四楼自习区',
      happenedAt: iso(90),
      contactHint: '站内私信',
      status: 'open',
      resolvedAt: null,
    },
    {
      id: 'lf-demo-2',
      reporterId: 'mock-reporter-2',
      kind: 'found',
      title: '捡到一张校园卡（姓名已打码）',
      description: '卡面磨损较多，已交到二食堂失物招领柜，请凭学号后四位认领。',
      place: '二食堂二楼',
      happenedAt: iso(240),
      contactHint: '到失物招领柜认领',
      status: 'open',
      resolvedAt: null,
    },
    {
      id: 'lf-demo-3',
      reporterId: 'mock-reporter-3',
      kind: 'lost',
      title: '银色 AirPods 充电盒',
      description: '只有盒子，耳机还在我这儿。盒盖内侧刻了两个字母。',
      place: '体育馆羽毛球馆',
      happenedAt: iso(1_500),
      contactHint: null,
      status: 'resolved',
      resolvedAt: iso(1_200),
    },
    {
      id: 'lf-demo-4',
      reporterId: 'mock-reporter-1',
      kind: 'found',
      title: '一副黑框眼镜（带蓝色镜盒）',
      description: null,
      place: '教学楼 A 座 305 教室',
      happenedAt: iso(3_000),
      contactHint: '请到 A 座值班室认领',
      status: 'open',
      resolvedAt: null,
    },
  ]

  return items.map((item, index) => ({
    ...item,
    // 演示数据不带图（详见 mockFleaMarketRepository 里同一处说明）
    imageUrls: [],
    createdAt: iso(60 + index * 25),
    updatedAt: iso(60 + index * 25),
  }))
}

export function createMockLostFoundRepository(
  options: MockLostFoundRepositoryOptions,
): MockLostFoundRepository {
  const { cache, viewerId } = options
  const now = options.now ?? (() => new Date())
  const latencyMs = options.latencyMs ?? 180
  let remainingFailures = 0

  function load(): LostFoundItem[] {
    const stored = cache.read<unknown>(MOCK_DB_KEY)
    // 空数组是**合法状态**（用户清空了演示数据），必须与「从未初始化」区分开，
    // 否则 clearAll() 之后第一次读取就会把种子数据又塞回来。
    if (Array.isArray(stored)) return stored as LostFoundItem[]
    const seeded = defaultSeed(now())
    cache.write(MOCK_DB_KEY, seeded)
    return seeded
  }

  function save(items: LostFoundItem[]): void {
    cache.write(MOCK_DB_KEY, items)
  }

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  function find(items: LostFoundItem[], id: string): LostFoundItem | null {
    return items.find((item) => item.id === id) ?? null
  }

  /** 与后端 `create` 的归一化顺序一致：类型 → 标题 → 描述 → 地点 → 事发时间 → 联系方式 */
  function validateCreate(input: CreateLostFoundItemInput): RepositoryError | null {
    const kind = kindProblem(input.kind)
    if (kind !== null) return { code: 'VALIDATION_FAILED', message: kind, details: { field: 'kind' } }

    const title = titleProblem(input.title)
    if (title !== null) return { code: 'VALIDATION_FAILED', message: title, details: { field: 'title' } }

    const description = descriptionProblem(input.description ?? '')
    if (description !== null) {
      return { code: 'VALIDATION_FAILED', message: description, details: { field: 'description' } }
    }

    const place = placeProblem(input.place)
    if (place !== null) return { code: 'VALIDATION_FAILED', message: place, details: { field: 'place' } }

    const happenedAt = happenedAtProblem(new Date(input.happenedAt), now())
    if (happenedAt !== null) {
      return { code: 'VALIDATION_FAILED', message: happenedAt, details: { field: 'happenedAt' } }
    }

    const contact = contactHintProblem(input.contactHint ?? '')
    if (contact !== null) {
      return { code: 'VALIDATION_FAILED', message: contact, details: { field: 'contactHint' } }
    }
    return null
  }

  function validateUpdate(input: UpdateLostFoundItemInput): RepositoryError | null {
    if (input.kind !== undefined) {
      const problem = kindProblem(input.kind)
      if (problem !== null) {
        return { code: 'VALIDATION_FAILED', message: problem, details: { field: 'kind' } }
      }
    }
    if (input.title !== undefined) {
      const problem = titleProblem(input.title)
      if (problem !== null) {
        return { code: 'VALIDATION_FAILED', message: problem, details: { field: 'title' } }
      }
    }
    if (input.description !== undefined && input.description !== null) {
      const problem = descriptionProblem(input.description)
      if (problem !== null) {
        return { code: 'VALIDATION_FAILED', message: problem, details: { field: 'description' } }
      }
    }
    if (input.place !== undefined) {
      const problem = placeProblem(input.place)
      if (problem !== null) {
        return { code: 'VALIDATION_FAILED', message: problem, details: { field: 'place' } }
      }
    }
    if (input.happenedAt !== undefined) {
      const problem = happenedAtProblem(new Date(input.happenedAt), now())
      if (problem !== null) {
        return { code: 'VALIDATION_FAILED', message: problem, details: { field: 'happenedAt' } }
      }
    }
    if (input.contactHint !== undefined && input.contactHint !== null) {
      const problem = contactHintProblem(input.contactHint)
      if (problem !== null) {
        return { code: 'VALIDATION_FAILED', message: problem, details: { field: 'contactHint' } }
      }
    }
    return null
  }

  /**
   * 归属闸门 —— 顺序与后端 `assertOwner` 一致：
   * 先 `detail()`（不存在统一 NOT_FOUND），再判断未登录 / 非发布者。
   */
  function assertOwner(
    item: LostFoundItem,
    action: '修改' | '删除' | '标记为已解决' | '重新开放',
  ): RepositoryError | null {
    const viewer = viewerId()
    if (viewer === null) return { code: 'UNAUTHENTICATED', message: '请先登录' }
    if (item.reporterId !== viewer) {
      const message =
        action === '修改'
          ? '只能修改自己发布的信息'
          : action === '删除'
            ? '只能删除自己发布的信息'
            : `只有发布者可以${action}`
      return { code: 'FORBIDDEN', message }
    }
    return null
  }

  return {
    kind: 'mock',

    list(query: ListLostFoundItemsQuery): Promise<Result<Page<LostFoundItem>, RepositoryError>> {
      return guard(() => {
        const filters: LostFoundItemFilters = query.filters
        const viewer = viewerId()
        let items = load()

        if (filters.kind !== undefined && !isLostFoundKind(filters.kind)) {
          return err({ code: 'VALIDATION_FAILED', message: '信息类型不在支持范围内' })
        }
        if (filters.status !== undefined && !isLostFoundStatus(filters.status)) {
          return err({ code: 'VALIDATION_FAILED', message: '状态不在支持范围内' })
        }
        const sort: LostFoundSort = filters.sort ?? 'latest'
        if (!isLostFoundSort(sort)) {
          return err({ code: 'VALIDATION_FAILED', message: '排序方式不支持' })
        }

        if (filters.mine === true) {
          items = viewer === null ? [] : items.filter((item) => item.reporterId === viewer)
        }
        if (filters.kind !== undefined) {
          items = items.filter((item) => item.kind === filters.kind)
        }
        if (filters.status !== undefined) {
          items = items.filter((item) => item.status === filters.status)
        }
        if (filters.place !== undefined && filters.place.trim() !== '') {
          const place = filters.place.trim().toLowerCase()
          items = items.filter((item) => item.place.toLowerCase().includes(place))
        }
        if (filters.keyword !== undefined && filters.keyword.trim() !== '') {
          const keyword = filters.keyword.trim().toLowerCase()
          items = items.filter(
            (item) =>
              item.title.toLowerCase().includes(keyword) ||
              (item.description ?? '').toLowerCase().includes(keyword) ||
              item.place.toLowerCase().includes(keyword),
          )
        }

        // 排序在后端由数据库完成：happenedAt 为主键，id 为第二排序键（避免翻页跳项）
        items = [...items].sort((a, b) => {
          const diff = a.happenedAt.localeCompare(b.happenedAt)
          return sort === 'oldest' ? diff || a.id.localeCompare(b.id) : -diff || b.id.localeCompare(a.id)
        })

        const limit = query.limit ?? 20
        const start =
          query.cursor === null
            ? 0
            : Math.max(0, items.findIndex((item) => item.id === query.cursor) + 1)
        const visible = items.slice(start, start + limit)
        const hasMore = start + limit < items.length

        return ok({
          items: visible,
          nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
        })
      })
    },

    detail(id: string): Promise<Result<LostFoundItem, RepositoryError>> {
      return guard(() => {
        const found = find(load(), id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '失物招领信息不存在或已被删除' })
        return ok(found)
      })
    },

    create(input: CreateLostFoundItemInput): Promise<Result<LostFoundItem, RepositoryError>> {
      return guard(() => {
        const viewer = viewerId()
        if (viewer === null) {
          return err({ code: 'UNAUTHENTICATED', message: '请先登录后再发布失物招领' })
        }
        const problem = validateCreate(input)
        if (problem !== null) return err(problem)

        const timestamp = now().toISOString()
        const item: LostFoundItem = {
          id: `lf-local-${String(now().getTime())}-${Math.random().toString(36).slice(2, 7)}`,
          // 发布者永远是登录主体，请求体里的 reporterId 会被忽略（后端同一规则）
          reporterId: viewer,
          kind: input.kind,
          title: input.title.trim(),
          description: normalizeOptionalText(input.description),
          place: input.place.trim(),
          happenedAt: new Date(input.happenedAt).toISOString(),
          contactHint: normalizeOptionalText(input.contactHint),
          imageUrls: input.imageUrls ?? [],
          status: LOST_FOUND_STATUS.open,
          resolvedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        save([item, ...load()])
        return ok(item)
      })
    },

    update(id: string, input: UpdateLostFoundItemInput): Promise<Result<LostFoundItem, RepositoryError>> {
      return guard(() => {
        const items = load()
        const found = find(items, id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '失物招领信息不存在或已被删除' })

        const owner = assertOwner(found, '修改')
        if (owner !== null) return err(owner)

        const problem = validateUpdate(input)
        if (problem !== null) return err(problem)

        // 注意：后端 update **不**限制状态 —— resolved 之后仍可改错别字
        const next: LostFoundItem = {
          ...found,
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.title === undefined ? {} : { title: input.title.trim() }),
          ...(input.description === undefined
            ? {}
            : { description: normalizeOptionalText(input.description) }),
          ...(input.place === undefined ? {} : { place: input.place.trim() }),
          ...(input.happenedAt === undefined
            ? {}
            : { happenedAt: new Date(input.happenedAt).toISOString() }),
          ...(input.contactHint === undefined
            ? {}
            : { contactHint: normalizeOptionalText(input.contactHint) }),
          ...(input.imageUrls === undefined ? {} : { imageUrls: input.imageUrls }),
          updatedAt: now().toISOString(),
        }
        save(items.map((item) => (item.id === id ? next : item)))
        return ok(next)
      })
    },

    remove(id: string): Promise<Result<{ id: string }, RepositoryError>> {
      return guard(() => {
        const items = load()
        const found = find(items, id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '失物招领信息不存在或已被删除' })

        const owner = assertOwner(found, '删除')
        if (owner !== null) return err(owner)

        save(items.filter((item) => item.id !== id))
        return ok({ id })
      })
    },

    resolve(id: string): Promise<Result<LostFoundItem, RepositoryError>> {
      return guard(() => {
        const items = load()
        const found = find(items, id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '失物招领信息不存在或已被删除' })

        const owner = assertOwner(found, '标记为已解决')
        if (owner !== null) return err(owner)

        if (found.status === LOST_FOUND_STATUS.resolved) {
          return err({ code: 'CONFLICT', message: '这条信息已经标记为已解决' })
        }

        const timestamp = now().toISOString()
        const next: LostFoundItem = {
          ...found,
          status: LOST_FOUND_STATUS.resolved,
          resolvedAt: timestamp,
          updatedAt: timestamp,
        }
        save(items.map((item) => (item.id === id ? next : item)))
        return ok(next)
      })
    },

    reopen(id: string): Promise<Result<LostFoundItem, RepositoryError>> {
      return guard(() => {
        const items = load()
        const found = find(items, id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '失物招领信息不存在或已被删除' })

        const owner = assertOwner(found, '重新开放')
        if (owner !== null) return err(owner)

        if (found.status !== LOST_FOUND_STATUS.resolved) {
          return err({ code: 'CONFLICT', message: '这条信息当前不是已解决状态' })
        }

        const next: LostFoundItem = {
          ...found,
          status: LOST_FOUND_STATUS.open,
          // 重新开放必须清空 resolvedAt，否则「已解决时间」会与新状态矛盾
          resolvedAt: null,
          updatedAt: now().toISOString(),
        }
        save(items.map((item) => (item.id === id ? next : item)))
        return ok(next)
      })
    },

    reset(): void {
      remainingFailures = 0
      cache.remove(MOCK_DB_KEY)
      load()
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    clearAll(): void {
      save([])
    },

    seed(items: readonly LostFoundItem[]): void {
      save([...items])
    },
  }
}

/** 与后端 `normalizeText` 一致：空串 / 未填都归一成 null */
function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = value.trim()
  return text.length === 0 ? null : text
}
