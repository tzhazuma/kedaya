import { describe, expect, it } from 'vitest'
import { err, ok, type Result } from '@kedaya/shared'

import { createCachedPageGuard, createListUseCase } from '../listUseCase'
import type { CachedListPage, ListPage } from '../listUseCase'
import type { CachePort } from '../../../domain/ports/cachePort'
import type { ClockPort } from '../../../domain/ports/clockPort'
import type { RepositoryError } from '../../../domain/ports/errors'

/**
 * 通用列表用例的规格 —— 这是**六个模块共用**的基础设施，所以必须比业务代码更严。
 *
 * 重点覆盖契约 §8 的三条硬要求：
 *   · hydrate 同步、不碰网络；
 *   · load 失败**静默降级**到缓存（有缓存就不许把首屏打回错误页）；
 *   · loadMore 用游标，且把**累积**结果写回缓存（而不是只写最后一页）。
 */

interface Item {
  id: string
  title: string
}

interface Query extends Record<string, unknown> {
  keyword?: string
}

interface View {
  id: string
  label: string
}

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

const NOW = new Date('2026-04-01T09:00:00.000Z')
const clock: ClockPort = { now: () => NOW }

const isItem = (value: unknown): value is Item =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Item).id === 'string' &&
  typeof (value as Item).title === 'string'

function setup(options: {
  pages?: Array<Result<ListPage<Item>, RepositoryError>>
  cache?: CachePort
  seed?: Record<string, unknown>
} = {}) {
  const cache = (options.cache ?? createFakeCache(options.seed)) as ReturnType<typeof createFakeCache>
  const queued = [...(options.pages ?? [])]
  const calls: Array<{ query: Query; cursor: string | null }> = []

  const useCase = createListUseCase<Query, Item, View>({
    cache,
    clock,
    cacheKey: 'test:list',
    defaultQuery: {},
    isCachedPage: createCachedPageGuard<Item>(isItem) as (
      value: unknown,
    ) => value is CachedListPage<Item>,
    async fetchPage(query, cursor) {
      calls.push({ query: { ...query }, cursor })
      const next = queued.shift()
      if (next === undefined) throw new Error('没有排队的响应了')
      return next
    },
    mapItem: (item) => ({ id: item.id, label: item.title.toUpperCase() }),
  })

  return { useCase, cache, calls }
}

const page = (items: Item[], nextCursor: string | null = null): Result<ListPage<Item>, RepositoryError> =>
  ok({ items, nextCursor })

const failure: Result<ListPage<Item>, RepositoryError> = err({
  code: 'UPSTREAM_UNAVAILABLE',
  message: '服务暂时不可用',
})

