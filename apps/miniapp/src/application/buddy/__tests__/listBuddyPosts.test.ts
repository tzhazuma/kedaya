import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import { createListBuddyPostsUseCase, isCachedBuddyList } from '../listBuddyPosts'
import type { CachedBuddyList } from '../listBuddyPosts'
import type { BuddySection } from '../../../domain/models/buddy'
import {
  TEST_NOW_ISO,
  buddyPost,
  createFakeBuddyRepository,
  createFakeCache,
  fixedClock,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * 搭子列表用例测试 —— 契约 §8 启动时序的可执行规格。
 *
 * 除了三态与游标续页，这里额外覆盖一件**本模块特有**的事：
 * 缓存按**板块**分片。若不分片，切板块时 `hydrate()` 会把上一个板块的缓存
 * 当成当前板块的数据渲染出来 —— 用户会看到「运动」标签下全是自习搭子。
 */

function createUseCase(
  responses: Parameters<typeof createFakeBuddyRepository>[0] = {},
  cacheSeed?: Record<string, unknown>,
) {
  const repository = createFakeBuddyRepository(responses)
  const cache = createFakeCache(cacheSeed)
  const useCase = createListBuddyPostsUseCase({
    repository,
    cache,
    clock: fixedClock(TEST_NOW_ISO),
    cacheKeyFor: (section: BuddySection | 'all') => `buddy:list:${section}`,
  })
  return { repository, cache, useCase }
}

describe('listBuddyPosts · 契约 §8 启动时序', () => {
  it('hydrate 是**同步**的，且不触发任何网络请求', () => {
    const seed: CachedBuddyList = {
      items: [buddyPost('bp-1')],
      nextCursor: null,
      updatedAt: TEST_NOW_ISO,
    }
    const { repository, useCase } = createUseCase({}, { 'buddy:list:all': seed })

    const state = useCase.hydrate('all')

    expect(state.status).toBe('ready')
    expect(state.items).toHaveLength(1)
    expect(state.fromCache).toBe(true)
    expect(repository.listQueries).toHaveLength(0)
  })

  it('hydrate 幂等：第二次调用不会重置状态', () => {
    const seed: CachedBuddyList = {
      items: [buddyPost('bp-1')],
      nextCursor: null,
      updatedAt: TEST_NOW_ISO,
    }
    const { useCase } = createUseCase({}, { 'buddy:list:all': seed })
    useCase.hydrate('all')
    const second = useCase.hydrate('all')
    expect(second.items).toHaveLength(1)
  })

  it('缓存形状非法时被忽略（旧版本写入的缓存不能污染首屏）', () => {
    const { useCase } = createUseCase({}, { 'buddy:list:all': { items: 'not-an-array' } })
    expect(useCase.hydrate('all').status).toBe('idle')
    expect(isCachedBuddyList({ items: [], updatedAt: 'x' })).toBe(true)
    expect(isCachedBuddyList(null)).toBe(false)
  })

  it('load 成功 → ready + 写入缓存 + fromCache=false', async () => {
    const { cache, useCase } = createUseCase({
      items: [ok({ items: [buddyPost('bp-1'), buddyPost('bp-2')], nextCursor: null, total: 2 })],
    })

    const state = await useCase.load('sport')

    expect(state.status).toBe('ready')
    expect(state.items).toHaveLength(2)
    expect(state.fromCache).toBe(false)
    expect(cache.read('buddy:list:sport')).not.toBeNull()
  })

  it('load 返回空数组 → empty 态（三态齐全）', async () => {
    const { useCase } = createUseCase({
      items: [ok({ items: [], nextCursor: null, total: 0 })],
    })
    expect((await useCase.load('sport')).status).toBe('empty')
  })

  it('load 失败且无缓存 → error 态', async () => {
    const { useCase } = createUseCase({ items: [err(upstreamError('网络不可用'))] })
    const state = await useCase.load('sport')
    expect(state.status).toBe('error')
    expect(state.error).toBe('网络不可用')
  })

  it('load 失败但有缓存 → **静默降级**为 ready，只挂错误文案（契约 §8 第 3 步）', async () => {
    const seed: CachedBuddyList = {
      items: [buddyPost('bp-1')],
      nextCursor: null,
      updatedAt: TEST_NOW_ISO,
    }
    const { useCase } = createUseCase({ items: [err(upstreamError())] }, { 'buddy:list:sport': seed })

    useCase.hydrate('sport')
    const state = await useCase.load('sport')

    expect(state.status).toBe('ready')
    expect(state.items).toHaveLength(1)
    expect(state.fromCache).toBe(true)
    expect(state.error).toBe('网络不可用')
  })
})

describe('listBuddyPosts · 板块分片与游标续页', () => {
  it('缓存**按板块分片**：切板块不会把上一个板块的数据带过来', async () => {
    const sportSeed: CachedBuddyList = {
      items: [buddyPost('bp-sport')],
      nextCursor: null,
      updatedAt: TEST_NOW_ISO,
    }
    const { useCase } = createUseCase({}, { 'buddy:list:sport': sportSeed })

    useCase.hydrate('sport')
    expect(useCase.getSnapshot().section).toBe('sport')
    expect(useCase.getSnapshot().items[0]?.id).toBe('bp-sport')

    // 切到 academic：没有缓存 → 必须清空，而不是继续显示 sport 的条目
    const after = useCase.hydrate('academic')
    expect(after.section).toBe('academic')
    expect(after.items).toHaveLength(0)
    expect(after.status).toBe('idle')
  })

  it('load 切板块时先清空旧板块数据', async () => {
    const { useCase } = createUseCase({
      items: [
        ok({ items: [buddyPost('bp-sport')], nextCursor: null, total: 1 }),
        ok({ items: [buddyPost('bp-study')], nextCursor: null, total: 1 }),
      ],
    })

    await useCase.load('sport')
    expect(useCase.getSnapshot().items[0]?.id).toBe('bp-sport')

    const state = await useCase.load('academic')
    expect(state.section).toBe('academic')
    expect(state.items.map((item) => item.id)).toEqual(['bp-study'])
  })

  it('loadMore 用游标续页并**累积**结果', async () => {
    const { repository, useCase } = createUseCase({
      items: [
        ok({ items: [buddyPost('bp-1')], nextCursor: 'bp-1', total: 3 }),
        ok({ items: [buddyPost('bp-2')], nextCursor: 'bp-2', total: 3 }),
      ],
    })

    await useCase.load('sport')
    const state = await useCase.loadMore('sport')

    expect(state.items.map((item) => item.id)).toEqual(['bp-1', 'bp-2'])
    expect(state.nextCursor).toBe('bp-2')
    expect(repository.listQueries[1]?.cursor).toBe('bp-1')
    expect(repository.listQueries[1]?.section).toBe('sport')
  })

  it('nextCursor 为 null 时 loadMore 是空操作（不发请求）', async () => {
    const { repository, useCase } = createUseCase({
      items: [ok({ items: [buddyPost('bp-1')], nextCursor: null, total: 1 })],
    })
    await useCase.load('sport')
    const before = repository.listQueries.length
    await useCase.loadMore('sport')
    expect(repository.listQueries).toHaveLength(before)
  })

  it('loadMore 失败时保留已加载的条目，只挂错误', async () => {
    const { useCase } = createUseCase({
      items: [
        ok({ items: [buddyPost('bp-1')], nextCursor: 'bp-1', total: 2 }),
        err(upstreamError('续页失败')),
      ],
    })
    await useCase.load('sport')
    const state = await useCase.loadMore('sport')
    expect(state.items).toHaveLength(1)
    expect(state.loadingMore).toBe(false)
    expect(state.error).toBe('续页失败')
  })

  it('快照在无变更时保持同一引用（`useSyncExternalStore` 的前提）', async () => {
    const { useCase } = createUseCase({
      items: [ok({ items: [buddyPost('bp-1')], nextCursor: null, total: 1 })],
    })
    const before = useCase.getSnapshot()
    expect(useCase.getSnapshot()).toBe(before)
    await useCase.load('sport')
    expect(useCase.getSnapshot()).not.toBe(before)
    expect(useCase.getSnapshot()).toBe(useCase.getSnapshot())
  })

  it('订阅者在状态变更时被通知', async () => {
    const { useCase } = createUseCase({
      items: [ok({ items: [buddyPost('bp-1')], nextCursor: null, total: 1 })],
    })
    let notified = 0
    const unsubscribe = useCase.subscribe(() => {
      notified += 1
    })
    await useCase.load('sport')
    expect(notified).toBeGreaterThan(0)
    unsubscribe()
    const after = notified
    await useCase.load('sport')
    expect(notified).toBe(after)
  })

  it('摘要里的标签已翻成中文（页面不需要自己映射）', async () => {
    const { useCase } = createUseCase({
      items: [
        ok({
          items: [buddyPost('bp-1', { tags: ['badminton', 'gym'] })],
          nextCursor: null,
          total: 1,
        }),
      ],
    })
    const state = await useCase.load('sport')
    expect(state.items[0]?.tagLabels).toEqual(['羽毛球', '健身'])
    expect(state.items[0]?.sectionLabel).toBe('运动组队')
  })
})
