import { describe, expect, it } from 'vitest'

import { createListGroupBuysUseCase } from '../listGroupBuys'
import type { CachedGroupBuyList } from '../listGroupBuys'
import type { GroupBuy } from '../../../domain/models/groupbuy'
import type { CachePort } from '../../../domain/ports/cachePort'
import type { RepositoryError } from '../../../domain/ports/errors'
import type {
  GroupBuyPage,
  GroupBuyRepository,
  JoinGroupBuyInput,
  ListGroupBuysQuery,
} from '../../../domain/ports/groupbuyRepository'
import type { Result } from '@kedaya/shared'

/**
 * 列表用例测试 —— 契约 §8 启动时序的可执行规格。
 *
 * 用两个极小的假替身（假缓存 + 假仓储）验证：
 * - hydrate 是纯同步的、不碰网络
 * - load 失败时**静默降级**到缓存（不是把首屏打回错误页）
 * - 无缓存时才暴露 error 态
 * - loadMore 真的用游标续页
 */

/* ---------------- 假替身（刻意不 import data/ 下的实现，保持分层干净） ---------------- */

function createFakeCache(seed?: Record<string, unknown>): CachePort & { dump(): Record<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(seed ?? {}))
  return {
    read: <T>(key: string): T | null => (store.has(key) ? (store.get(key) as T) : null),
    write: <T>(key: string, value: T): void => {
      store.set(key, value)
    },
    remove: (key: string): void => {
      store.delete(key)
    },
    dump: () => Object.fromEntries(store),
  }
}

interface FakeRepository extends GroupBuyRepository {
  /** 依次消费的响应队列；空了以后默认返回空页 */
  queue: Array<Result<GroupBuyPage, RepositoryError>>
  queries: ListGroupBuysQuery[]
}

function createFakeRepository(
  responses: Array<Result<GroupBuyPage, RepositoryError>> = [],
): FakeRepository {
  const queue = [...responses]
  const queries: ListGroupBuysQuery[] = []
  return {
    queue,
    queries,
    async list(query: ListGroupBuysQuery = {}) {
      queries.push(query)
      const next = queue.shift()
      return next ?? { ok: true, value: { items: [], nextCursor: null, total: 0 } }
    },
    async detail(): Promise<Result<GroupBuy, RepositoryError>> {
      return { ok: false, error: { code: 'NOT_FOUND', message: '未实现' } }
    },
    async join(_id: string, _input: JoinGroupBuyInput): Promise<Result<GroupBuy, RepositoryError>> {
      return { ok: false, error: { code: 'INTERNAL', message: '未实现' } }
    },
  }
}

function groupBuy(id: string, participants = 1, target = 4): GroupBuy {
  return {
    id,
    title: `拼单 ${id}`,
    description: '描述',
    category: 'food',
    initiatorId: 'u-owner',
    initiatorName: '发起人',
    priceFen: 1000,
    targetCount: target,
    participants: Array.from({ length: participants }, (_unused, index) => ({
      id: `u-${index}`,
      displayName: `同学 ${index}`,
      anonymous: false,
      quantity: 1,
      joinedAt: '2026-10-16T10:00:00.000Z',
    })),
    deadline: '2026-10-20T12:00:00.000Z',
    pickupPlace: '测试地点',
    status: 'open',
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:30:00.000Z',
  }
}

const NOW = new Date('2026-10-16T12:00:00.000Z')
const CACHE_KEY = 'test:cache:groupbuy:list'

function createUseCase(
  repository: GroupBuyRepository,
  cache: CachePort,
): ReturnType<typeof createListGroupBuysUseCase> {
  return createListGroupBuysUseCase({
    repository,
    cache,
    clock: { now: () => NOW },
    cacheKey: CACHE_KEY,
  })
}

/* ---------------- 用例 ---------------- */

describe('listGroupBuys · hydrate（契约 §8 第 1 步）', () => {
  it('无缓存时保持 idle，且不触发任何请求', () => {
    const repo = createFakeRepository()
    const useCase = createUseCase(repo, createFakeCache())

    const state = useCase.hydrate()

    expect(state.status).toBe('idle')
    expect(state.items).toEqual([])
    expect(repo.queries).toHaveLength(0)
  })

  it('有缓存时同步产出 ready + fromCache，并给出派生摘要', () => {
    const cached: CachedGroupBuyList = {
      items: [groupBuy('gb-1', 3, 4)],
      nextCursor: 'gb-1',
      total: 1,
      updatedAt: '2026-10-16T11:00:00.000Z',
    }
    const repo = createFakeRepository()
    const useCase = createUseCase(repo, createFakeCache({ [CACHE_KEY]: cached }))

    const state = useCase.hydrate()

    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(true)
    expect(state.items).toHaveLength(1)
    expect(state.items[0]?.progressPercent).toBe(75)
    expect(state.items[0]?.remainingSlots).toBe(1)
    expect(state.nextCursor).toBe('gb-1')
    expect(repo.queries).toHaveLength(0)
  })

  it('缓存形状非法时视为没有缓存（防御旧版本写入）', () => {
    const repo = createFakeRepository()
    const useCase = createUseCase(repo, createFakeCache({ [CACHE_KEY]: { items: 'not-an-array' } }))

    expect(useCase.hydrate().status).toBe('idle')
  })

  it('hydrate 幂等：第二次调用不会覆盖已有状态', () => {
    const useCase = createUseCase(createFakeRepository(), createFakeCache())
    expect(useCase.hydrate().status).toBe('idle')
    expect(useCase.hydrate().status).toBe('idle')
  })
})

