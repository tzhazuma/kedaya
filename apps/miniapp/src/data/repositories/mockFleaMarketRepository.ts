import { err, ok, type Result } from '@kedaya/shared'
import type { Page } from '@kedaya/contracts'

import type {
  CreateFleaItemInput,
  FleaItem,
  FleaItemFilters,
  UpdateFleaItemInput,
} from '../../domain/models/fleaMarket'
import type { CachePort } from '../../domain/ports/cachePort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { FleaItemRepository, ListFleaItemsQuery } from '../../domain/ports/fleaMarketRepository'
import { StorageKeys } from '../storage/keys'

/**
 * Mock 跳蚤仓储（`TARO_APP_USE_MOCK !== 'false'` 时启用）。
 *
 * 与旧骨架的「假列表」不同，它**复刻了后端的领域规则**：
 *   · 归属校验：只有发布者能改 / 删 / 标记售出，否则 FORBIDDEN；
 *   · 状态机：on-sale → reserved → sold，非法跃迁返回 CONFLICT；
 *   · 数据落在 `CachePort` 里，因此**刷新页面后自己发布的商品还在**
 *     （默认存款到 Taro Storage），真的能当"轻量本地后端"用。
 *
 * 当前用户通过 `viewerId()` 注入 —— 用户从「我的」登录后切换，
 * mock 才能正确判定"这是我发的"。
 */

export interface MockFleaMarketRepositoryOptions {
  cache: CachePort
  viewerId: () => string | null
  viewerName?: () => string
  latencyMs?: number
  now?: () => Date
  seed?: readonly FleaItem[]
}

export interface MockFleaMarketRepository extends FleaItemRepository {
  readonly kind: 'mock'
  reset(): void
  failNextRequests(times: number): void
  clearAll(): void
}

const STORAGE_KEY = StorageKeys.fleaMarketListCache

