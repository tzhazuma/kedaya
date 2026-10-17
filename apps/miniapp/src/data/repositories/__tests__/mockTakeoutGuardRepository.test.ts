import { describe, expect, it } from 'vitest'

import { createMockTakeoutGuardRepository } from '../mockTakeoutGuardRepository'
import { validateDraft } from '../../../application/takeoutGuard/takeoutGuardUseCases'
import {
  TAKEOUT_GUARD_STATUS,
  escalateEligibility,
  formatHappenedAtInput,
  happenedAtProblem,
  orderNoTail,
  parseHappenedAtInput,
  resolveEligibility,
  statusLabel,
  statusTimeline,
  summarize,
} from '../../../domain/models/takeoutGuard'
import type { TakeoutGuardReport } from '../../../domain/models/takeoutGuard'

/**
 * 偷外卖「领域规则 + Mock 仓储」的可执行规格。
 *
 * Mock 仓储的价值不在"有数据"，而在**规则一致**：归属只认登录主体、
 * 别人的记录连存在都看不到、状态机 pending → escalated → resolved 不能乱跳。
 * 所以这里既测纯函数，也测 mock 真的执行了同样的规则（而不是"看起来像"）。
 */

const NOW = new Date('2026-05-01T12:00:00.000Z')
const VIEWER = 'user-viewer'
const OTHER = 'user-other'

function report(overrides: Partial<TakeoutGuardReport> = {}): TakeoutGuardReport {
  return {
    id: 'tg-1',
    reporterId: VIEWER,
    orderNo: 'KD2026101501',
    place: '生活区 5 号楼一层外卖架',
    happenedAt: '2026-05-01T10:00:00.000Z',
    detail: '取餐时发现袋子被拆开，主食不见了。',
    evidenceUrl: null,
    status: TAKEOUT_GUARD_STATUS.pending,
    createdAt: '2026-05-01T10:10:00.000Z',
    updatedAt: '2026-05-01T10:10:00.000Z',
    ...overrides,
  }
}

function repo(viewer: string | null, seed?: TakeoutGuardReport[]) {
  return createMockTakeoutGuardRepository({
    viewerId: () => viewer,
    ...(seed === undefined ? {} : { seed }),
    latencyMs: 0,
    now: () => NOW,
  })
}

describe('标签、订单号后四位与派生视图', () => {
  it('未知状态降级为可读文案，而不是抛错', () => {
    expect(statusLabel('nope')).toBe('未知状态')
    expect(statusLabel('pending')).toBe('待处理')
    expect(statusLabel('escalated')).toBe('已升级')
    expect(statusLabel('resolved')).toBe('已解决')
  })

  it('列表只给订单号后四位（完整订单号留在详情页）', () => {
    expect(orderNoTail('KD2026101501')).toBe('1501')
    // 短订单号没有"后四位"可言，原样展示
    expect(orderNoTail('12')).toBe('12')
    // 分隔符先清掉再取尾部
    expect(orderNoTail('KD-2026-1015')).toBe('1015')
    expect(orderNoTail('   ')).toBe('—')
  })

  it('时间文本与 Date 可以互相还原（按本地时间）', () => {
    const original = new Date(2026, 4, 1, 8, 30)
    expect(formatHappenedAtInput(original)).toBe('2026-05-01 08:30')
    expect(parseHappenedAtInput(formatHappenedAtInput(original))?.getTime()).toBe(original.getTime())
  })

  it('时间文本接受明确格式，拒绝模糊输入和进位日期', () => {
    expect(parseHappenedAtInput('2026/05/01 08:30')?.getTime()).toBe(
      new Date(2026, 4, 1, 8, 30).getTime(),
    )
    expect(parseHappenedAtInput('2026-05-01')?.getTime()).toBe(new Date(2026, 4, 1).getTime())
    expect(parseHappenedAtInput('刚才')).toBeNull()
    expect(parseHappenedAtInput('')).toBeNull()
    // `new Date(2026, 1, 30)` 会静默进位到 3 月，必须被识别为非法
    expect(parseHappenedAtInput('2026-02-30 10:00')).toBeNull()
    expect(parseHappenedAtInput('2026-05-01 25:00')).toBeNull()
  })

  it('发生时间允许 5 分钟时钟偏差，超出即拒绝', () => {
    expect(happenedAtProblem(NOW, NOW)).toBeNull()
    expect(happenedAtProblem(new Date(NOW.getTime() + 4 * 60_000), NOW)).toBeNull()
    expect(happenedAtProblem(new Date(NOW.getTime() + 6 * 60_000), NOW)).toBe(
      '发生时间不能晚于当前时间',
    )
    expect(happenedAtProblem(new Date('nope'), NOW)).toBe('发生时间格式不正确')
  })

  it('summarize 给出卡片直接可用的字段', () => {
    const summary = summarize(report(), NOW)
    expect(summary.orderNoTail).toBe('1501')
    expect(summary.statusLabel).toBe('待处理')
    expect(summary.happenedLabel).toBe('2 小时前')
    expect(summary.hasEvidence).toBe(false)
    expect(summary.escalated).toBe(false)
    expect(summary.resolved).toBe(false)

    const withEvidence = summarize(
      report({ status: 'resolved', evidenceUrl: '/api/v1/media/files/x.jpg' }),
      NOW,
    )
    expect(withEvidence.hasEvidence).toBe(true)
    expect(withEvidence.resolved).toBe(true)
    expect(summarize(report({ detail: null }), NOW).detailPreview).toBe('')
  })

  it('statusTimeline 把状态翻译成"已完成 / 当前 / 未开始"', () => {
    expect(statusTimeline('pending').map((step) => step.state)).toEqual([
      'current',
      'todo',
      'todo',
    ])
    expect(statusTimeline('escalated').map((step) => step.state)).toEqual([
      'done',
      'current',
      'todo',
    ])
    expect(statusTimeline('resolved').map((step) => step.state)).toEqual([
      'done',
      'done',
      'current',
    ])
    expect(statusTimeline('nope').map((step) => step.state)).toEqual(['current', 'todo', 'todo'])
  })
})

