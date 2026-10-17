import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import { createListBindingsUseCase, isCachedBindings } from '../listBindings'
import {
  TEST_NOW_ISO,
  campusBinding,
  createFakeCache,
  createFakeTechpieRepository,
  fixedClock,
} from '../../__tests__/testDoubles'

/**
 * 绑定列表用例 —— 契约 §8 启动时序 + 缓存安全。
 */

const CACHE_KEY = 'test:techpie:links'

function setup(options: Parameters<typeof createFakeTechpieRepository>[0] = {}) {
  const repository = createFakeTechpieRepository(options)
  const cache = createFakeCache()
  const useCase = createListBindingsUseCase({
    repository,
    cache,
    clock: fixedClock(TEST_NOW_ISO),
    cacheKey: CACHE_KEY,
  })
  return { repository, cache, useCase }
}

describe('application · techpie · listBindings（契约 §8 启动时序）', () => {
  it('无缓存时 hydrate 不改状态（首屏不会假装有数据）', () => {
    const { useCase } = setup()
    expect(useCase.hydrate().status).toBe('idle')
    expect(useCase.getSnapshot().items).toEqual([])
  })

  it('hydrate 是幂等的（页面重复调用不会重复读盘）', () => {
    const { cache, useCase } = setup()
    cache.write(CACHE_KEY, {
      items: [campusBinding('tpl-1')],
      nextCursor: null,
      updatedAt: TEST_NOW_ISO,
    })
    const first = useCase.hydrate()
    const second = useCase.hydrate()
    expect(first).toBe(second)
    expect(first.fromCache).toBe(true)
  })

  it('load 成功 → ready，并写入缓存', async () => {
    const { cache, useCase } = setup({
      bindings: [ok({ items: [campusBinding('tpl-1')], nextCursor: null, total: 1 })],
    })
    const state = await useCase.load()
    expect(state.status).toBe('ready')
    expect(state.items).toHaveLength(1)
    expect(state.fromCache).toBe(false)
    expect(cache.read(CACHE_KEY)).not.toBeNull()
  })

  it('load 返回空数组 → empty（**不是** error：未绑定是合法状态）', async () => {
    const { useCase } = setup({
      bindings: [ok({ items: [], nextCursor: null, total: 0 })],
    })
    const state = await useCase.load()
    expect(state.status).toBe('empty')
    expect(state.error).toBeNull()
  })

  it('load 失败且无缓存 → error', async () => {
    const { useCase } = setup({
      bindings: [err({ code: 'UPSTREAM_UNAVAILABLE', message: '网络不可用' })],
    })
    const state = await useCase.load()
    expect(state.status).toBe('error')
    expect(state.error).toBe('网络不可用')
  })

  it('⚠️ load 失败但有缓存 → 继续 ready + fromCache（契约 §8 静默降级）', async () => {
    const { cache, useCase } = setup({
      bindings: [err({ code: 'UPSTREAM_UNAVAILABLE', message: '网络不可用' })],
    })
    cache.write(CACHE_KEY, {
      items: [campusBinding('tpl-cached')],
      nextCursor: null,
      updatedAt: TEST_NOW_ISO,
    })
    useCase.hydrate()
    const state = await useCase.load()
    expect(state.status).toBe('ready')
    expect(state.items[0]?.id).toBe('tpl-cached')
    expect(state.fromCache).toBe(true)
    expect(state.error).toBe('网络不可用')
  })

  it('loadMore 追加而不是替换，并把累积结果写回缓存', async () => {
    const { cache, useCase } = setup({
      bindings: [
        ok({ items: [campusBinding('tpl-1')], nextCursor: 'c1', total: 2 }),
        ok({ items: [campusBinding('tpl-2')], nextCursor: null, total: 2 }),
      ],
    })
    await useCase.load()
    const state = await useCase.loadMore()
    expect(state.items.map((item) => item.id)).toEqual(['tpl-1', 'tpl-2'])
    expect(state.nextCursor).toBeNull()
    expect((cache.read<{ items: unknown[] }>(CACHE_KEY)?.items ?? []).length).toBe(2)
  })

  it('usableBindings 只返回**可用**的绑定（供能力页构造 viewer）', async () => {
    const { useCase } = setup({
      bindings: [
        ok({
          items: [
            campusBinding('tpl-1', { provider: 'ecard', status: 'ACTIVE' }),
            campusBinding('tpl-2', { provider: 'egate', status: 'EXPIRED' }),
          ],
          nextCursor: null,
        }),
      ],
    })
    await useCase.load()
    expect(useCase.usableBindings().map((item) => item.provider)).toEqual(['ecard'])
  })
})

describe('application · techpie · listBindings（缓存里的凭证边界）', () => {
  it('⚠️ 缓存含凭证键时 hydrate **拒绝使用**它', () => {
    const { cache, useCase } = setup()
    cache.write(CACHE_KEY, {
      items: [{ id: 'tpl-1', provider: 'ecard', status: 'ACTIVE', castgc: 'TGT-OLD' }],
      nextCursor: null,
      updatedAt: TEST_NOW_ISO,
    })
    expect(useCase.hydrate().status).toBe('idle')
    expect(useCase.getSnapshot().items).toEqual([])
  })

  it('isCachedBindings 对形状与凭证键都做校验', () => {
    expect(isCachedBindings(null)).toBe(false)
    expect(isCachedBindings({ items: [], updatedAt: 'x' })).toBe(true)
    expect(isCachedBindings({ items: [], updatedAt: 'x', sessionToken: 't' })).toBe(false)
    expect(isCachedBindings({ items: 'nope', updatedAt: 'x' })).toBe(false)
  })

  it('⚠️ 上游返回的条目带凭证键时**不写缓存**（宁可没缓存也不落盘）', async () => {
    const { cache, useCase } = setup({
      bindings: [
        ok({
          // 绕过类型：模拟"后端夹带了凭证"
          items: [{ id: 'tpl-1', provider: 'ecard', status: 'ACTIVE', castgc: 'TGT' } as never],
          nextCursor: null,
        }),
      ],
    })
    await useCase.load()
    expect(cache.read(CACHE_KEY)).toBeNull()
  })

  it('reset 后可以重新 hydrate', async () => {
    const { cache, useCase } = setup()
    cache.write(CACHE_KEY, { items: [campusBinding('tpl-1')], nextCursor: null, updatedAt: TEST_NOW_ISO })
    expect(useCase.hydrate().fromCache).toBe(true)
    useCase.reset()
    expect(useCase.getSnapshot().status).toBe('idle')
    expect(useCase.hydrate().fromCache).toBe(true)
  })
})