function defaultSeed(now: Date): FleaItem[] {
  const iso = (minutesAgo: number): string =>
    new Date(now.getTime() - minutesAgo * 60_000).toISOString()

  const items: Array<Omit<FleaItem, 'createdAt' | 'updatedAt'>> = [
    {
      id: 'flea-demo-1',
      sellerId: 'mock-seller-1',
      title: '九成新机械键盘（青轴）',
      description: '宿舍用了一学期，手感很好，因为换了静音的所以出掉。可当面试轴。',
      priceFen: 12_800,
      category: 'electronics',
      condition: 'like-new',
      campusSpot: '二号宿舍楼下',
      status: 'on-sale',
      reservedById: null,
      soldAt: null,
    },
    {
      id: 'flea-demo-2',
      sellerId: 'mock-seller-2',
      title: '《线性代数》教材 + 习题册',
      description: '有少量笔记，不影响阅读。',
      priceFen: 1_500,
      category: 'books',
      condition: 'good',
      campusSpot: '教学楼 A 座',
      status: 'on-sale',
      reservedById: null,
      soldAt: null,
    },
    {
      id: 'flea-demo-3',
      sellerId: 'mock-seller-3',
      title: '羽毛球拍一对',
      description: '只是周末打了几次，拍线还很紧。',
      priceFen: 8_000,
      category: 'sports',
      condition: 'like-new',
      campusSpot: '体育馆门口',
      status: 'reserved',
      reservedById: 'mock-buyer-1',
      soldAt: null,
    },
    {
      id: 'flea-demo-4',
      sellerId: 'mock-seller-1',
      title: 'USB-C 充电头（65W）',
      description: null,
      priceFen: 4_500,
      category: 'electronics',
      condition: 'good',
      campusSpot: null,
      status: 'sold',
      reservedById: null,
      soldAt: iso(30),
    },
  ]

  return items.map((item, index) => ({
    ...item,
    createdAt: iso(120 - index * 20),
    updatedAt: iso(120 - index * 20),
  }))
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createMockFleaMarketRepository(
  options: MockFleaMarketRepositoryOptions,
): MockFleaMarketRepository {
  const { cache, viewerId } = options
  const now = options.now ?? (() => new Date())
  const latencyMs = options.latencyMs ?? 180
  let remainingFailures = 0

  function load(): FleaItem[] {
    const stored = cache.read<unknown>(STORAGE_KEY)
    // 注意：空数组是**合法状态**（用户把演示数据清空了），必须与"从未初始化"区分开，
    // 否则 clearAll() 之后第一次读取就会把种子数据又塞回来。
    if (Array.isArray(stored)) return stored as FleaItem[]
    const seeded = options.seed !== undefined ? [...options.seed] : defaultSeed(now())
    if (seeded.length > 0) cache.write(STORAGE_KEY, seeded)
    return seeded
  }

  function save(items: FleaItem[]): void {
    cache.write(STORAGE_KEY, items)
  }

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  function find(items: FleaItem[], id: string): FleaItem | null {
    return items.find((item) => item.id === id) ?? null
  }

  return {
    kind: 'mock',

    list(query: ListFleaItemsQuery): Promise<Result<Page<FleaItem>, RepositoryError>> {
      return guard(() => {
        const filters: FleaItemFilters = query.filters
        const viewer = viewerId()
        let items = load()

        if (filters.mine === true) {
          items = items.filter((item) => item.sellerId === viewer)
        }
        if (filters.category !== undefined) {
          items = items.filter((item) => item.category === filters.category)
        }
        if (filters.condition !== undefined) {
          items = items.filter((item) => item.condition === filters.condition)
        }
        if (filters.status !== undefined) {
          items = items.filter((item) => item.status === filters.status)
        }
        if (filters.keyword !== undefined && filters.keyword.trim() !== '') {
          const keyword = filters.keyword.trim().toLowerCase()
          items = items.filter(
            (item) =>
              item.title.toLowerCase().includes(keyword) ||
              (item.description ?? '').toLowerCase().includes(keyword),
          )
        }

        const sort = filters.sort ?? 'latest'
        items = [...items].sort((a, b) => {
          if (sort === 'price-asc') return a.priceFen - b.priceFen || a.id.localeCompare(b.id)
          if (sort === 'price-desc') return b.priceFen - a.priceFen || b.id.localeCompare(a.id)
          return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
        })

        const limit = query.limit ?? 20
        const start = query.cursor === null ? 0 : Math.max(0, items.findIndex((item) => item.id === query.cursor) + 1)
        const visible = items.slice(start, start + limit)
        const hasMore = start + limit < items.length

        return ok({
          items: visible,
          nextCursor: hasMore ? (visible.at(-1)?.id ?? null) : null,
          total: items.length,
        })
      })
    },

    detail(id: string): Promise<Result<FleaItem, RepositoryError>> {
      return guard(() => {
        const found = find(load(), id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '商品不存在或已被删除' })
        return ok(found)
      })
    },

    create(input: CreateFleaItemInput): Promise<Result<FleaItem, RepositoryError>> {
      return guard(() => {
        const viewer = viewerId()
        if (viewer === null) return err({ code: 'UNAUTHENTICATED', message: '请先登录后再发布商品' })

        const timestamp = now().toISOString()
        const item: FleaItem = {
          id: `flea-local-${String(now().getTime())}-${Math.random().toString(36).slice(2, 7)}`,
          sellerId: viewer,
          title: input.title,
          description: input.description ?? null,
          priceFen: input.priceFen,
          category: input.category,
          condition: input.condition ?? 'good',
          campusSpot: input.campusSpot ?? null,
          status: 'on-sale',
          reservedById: null,
          soldAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        save([item, ...load()])
        return ok(item)
      })
    },

    update(id: string, input: UpdateFleaItemInput): Promise<Result<FleaItem, RepositoryError>> {
      return guard(() => {
        const items = load()
        const found = find(items, id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '商品不存在或已被删除' })
        if (found.sellerId !== viewerId()) {
          return err({ code: 'FORBIDDEN', message: '只能修改自己发布的商品' })
        }
        if (found.status === 'sold') {
          return err({ code: 'CONFLICT', message: '已售出的商品不能再修改' })
        }

        const next: FleaItem = {
          ...found,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.priceFen === undefined ? {} : { priceFen: input.priceFen }),
          ...(input.category === undefined ? {} : { category: input.category }),
          ...(input.condition === undefined ? {} : { condition: input.condition }),
          ...(input.campusSpot === undefined ? {} : { campusSpot: input.campusSpot }),
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
        if (found === null) return err({ code: 'NOT_FOUND', message: '商品不存在或已被删除' })
        if (found.sellerId !== viewerId()) {
          return err({ code: 'FORBIDDEN', message: '只能删除自己发布的商品' })
        }
        save(items.filter((item) => item.id !== id))
        return ok({ id })
      })
    },

    reserve(id: string): Promise<Result<FleaItem, RepositoryError>> {
      return guard(() => {
        const viewer = viewerId()
        if (viewer === null) return err({ code: 'UNAUTHENTICATED', message: '请先登录后再预定' })

        const items = load()
        const found = find(items, id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '商品不存在或已被删除' })
        if (found.sellerId === viewer) {
          return err({ code: 'VALIDATION_FAILED', message: '不能预定自己发布的商品' })
        }
        if (found.status === 'reserved') return err({ code: 'CONFLICT', message: '该商品已被预定' })
        if (found.status === 'sold') return err({ code: 'CONFLICT', message: '该商品已售出' })

        const next: FleaItem = {
          ...found,
          status: 'reserved',
          reservedById: viewer,
          updatedAt: now().toISOString(),
        }
        save(items.map((item) => (item.id === id ? next : item)))
        return ok(next)
      })
    },

    release(id: string): Promise<Result<FleaItem, RepositoryError>> {
      return guard(() => {
        const items = load()
        const found = find(items, id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '商品不存在或已被删除' })
        if (found.sellerId !== viewerId()) {
          return err({ code: 'FORBIDDEN', message: '只有卖家可以解除预定' })
        }
        if (found.status !== 'reserved') {
          return err({ code: 'CONFLICT', message: '该商品当前没有被预定' })
        }

        const next: FleaItem = {
          ...found,
          status: 'on-sale',
          reservedById: null,
          updatedAt: now().toISOString(),
        }
        save(items.map((item) => (item.id === id ? next : item)))
        return ok(next)
      })
    },

    markSold(id: string): Promise<Result<FleaItem, RepositoryError>> {
      return guard(() => {
        const items = load()
        const found = find(items, id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '商品不存在或已被删除' })
        if (found.sellerId !== viewerId()) {
          return err({ code: 'FORBIDDEN', message: '只有卖家可以标记售出' })
        }
        if (found.status === 'sold') return err({ code: 'CONFLICT', message: '该商品已经售出' })

        const timestamp = now().toISOString()
        const next: FleaItem = {
          ...found,
          status: 'sold',
          soldAt: timestamp,
          updatedAt: timestamp,
        }
        save(items.map((item) => (item.id === id ? next : item)))
        return ok(next)
      })
    },

    reset(): void {
      remainingFailures = 0
      cache.remove(STORAGE_KEY)
      load()
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    clearAll(): void {
      save([])
    },
  }
}
