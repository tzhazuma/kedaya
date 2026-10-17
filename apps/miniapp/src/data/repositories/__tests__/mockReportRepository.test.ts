import { describe, expect, it } from 'vitest'

import { createMockReportRepository } from '../mockReportRepository'

/**
 * mock 举报仓储的规格。
 *
 * 为什么 mock 也要有测试：演示模式（`TARO_APP_USE_MOCK=true`）是小程序
 * **唯一能离线走完的产品演示**。如果 mock 里举报静默吞掉，
 * 演示时就会得出\"举报没做\"的结论，而上线后才发现真实行为完全不同。
 * 所以这里要求 mock 与后端语义一致：去重、阈值升级、记录可查。
 */

const draft = { targetType: 'flea-item' as const, targetId: 'item-1', reason: 'fraud' as const }

describe('createMockReportRepository', () => {
  it('首次举报成功，并返回可读回执', async () => {
    const repo = createMockReportRepository()
    const result = await repo.submit(draft)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.targetType).toBe('flea-item')
      expect(result.value.targetId).toBe('item-1')
      expect(result.value.reason).toBe('fraud')
      expect(result.value.escalated).toBe(false)
    }
  })

  it('重复举报同一条 → CONFLICT（与后端的 409 一致，客户端才能走同一条分支）', async () => {
    const repo = createMockReportRepository()
    await repo.submit(draft)

    const again = await repo.submit(draft)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe('CONFLICT')
  })

  it('不同类型/不同 id 互不影响', async () => {
    const repo = createMockReportRepository()
    await repo.submit(draft)

    const other = await repo.submit({ ...draft, targetId: 'item-2' })
    expect(other.ok).toBe(true)
  })

  it('listMine 返回举报过的内容（最新在前）', async () => {
    const repo = createMockReportRepository()
    await repo.submit(draft)
    await repo.submit({ ...draft, targetId: 'item-2' })

    const mine = await repo.listMine()
    expect(mine.ok).toBe(true)
    if (mine.ok) {
      expect(mine.value).toHaveLength(2)
      expect(mine.value[0]?.targetId).toBe('item-2')
    }
  })

  it('阈值升级：已有 N 人举报时，本次举报立刻标记为已加急', async () => {
    const repo = createMockReportRepository({ escalationThreshold: 3 })
    repo.__seedReports('flea-item', 'item-1', 3)

    const result = await repo.submit(draft)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.escalated).toBe(true)
  })

  it('listMine 返回的是副本（页面上的排序/过滤不会污染仓储内部状态）', async () => {
    const repo = createMockReportRepository()
    await repo.submit(draft)

    const first = await repo.listMine()
    if (first.ok) first.value.length = 0

    const second = await repo.listMine()
    if (second.ok) expect(second.value).toHaveLength(1)
  })
})