describe('listGroupBuys · load（契约 §8 第 3 步）', () => {
  it('成功：ready + fromCache=false，并写回缓存', async () => {
    const repo = createFakeRepository([
      { ok: true, value: { items: [groupBuy('gb-1'), groupBuy('gb-2')], nextCursor: null, total: 2 } },
    ])
    const cache = createFakeCache()
    const useCase = createUseCase(repo, cache)

    const state = await useCase.load()

    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(false)
    expect(state.items).toHaveLength(2)
    expect(state.updatedAt).toBe(NOW.toISOString())
    expect(cache.dump()[CACHE_KEY]).toBeDefined()
  })

  it('结果为空：status = empty（而不是 ready + 空数组）', async () => {
    const repo = createFakeRepository([{ ok: true, value: { items: [], nextCursor: null, total: 0 } }])
    const useCase = createUseCase(repo, createFakeCache())

    expect((await useCase.load()).status).toBe('empty')
  })

  it('失败且无缓存：status = error 并暴露文案', async () => {
    const repo = createFakeRepository([
      { ok: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: '网络不可用' } },
    ])
    const useCase = createUseCase(repo, createFakeCache())

    const state = await useCase.load()

    expect(state.status).toBe('error')
    expect(state.error).toBe('网络不可用')
    expect(state.items).toEqual([])
  })

  it('失败但有缓存：静默降级，仍展示缓存数据（契约 §8）', async () => {
    const cached: CachedGroupBuyList = {
      items: [groupBuy('gb-cached')],
      nextCursor: null,
      updatedAt: '2026-10-16T11:00:00.000Z',
    }
    const repo = createFakeRepository([
      { ok: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: '网络不可用' } },
    ])
    const useCase = createUseCase(repo, createFakeCache({ [CACHE_KEY]: cached }))
    useCase.hydrate()

    const state = await useCase.load()

    expect(state.status).toBe('ready')
    expect(state.items).toHaveLength(1)
    expect(state.fromCache).toBe(true)
    expect(state.error).toBe('网络不可用')
  })

  it('把分类与关键词透传给仓储', async () => {
    const repo = createFakeRepository()
    const useCase = createUseCase(repo, createFakeCache())

    await useCase.load({ category: 'drink', keyword: '瑞幸' })

    expect(repo.queries[0]).toMatchObject({ category: 'drink', keyword: '瑞幸' })
  })
})

describe('listGroupBuys · loadMore（游标续页）', () => {
  it('用上一页的 nextCursor 请求下一页，并追加到列表尾部', async () => {
    const repo = createFakeRepository([
      { ok: true, value: { items: [groupBuy('gb-1')], nextCursor: 'gb-1', total: 2 } },
      { ok: true, value: { items: [groupBuy('gb-2')], nextCursor: null, total: 2 } },
    ])
    const useCase = createUseCase(repo, createFakeCache())

    await useCase.load()
    const state = await useCase.loadMore()

    expect(repo.queries[1]?.cursor).toBe('gb-1')
    expect(state.items.map((item) => item.id)).toEqual(['gb-1', 'gb-2'])
    expect(state.nextCursor).toBeNull()
    expect(state.loadingMore).toBe(false)
  })

  it('没有下一页时 loadMore 是空操作（不发请求）', async () => {
    const repo = createFakeRepository([
      { ok: true, value: { items: [groupBuy('gb-1')], nextCursor: null, total: 1 } },
    ])
    const useCase = createUseCase(repo, createFakeCache())

    await useCase.load()
    const state = await useCase.loadMore()

    expect(repo.queries).toHaveLength(1)
    expect(state.items).toHaveLength(1)
  })

  it('loadMore 失败时保留已加载数据，只挂错误文案', async () => {
    const repo = createFakeRepository([
      { ok: true, value: { items: [groupBuy('gb-1')], nextCursor: 'gb-1', total: 2 } },
      { ok: false, error: { code: 'TIMEOUT', message: '请求超时' } },
    ])
    const useCase = createUseCase(repo, createFakeCache())

    await useCase.load()
    const state = await useCase.loadMore()

    expect(state.items).toHaveLength(1)
    expect(state.error).toBe('请求超时')
    expect(state.loadingMore).toBe(false)
  })
})

describe('listGroupBuys · 订阅与快照稳定性', () => {
  it('未变更时 getSnapshot 返回同一引用（useSyncExternalStore 的硬要求）', () => {
    const useCase = createUseCase(createFakeRepository(), createFakeCache())
    expect(useCase.getSnapshot()).toBe(useCase.getSnapshot())
  })

  it('状态变更时通知订阅者，且取消订阅后不再通知', async () => {
    const repo = createFakeRepository([
      { ok: true, value: { items: [groupBuy('gb-1')], nextCursor: null, total: 1 } },
    ])
    const useCase = createUseCase(repo, createFakeCache())

    let notified = 0
    const unsubscribe = useCase.subscribe(() => {
      notified += 1
    })

    await useCase.load()
    expect(notified).toBeGreaterThan(0)

    const afterLoad = notified
    unsubscribe()
    await useCase.load()
    expect(notified).toBe(afterLoad)
  })

  it('变更后快照引用被替换', async () => {
    const repo = createFakeRepository([
      { ok: true, value: { items: [groupBuy('gb-1')], nextCursor: null, total: 1 } },
    ])
    const useCase = createUseCase(repo, createFakeCache())

    const before = useCase.getSnapshot()
    await useCase.load()
    expect(useCase.getSnapshot()).not.toBe(before)
  })
})