describe('hydrate（契约 §8 第 1 步：同步、不碰网络）', () => {
  it('没有缓存时保持 idle，不发任何请求', () => {
    const { useCase, calls } = setup()

    const state = useCase.hydrate()

    expect(state.status).toBe('idle')
    expect(state.items).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('有合法缓存时立刻变成 ready 并标记 fromCache', () => {
    const { useCase } = setup({
      seed: {
        'test:list': {
          items: [{ id: 'a', title: '二手自行车' }],
          nextCursor: 'cursor-1',
          total: 12,
          updatedAt: '2026-03-31T00:00:00.000Z',
        },
      },
    })

    const state = useCase.hydrate()

    expect(state.status).toBe('ready')
    expect(state.items).toEqual([{ id: 'a', label: '二手自行车' }])
    expect(state.nextCursor).toBe('cursor-1')
    expect(state.total).toBe(12)
    expect(state.fromCache).toBe(true)
    expect(state.updatedAt).toBe('2026-03-31T00:00:00.000Z')
  })

  it('缓存形状非法（旧版本写入）时忽略它，绝不把脏数据喂给 UI', () => {
    const { useCase } = setup({
      seed: { 'test:list': { items: [{ id: 1, title: null }], updatedAt: 42 } },
    })

    const state = useCase.hydrate()

    expect(state.status).toBe('idle')
    expect(state.items).toEqual([])
  })

  it('重复调用 hydrate 不会覆盖已经加载好的数据', async () => {
    const { useCase } = setup({ pages: [page([{ id: 'a', title: 'x' }])] })

    useCase.hydrate()
    await useCase.load()
    const again = useCase.hydrate()

    expect(again.items).toHaveLength(1)
    expect(again.fromCache).toBe(false)
  })
})

describe('load（契约 §8 第 3 步：后台刷新）', () => {
  it('成功：替换数据、写缓存、清掉 fromCache', async () => {
    const { useCase, cache } = setup({ pages: [page([{ id: 'a', title: 'duck' }], 'c1')] })

    const state = await useCase.load()

    expect(state.status).toBe('ready')
    expect(state.items).toEqual([{ id: 'a', label: 'DUCK' }])
    expect(state.nextCursor).toBe('c1')
    expect(state.fromCache).toBe(false)
    expect(cache.dump()['test:list']).toMatchObject({
      items: [{ id: 'a', title: 'duck' }],
      nextCursor: 'c1',
      updatedAt: NOW.toISOString(),
    })
  })

  it('空结果 → empty（而不是 ready 空列表，页面才能显示空态文案）', async () => {
    const { useCase } = setup({ pages: [page([])] })

    const state = await useCase.load()

    expect(state.status).toBe('empty')
  })

  it('失败且**无**缓存 → error', async () => {
    const { useCase } = setup({ pages: [failure] })

    const state = await useCase.load()

    expect(state.status).toBe('error')
    expect(state.error).toContain('服务暂时不可用')
  })

  it('失败且**有**缓存 → 静默降级：保持 ready、保留旧数据、只挂错误文案', async () => {
    const { useCase } = setup({
      seed: {
        'test:list': {
          items: [{ id: 'cached', title: '缓存里的' }],
          nextCursor: null,
          updatedAt: '2026-03-31T00:00:00.000Z',
        },
      },
      pages: [failure],
    })
    useCase.hydrate()

    const state = await useCase.load()

    expect(state.status).toBe('ready')
    expect(state.items.map((item) => item.id)).toEqual(['cached'])
    expect(state.error).toContain('服务暂时不可用')
    expect(state.fromCache).toBe(true)
  })

  it('筛选条件会传给仓储，并原样记录在 state.query 供页面回显', async () => {
    const { useCase, calls } = setup({ pages: [page([])] })

    await useCase.load({ keyword: '自行车' })

    expect(calls[0]?.query).toEqual({ keyword: '自行车' })
    expect(useCase.getSnapshot().query).toEqual({ keyword: '自行车' })
  })

  it('setQuery 只改条件，不发请求（由页面决定何时刷新）', () => {
    const { useCase, calls } = setup()

    useCase.setQuery({ keyword: '吉他' })

    expect(useCase.getSnapshot().query).toEqual({ keyword: '吉他' })
    expect(calls).toHaveLength(0)
  })
})

describe('loadMore（游标续页）', () => {
  it('用游标取下一页并**追加**到现有列表', async () => {
    const { useCase, calls } = setup({
      pages: [
        page([{ id: 'a', title: 'a' }], 'cursor-1'),
        page([{ id: 'b', title: 'b' }], null),
      ],
    })
    await useCase.load()

    const state = await useCase.loadMore()

    expect(calls[1]?.cursor).toBe('cursor-1')
    expect(state.items.map((item) => item.id)).toEqual(['a', 'b'])
    expect(state.nextCursor).toBeNull()
  })

  it('把**累积**结果写回缓存（不是只写最后一页）', async () => {
    const { useCase, cache } = setup({
      pages: [
        page([{ id: 'a', title: 'a' }], 'cursor-1'),
        page([{ id: 'b', title: 'b' }], null),
      ],
    })
    await useCase.load()
    await useCase.loadMore()

    expect((cache.dump()['test:list'] as { items: Item[] }).items.map((item) => item.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('没有下一页时是空操作（不发请求、不改状态）', async () => {
    const { useCase, calls } = setup({ pages: [page([{ id: 'a', title: 'a' }], null)] })
    await useCase.load()

    const state = await useCase.loadMore()

    expect(calls).toHaveLength(1)
    expect(state.items).toHaveLength(1)
  })

  it('续页失败时保留已有条目，只挂错误（不清空列表）', async () => {
    const { useCase } = setup({
      pages: [page([{ id: 'a', title: 'a' }], 'cursor-1'), failure],
    })
    await useCase.load()

    const state = await useCase.loadMore()

    expect(state.items).toHaveLength(1)
    expect(state.loadingMore).toBe(false)
    expect(state.error).toContain('服务暂时不可用')
  })
})
