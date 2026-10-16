import { describe, expect, it } from 'vitest'

import { MOCK_GROUP_BUYS, MOCK_NOW_ISO } from '../../mock/fixtures'
import { createMockGroupBuyRepository } from '../mockGroupBuyRepository'

/**
 * Mock 仓储测试 —— 契约 §7 硬规则 4 的验收。
 *
 * 重点验证三件事：
 * 1. 游标分页语义与后端一致（cursor 是上一条 id，不是 offset）
 * 2. 写动作（参团）走的是 **domain 的 `canJoin`**，因此「已满 / 已截止 / 已取消 / 已参团」
 *    与真后端行为一致
 * 3. 演示控制面（failNextRequests / clearAll / reset）真的能驱动三态
 */

function createRepo() {
  return createMockGroupBuyRepository({
    latencyMs: 0,
    now: () => new Date(MOCK_NOW_ISO),
  })
}

describe('mock 仓储 · 列表与游标分页', () => {
  it('默认返回全部种子数据，按创建时间倒序', async () => {
    const repo = createRepo()
    const result = await repo.list()

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.total).toBe(MOCK_GROUP_BUYS.length)
    expect(result.value.items).toHaveLength(MOCK_GROUP_BUYS.length)
    const createdAt = result.value.items.map((item) => item.createdAt)
    expect([...createdAt].sort((a, b) => b.localeCompare(a))).toEqual(createdAt)
  })

  it('limit 分页 + cursor 续页，不重不漏', async () => {
    const repo = createRepo()

    const first = await repo.list({ limit: 2 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.items).toHaveLength(2)
    expect(first.value.nextCursor).toBe(first.value.items[1]?.id ?? null)

    const second = await repo.list({ limit: 2, cursor: first.value.nextCursor })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    const firstIds = first.value.items.map((item) => item.id)
    const secondIds = second.value.items.map((item) => item.id)
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false)
  })

  it('最后一页的 nextCursor 为 null', async () => {
    const repo = createRepo()
    const result = await repo.list({ limit: 100 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.nextCursor).toBeNull()
  })

  it('按分类过滤', async () => {
    const repo = createRepo()
    const result = await repo.list({ category: 'drink' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items.length).toBeGreaterThan(0)
    expect(result.value.items.every((item) => item.category === 'drink')).toBe(true)
  })

  it("category = 'all' 等价于不过滤", async () => {
    const repo = createRepo()
    const result = await repo.list({ category: 'all' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.total).toBe(MOCK_GROUP_BUYS.length)
  })

  it('按关键词过滤标题 / 描述 / 取货地点', async () => {
    const repo = createRepo()
    const result = await repo.list({ keyword: '瑞幸' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.items).toHaveLength(1)
    expect(result.value.items[0]?.id).toBe('gb-1002')
  })
})

describe('mock 仓储 · 详情', () => {
  it('存在的 id 返回详情', async () => {
    const repo = createRepo()
    const result = await repo.detail('gb-1001')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.title).toContain('小炒')
  })

  it('不存在的 id 返回 NOT_FOUND', async () => {
    const repo = createRepo()
    const result = await repo.detail('gb-nope')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })
})

describe('mock 仓储 · 参团（写动作）', () => {
  it('参团成功：参与人 +1、份数累加、updatedAt 前进', async () => {
    const repo = createRepo()
    const before = await repo.detail('gb-1002')
    expect(before.ok).toBe(true)
    if (!before.ok) return

    const result = await repo.join('gb-1002', { userId: 'u-me', displayName: '我', quantity: 1 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.participants).toHaveLength(before.value.participants.length + 1)
    expect(result.value.participants.some((p) => p.id === 'u-me')).toBe(true)
    expect(result.value.updatedAt).toBe(MOCK_NOW_ISO)
  })

  it('凑满目标份数后状态自动变为 full', async () => {
    const repo = createRepo()
    // gb-1002: targetCount = 4，已有 1 份
    const result = await repo.join('gb-1002', { userId: 'u-me', displayName: '我', quantity: 3 })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.status).toBe('full')
    }
  })

  it('已满的拼单拒绝参团（CONFLICT / full）', async () => {
    const repo = createRepo()
    // gb-1003: 6/6 已满
    const result = await repo.join('gb-1003', { userId: 'u-me', displayName: '我', quantity: 1 })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT')
      expect(result.error.details).toEqual({ reason: 'full' })
    }
  })

  it('已过截止时间的拼单拒绝参团（CONFLICT / expired）', async () => {
    const repo = createRepo()
    const result = await repo.join('gb-1004', { userId: 'u-me', displayName: '我', quantity: 1 })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.details).toEqual({ reason: 'expired' })
  })

  it('已取消的拼单拒绝参团（CONFLICT / not-open）', async () => {
    const repo = createRepo()
    const result = await repo.join('gb-1006', { userId: 'u-me', displayName: '我', quantity: 1 })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.details).toEqual({ reason: 'not-open' })
  })

  it('重复参团被拒绝（CONFLICT / already-joined）', async () => {
    const repo = createRepo()
    const result = await repo.join('gb-1001', { userId: 'u-0001', displayName: '张同学', quantity: 1 })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.details).toEqual({ reason: 'already-joined' })
  })

  it('参团不存在的拼单 → NOT_FOUND', async () => {
    const repo = createRepo()
    const result = await repo.join('gb-nope', { userId: 'u-me', displayName: '我', quantity: 1 })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('匿名参团不写入真实昵称', async () => {
    const repo = createRepo()
    const result = await repo.join('gb-1005', {
      userId: 'u-me',
      displayName: '真实姓名',
      quantity: 1,
      anonymous: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const mine = result.value.participants.find((p) => p.id === 'u-me')
    expect(mine?.displayName).toBe('匿名同学')
    expect(mine?.anonymous).toBe(true)
  })
})

describe('mock 仓储 · 演示控制面（三态驱动）', () => {
  it('failNextRequests(1) 只让下一次请求失败', async () => {
    const repo = createRepo()
    repo.failNextRequests(1)

    const failed = await repo.list()
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    const recovered = await repo.list()
    expect(recovered.ok).toBe(true)
  })

  it('clearAll 后列表为空（空态）', async () => {
    const repo = createRepo()
    repo.clearAll()

    const result = await repo.list()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.items).toHaveLength(0)
      expect(result.value.total).toBe(0)
      expect(result.value.nextCursor).toBeNull()
    }
  })

  it('reset 恢复种子数据，并清除待失败计数', async () => {
    const repo = createRepo()
    repo.clearAll()
    repo.failNextRequests(5)
    repo.reset()

    const result = await repo.list()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.total).toBe(MOCK_GROUP_BUYS.length)
  })

  it('返回的是深拷贝：外部修改不会污染数据库', async () => {
    const repo = createRepo()
    const first = await repo.list({ limit: 1 })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const target = first.value.items[0]
    if (target === undefined) return
    target.title = '被篡改'

    const again = await repo.detail(target.id)
    expect(again.ok).toBe(true)
    if (again.ok) expect(again.value.title).not.toBe('被篡改')
  })
})
