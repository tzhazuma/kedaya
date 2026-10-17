import { describe, expect, it } from 'vitest'

import { createMockFleaMarketRepository } from '../mockFleaMarketRepository'
import { createMemoryStorage } from '../../storage/memoryStorage'
import {
  availableActions,
  canReserve,
  categoryLabel,
  conditionLabel,
  isFleaCategory,
  isFleaStatus,
  statusLabel,
  summarize,
} from '../../../domain/models/fleaMarket'
import type { FleaItem } from '../../../domain/models/fleaMarket'

/**
 * 跳蚤市场「领域规则 + Mock 仓储」的可执行规格。
 *
 * 为什么这两部分放一起测：Mock 仓储的价值在于**规则一致**——
 * 归属校验、状态机、筛选排序都要和后端一样。所以这里既测纯函数，
 * 也测 mock 真的执行了同样的规则（而不是"看起来像"）。
 */

const NOW = new Date('2026-05-01T12:00:00.000Z')

const SELLER = 'user-seller'
const BUYER = 'user-buyer'

function item(overrides: Partial<FleaItem> = {}): FleaItem {
  return {
    id: 'i1',
    sellerId: SELLER,
    title: '机械键盘',
    description: '用了半年',
    priceFen: 12_800,
    category: 'electronics',
    condition: 'like-new',
    campusSpot: '二号宿舍楼下',
    imageUrls: [],
    status: 'on-sale',
    reservedById: null,
    soldAt: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  }
}

function repo(viewer: string | null, seed: FleaItem[] = [item()]) {
  return createMockFleaMarketRepository({
    cache: createMemoryStorage(),
    viewerId: () => viewer,
    latencyMs: 0,
    now: () => NOW,
    seed,
  })
}

describe('标签与派生视图', () => {
  it('未知分类/成色/状态降级为可读文案，而不是抛错', () => {
    expect(isFleaCategory('nope')).toBe(false)
    expect(categoryLabel('nope')).toBe('其它')
    expect(conditionLabel('nope')).toBe('成色未知')
    expect(isFleaStatus('nope')).toBe(false)
    expect(statusLabel('nope')).toBe('未知状态')
  })

  it('金额转成两位小数的元（整数分 → 展示字符串）', () => {
    const summary = summarize(item({ priceFen: 1_500 }), null, NOW)
    expect(summary.priceLabel).toBe('15.00')
  })

  it('「我的」与「我预定的」标记依赖当前用户', () => {
    const sold = item({ status: 'reserved', reservedById: BUYER })
    expect(summarize(sold, SELLER, NOW).mine).toBe(true)
    expect(summarize(sold, BUYER, NOW).reservedByMe).toBe(true)
    expect(summarize(sold, null, NOW).mine).toBe(false)
  })
})

describe('动作权限（服务端仍是最终裁决，这里只是提前藏按钮）', () => {
  it('未登录时没有任何动作', () => {
    expect(availableActions(item(), null)).toEqual([])
  })

  it('卖家可标记售出 / 删除；已售出时只剩删除', () => {
    expect(availableActions(item(), SELLER)).toEqual(['sold', 'edit', 'delete'])
    expect(availableActions(item({ status: 'sold' }), SELLER)).toEqual(['delete'])
    expect(availableActions(item({ status: 'reserved' }), SELLER)).toEqual([
      'sold',
      'release',
      'edit',
      'delete',
    ])
  })

  it('买家只有在售时才能预定', () => {
    expect(availableActions(item(), BUYER)).toEqual(['reserve'])
    expect(availableActions(item({ status: 'reserved', reservedById: 'other' }), BUYER)).toEqual([])
    expect(availableActions(item({ status: 'reserved', reservedById: BUYER }), BUYER)).toEqual([])
    expect(availableActions(item({ status: 'sold' }), BUYER)).toEqual([])
  })

  it('canReserve 给出可读的拒绝原因', () => {
    expect(canReserve(item(), null).allowed).toBe(false)
    expect(canReserve(item(), null).message).toContain('登录')
    expect(canReserve(item(), SELLER).message).toContain('自己')
    expect(canReserve(item({ status: 'reserved' }), BUYER).message).toContain('已被预定')
    expect(canReserve(item({ status: 'sold' }), BUYER).message).toContain('已售出')
    expect(canReserve(item(), BUYER).allowed).toBe(true)
  })
})