describe('动作闸门（服务端仍是最终裁决，这里只是提前藏按钮）', () => {
  it('未登录 / 非本人：升级与解决问题说得清楚', () => {
    expect(escalateEligibility(report(), null).message).toContain('登录')
    expect(resolveEligibility(report(), null).message).toContain('登录')
    expect(escalateEligibility(report(), OTHER).message).toContain('只能处理自己')
    expect(resolveEligibility(report(), OTHER).message).toContain('只能处理自己')
  })

  it('已升级不能重复升级、已解决不能再升级', () => {
    expect(escalateEligibility(report({ status: 'escalated' }), VIEWER).message).toContain(
      '已经升级处理',
    )
    expect(escalateEligibility(report({ status: 'resolved' }), VIEWER).message).toContain(
      '已解决',
    )
    expect(escalateEligibility(report(), VIEWER).allowed).toBe(true)
  })

  it('已解决不能重复标记', () => {
    expect(resolveEligibility(report({ status: 'resolved' }), VIEWER).message).toContain(
      '已经标记为已解决',
    )
    expect(resolveEligibility(report({ status: 'escalated' }), VIEWER).allowed).toBe(true)
  })
})

describe('Mock 仓储 · 登录与归属', () => {
  it('未登录：列表 / 详情 / 创建 / 升级 / 解决全部 UNAUTHENTICATED', async () => {
    const r = repo(null, [report({ reporterId: 'mock-self' })])
    const results = await Promise.all([
      r.list({ cursor: null, filters: {} }),
      r.detail('tg-1'),
      r.create({ orderNo: 'x', place: 'y', happenedAt: NOW.toISOString(), detail: 'z' }),
      r.escalate('tg-1'),
      r.resolve('tg-1'),
    ])
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    }
  })

  it('创建：归属是当前登录主体，状态恒为 pending，文本被 trim', async () => {
    const r = repo(VIEWER, [])
    const created = await r.create({
      orderNo: '  KD2026101501  ',
      place: '  二食堂一层外卖柜  ',
      happenedAt: NOW.toISOString(),
      detail: '  取餐码还没用，柜门里是空的。  ',
      evidenceUrl: '   ',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(created.value.reporterId).toBe(VIEWER)
    expect(created.value.orderNo).toBe('KD2026101501')
    expect(created.value.place).toBe('二食堂一层外卖柜')
    expect(created.value.detail).toBe('取餐码还没用，柜门里是空的。')
    // 空串等于"没填"，归一成 null（与后端 normalizeText 一致）
    expect(created.value.evidenceUrl).toBeNull()
    expect(created.value.status).toBe(TAKEOUT_GUARD_STATUS.pending)
  })

  it('非法输入统一 VALIDATION_FAILED', async () => {
    const r = repo(VIEWER, [])
    const base = {
      orderNo: 'KD2026101501',
      place: '二食堂一层外卖柜',
      happenedAt: NOW.toISOString(),
      detail: '柜门里是空的。',
    }
    const cases = [
      { ...base, orderNo: '   ' },
      { ...base, orderNo: 'x'.repeat(65) },
      { ...base, place: '' },
      { ...base, place: 'x'.repeat(61) },
      { ...base, detail: '   ' },
      { ...base, detail: 'x'.repeat(1001) },
      { ...base, happenedAt: new Date(NOW.getTime() + 6 * 60_000).toISOString() },
      { ...base, happenedAt: 'not-a-date' },
    ]

    for (const input of cases) {
      const result = await r.create(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('别人的记录连"存在"都看不到（NOT_FOUND，不透露存在）', async () => {
    const r = repo(OTHER, [report({ reporterId: 'user-someone-else' })])
    const listed = await r.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items).toHaveLength(0)

    const detail = await r.detail('tg-1')
    expect(detail.ok).toBe(false)
    if (!detail.ok) expect(detail.error.code).toBe('NOT_FOUND')

    const escalated = await r.escalate('tg-1')
    expect(escalated.ok).toBe(false)
    if (!escalated.ok) expect(escalated.error.code).toBe('NOT_FOUND')
  })
})

describe('Mock 仓储 · pending → escalated → resolved', () => {
  it('escalate：pending → escalated，并刷新 updatedAt', async () => {
    const r = repo(VIEWER, [report()])
    const escalated = await r.escalate('tg-1')
    expect(escalated.ok).toBe(true)
    if (!escalated.ok) return
    expect(escalated.value.status).toBe('escalated')
    expect(escalated.value.updatedAt).toBe(NOW.toISOString())
  })

  it('重复 escalate / 已解决再 escalate → CONFLICT', async () => {
    const already = repo(VIEWER, [report({ status: 'escalated' })])
    const again = await already.escalate('tg-1')
    expect(again.ok).toBe(false)
    if (!again.ok) {
      expect(again.error.code).toBe('CONFLICT')
      expect(again.error.message).toContain('已经升级处理')
    }

    const resolved = repo(VIEWER, [report({ status: 'resolved' })])
    const afterResolve = await resolved.escalate('tg-1')
    expect(afterResolve.ok).toBe(false)
    if (!afterResolve.ok) expect(afterResolve.error.code).toBe('CONFLICT')
  })

  it('resolve 可从 pending 或 escalated 走到 resolved', async () => {
    const fromPending = repo(VIEWER, [report()])
    const resolved = await fromPending.resolve('tg-1')
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.value.status).toBe('resolved')

    const fromEscalated = repo(VIEWER, [report({ status: 'escalated' })])
    const resolved2 = await fromEscalated.resolve('tg-1')
    expect(resolved2.ok).toBe(true)
    if (resolved2.ok) expect(resolved2.value.status).toBe('resolved')
  })

  it('重复 resolve → CONFLICT', async () => {
    const r = repo(VIEWER, [report({ status: 'resolved' })])
    const again = await r.resolve('tg-1')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe('CONFLICT')
  })
})

describe('Mock 仓储 · 筛选、排序与分页', () => {
  it('列表只返回自己的记录；演示种子算"我的"', async () => {
    // 不传 seed：用默认的确定性种子（≥4 条，覆盖三种状态）
    const r = repo(VIEWER)
    const listed = await r.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (!listed.ok) return

    expect(listed.value.items.length).toBeGreaterThanOrEqual(4)
    const statuses = new Set(listed.value.items.map((item) => item.status))
    expect(statuses).toEqual(new Set(['pending', 'escalated', 'resolved']))
    // 种子属于"我"：素材化后归属就是当前登录主体
    for (const item of listed.value.items) {
      expect(item.reporterId).toBe(VIEWER)
    }
  })

  it('status 精确筛选可以叠加在"只看自己"之上', async () => {
    const r = repo(VIEWER, [
      report({ id: 'a', status: 'pending' }),
      report({ id: 'b', status: 'escalated' }),
      report({ id: 'c', status: 'resolved' }),
    ])

    const escalated = await r.list({ cursor: null, filters: { status: 'escalated' } })
    if (escalated.ok) expect(escalated.value.items.map((item) => item.id)).toEqual(['b'])

    const pending = await r.list({ cursor: null, filters: { status: 'pending' } })
    if (pending.ok) expect(pending.value.items.map((item) => item.id)).toEqual(['a'])
  })

  it('非法 status → VALIDATION_FAILED', async () => {
    const r = repo(VIEWER, [report()])
    const result = await r.list({ cursor: null, filters: { status: 'reported' as never } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
  })

  it('新记录在前（createdAt desc），游标分页只返回下一页', async () => {
    const r = repo(VIEWER, [
      report({ id: 'old', createdAt: '2026-05-01T08:00:00.000Z' }),
      report({ id: 'new', createdAt: '2026-05-01T11:00:00.000Z' }),
      report({ id: 'mid', createdAt: '2026-05-01T10:00:00.000Z' }),
    ])

    const first = await r.list({ cursor: null, limit: 2, filters: {} })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.items.map((item) => item.id)).toEqual(['new', 'mid'])
    expect(first.value.nextCursor).toBe('mid')
    // 后端不返回 total（Page.total 是可选字段）
    expect(first.value.total).toBeUndefined()

    const second = await r.list({ cursor: 'mid', limit: 2, filters: {} })
    if (second.ok) {
      expect(second.value.items.map((item) => item.id)).toEqual(['old'])
      expect(second.value.nextCursor).toBeNull()
    }
  })
})

describe('Mock 仓储 · 演示控制', () => {
  it('failNextRequests 只影响接下来 N 次请求', async () => {
    const r = repo(VIEWER, [report()])
    r.failNextRequests(1)
    const failed = await r.list({ cursor: null, filters: {} })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    const ok2 = await r.list({ cursor: null, filters: {} })
    expect(ok2.ok).toBe(true)
  })

  it('clearAll 之后是真的空列表（不会把种子数据又塞回来），reset 恢复种子', async () => {
    const r = repo(VIEWER, [report()])
    r.clearAll()
    const cleared = await r.list({ cursor: null, filters: {} })
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect(cleared.value.items).toHaveLength(0)

    r.reset()
    const afterReset = await r.list({ cursor: null, filters: {} })
    if (afterReset.ok) expect(afterReset.value.items.map((item) => item.id)).toEqual(['tg-1'])
  })

  it('新建的记录立刻能在列表里看到（内存数据集）', async () => {
    const r = repo(VIEWER, [])
    const created = await r.create({
      orderNo: 'KD2026101599',
      place: '图书馆北门外卖柜',
      happenedAt: NOW.toISOString(),
      detail: '取餐码还没用，柜门里是空的。',
    })
    expect(created.ok).toBe(true)

    const listed = await r.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (listed.ok && created.ok) {
      expect(listed.value.items.map((item) => item.id)).toContain(created.value.id)
    }
  })
})

describe('用例校验（validateDraft，提交前即时提示）', () => {
  it('空表单逐项给出提示', () => {
    const problems = validateDraft(
      { orderNo: '', place: '', happenedAtText: '', detail: '' },
      NOW,
    )
    expect(problems).toContain('请填写外卖订单号')
    expect(problems).toContain('请填写取餐点')
    expect(problems).toContain('请填写发生时间')
    expect(problems).toContain('请写清楚经过')
  })

  it('时间文本无法解析时提示格式', () => {
    const problems = validateDraft(
      { orderNo: 'KD1', place: '二食堂', happenedAtText: '刚才', detail: '没了' },
      NOW,
    )
    expect(problems).toContain('请按「YYYY-MM-DD HH:mm」填写发生时间')
  })

  it('时间晚于当前超过 5 分钟时钟偏差时给出提示', () => {
    const problems = validateDraft(
      {
        orderNo: 'KD1',
        place: '二食堂',
        happenedAtText: formatHappenedAtInput(new Date(NOW.getTime() + 30 * 60_000)),
        detail: '没了',
      },
      NOW,
    )
    expect(problems).toContain('发生时间不能晚于当前时间')
  })

  it('合法草稿没有任何问题', () => {
    expect(
      validateDraft(
        {
          orderNo: 'KD2026101501',
          place: '生活区 5 号楼一层外卖架',
          happenedAtText: formatHappenedAtInput(new Date(NOW.getTime() - 30 * 60_000)),
          detail: '袋子被拆开，主食不见了。',
        },
        NOW,
      ),
    ).toEqual([])
  })
})