describe('Mock 仓储：筛选与排序', () => {
  const seed: FleaItem[] = [
    item({ id: 'a', title: '苹果耳机', category: 'electronics', priceFen: 30_000 }),
    item({ id: 'b', title: '二手自行车', category: 'sports', priceFen: 18_000 }),
    item({ id: 'c', title: '教材', category: 'books', priceFen: 2_000, status: 'sold' }),
  ]

  it('关键词同时匹配标题与描述', async () => {
    const r = repo(BUYER, seed)
    const result = await r.list({ cursor: null, filters: { keyword: '自行车' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items.map((i) => i.id)).toEqual(['b'])
  })

  it('分类 + 状态筛选可以叠加', async () => {
    const r = repo(BUYER, seed)
    const result = await r.list({ cursor: null, filters: { category: 'books', status: 'sold' } })
    if (result.ok) expect(result.value.items.map((i) => i.id)).toEqual(['c'])
  })

  it('按价格升序 / 降序排序', async () => {
    const r = repo(BUYER, seed)
    const asc = await r.list({ cursor: null, filters: { sort: 'price-asc' } })
    if (asc.ok) expect(asc.value.items.map((i) => i.id)).toEqual(['c', 'b', 'a'])
    const desc = await r.list({ cursor: null, filters: { sort: 'price-desc' } })
    if (desc.ok) expect(desc.value.items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('游标分页只返回下一页，并给出正确的 nextCursor', async () => {
    const r = repo(BUYER, seed)
    const first = await r.list({ cursor: null, limit: 2, filters: { sort: 'price-asc' } })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.items.map((i) => i.id)).toEqual(['c', 'b'])
    expect(first.value.nextCursor).toBe('b')

    const second = await r.list({ cursor: 'b', limit: 2, filters: { sort: 'price-asc' } })
    if (second.ok) {
      expect(second.value.items.map((i) => i.id)).toEqual(['a'])
      expect(second.value.nextCursor).toBeNull()
    }
  })

  it('mine 只看自己发布的（用当前登录主体判定）', async () => {
    const r = repo(SELLER, seed)
    const result = await r.list({ cursor: null, filters: { mine: true } })
    if (result.ok) expect(result.value.items).toHaveLength(3)

    const other = repo(BUYER, seed)
    const otherResult = await other.list({ cursor: null, filters: { mine: true } })
    if (otherResult.ok) expect(otherResult.value.items).toHaveLength(0)
  })
})

describe('Mock 仓储：归属与状态机', () => {
  it('未登录不能发布', async () => {
    const r = repo(null, [])
    const result = await r.create({ title: 'x', priceFen: 100, category: 'other' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
  })

  it('发布者永远是当前登录用户，且新商品立刻可被列出（数据落了缓存）', async () => {
    const r = repo(SELLER, [])
    const created = await r.create({ title: '台灯', priceFen: 3_000, category: 'daily' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.sellerId).toBe(SELLER)

    const listed = await r.list({ cursor: null, filters: {} })
    if (listed.ok) expect(listed.value.items.map((i) => i.id)).toEqual([created.value.id])
  })

  it('非发布者不能修改 / 删除 / 标记售出（FORBIDDEN）', async () => {
    const r = repo(BUYER, [item()])
    for (const result of [await r.update('i1', { title: 'x' }), await r.remove('i1'), await r.markSold('i1')]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
    }
  })

  it('预定：不能预定自己的商品；重复预定冲突；预定后被标记 reserved', async () => {
    const self = repo(SELLER, [item()])
    const selfReserve = await self.reserve('i1')
    expect(selfReserve.ok).toBe(false)
    if (!selfReserve.ok) expect(selfReserve.error.code).toBe('VALIDATION_FAILED')

    const buyer = repo(BUYER, [item()])
    const reserved = await buyer.reserve('i1')
    expect(reserved.ok).toBe(true)
    if (reserved.ok) {
      expect(reserved.value.status).toBe('reserved')
      expect(reserved.value.reservedById).toBe(BUYER)
    }

    const again = await buyer.reserve('i1')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe('CONFLICT')
  })

  it('解除预定只允许卖家，且只对「已预定」有效', async () => {
    const buyer = repo(BUYER, [item({ status: 'reserved', reservedById: BUYER })])
    const byBuyer = await buyer.release('i1')
    expect(byBuyer.ok).toBe(false)
    if (!byBuyer.ok) expect(byBuyer.error.code).toBe('FORBIDDEN')

    const seller = repo(SELLER, [item({ status: 'reserved', reservedById: BUYER })])
    const released = await seller.release('i1')
    if (released.ok) {
      expect(released.value.status).toBe('on-sale')
      expect(released.value.reservedById).toBeNull()
    }

    const idle = repo(SELLER, [item()])
    const notReserved = await idle.release('i1')
    expect(notReserved.ok).toBe(false)
    if (!notReserved.ok) expect(notReserved.error.code).toBe('CONFLICT')
  })

  it('标记售出会写入 soldAt，且已售出后不能再改 / 再卖', async () => {
    const r = repo(SELLER, [item()])
    const sold = await r.markSold('i1')
    expect(sold.ok).toBe(true)
    if (sold.ok) {
      expect(sold.value.status).toBe('sold')
      expect(sold.value.soldAt).toBe(NOW.toISOString())
    }

    const again = await r.markSold('i1')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe('CONFLICT')

    const edit = await r.update('i1', { title: '改个名' })
    expect(edit.ok).toBe(false)
    if (!edit.ok) expect(edit.error.code).toBe('CONFLICT')
  })

  it('不存在的商品统一返回 NOT_FOUND', async () => {
    const r = repo(BUYER, [])
    for (const result of [await r.detail('ghost'), await r.reserve('ghost'), await r.remove('ghost')]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
    }
  })

  it('演示开关：failNextRequests 只影响接下来 N 次请求', async () => {
    const r = repo(SELLER, [item()])
    r.failNextRequests(1)
    const failed = await r.list({ cursor: null, filters: {} })
    expect(failed.ok).toBe(false)
    const ok2 = await r.list({ cursor: null, filters: {} })
    expect(ok2.ok).toBe(true)
  })

  it('演示开关：clearAll 之后是真的空列表（不会把种子数据又塞回来）', async () => {
    const r = repo(SELLER, [item()])
    r.clearAll()
    const result = await r.list({ cursor: null, filters: {} })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items).toHaveLength(0)
  })
})
