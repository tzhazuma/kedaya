import { describe, expect, it } from 'vitest'

import { createMockWellbeingRepository } from '../mockWellbeingRepository'
import {
  WELLBEING_CONSENT_CACHE_KEY,
  createWellbeingUseCases,
  validateDraft,
} from '../../../application/wellbeing/wellbeingUseCases'
import type { WellbeingDraft } from '../../../application/wellbeing/wellbeingUseCases'
import {
  CRISIS_FALLBACK,
  WELLBEING_MODULE_ID,
  WELLBEING_STATUS,
  cancellable,
  formatSlotAtInput,
  isDialable,
  modeLabel,
  normalizeCrisisLine,
  parseSlotAtInput,
  slotAtProblem,
  statusLabel,
  statusTimeline,
  summarize,
} from '../../../domain/models/wellbeing'
import type { WellbeingAppointment } from '../../../domain/models/wellbeing'
import type { CachePort } from '../../../domain/ports/cachePort'

/**
 * 心理支持「领域规则 + Mock 仓储 + 用例同意门」的可执行规格。
 *
 * 这个模块的独特性在于两条**不能靠肉眼演示**的规则，必须由测试守住：
 *   1. **危机出口公开**：未登录、未同意都必须拿得到（其余数据全被门槛挡住）；
 *   2. **同意是双轨的**：本地留痕决定"门要不要弹"，服务端记录才是放行依据 ——
 *      本地有、服务端没有时必须能自动回到同意门。
 */

const NOW = new Date('2026-05-01T12:00:00.000Z')
const VIEWER = 'user-viewer'
const OTHER = 'user-other'

function appointment(overrides: Partial<WellbeingAppointment> = {}): WellbeingAppointment {
  return {
    id: 'wb-1',
    userId: VIEWER,
    counselor: '李老师',
    slotAt: '2026-05-02T10:00:00.000Z',
    mode: 'onsite',
    status: WELLBEING_STATUS.requested,
    note: '想聊聊最近的作息安排。',
    crisisFlag: false,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  }
}

function repo(viewer: string | null, seed?: WellbeingAppointment[]) {
  return createMockWellbeingRepository({
    viewerId: () => viewer,
    ...(seed === undefined ? {} : { seed }),
    latencyMs: 0,
    now: () => NOW,
  })
}

function memoryCache(): CachePort {
  const store = new Map<string, unknown>()
  return {
    read<T>(key: string): T | null {
      return store.has(key) ? (store.get(key) as T) : null
    },
    write<T>(key: string, value: T): void {
      store.set(key, value)
    },
    remove(key: string): void {
      store.delete(key)
    },
  }
}

/* ------------------------------------------------------------------ *
 * 纯领域：标签 / 时间 / 派生视图
 * ------------------------------------------------------------------ */

describe('标签、时间与派生视图', () => {
  it('未知状态与未知方式降级为可读文案，而不是抛错', () => {
    expect(statusLabel('nope')).toBe('未知状态')
    expect(statusLabel('requested')).toBe('待确认')
    expect(statusLabel('confirmed')).toBe('已确认')
    expect(statusLabel('completed')).toBe('已完成')
    expect(statusLabel('cancelled')).toBe('已取消')

    expect(modeLabel('onsite')).toContain('线下')
    expect(modeLabel('online')).toContain('线上')
    expect(modeLabel('nope')).toBe('方式待确认')
  })

  it('预约时间文本与 Date 可以互相还原（按本地时间）', () => {
    const original = new Date(2026, 4, 2, 15, 30)
    expect(formatSlotAtInput(original)).toBe('2026-05-02 15:30')
    expect(parseSlotAtInput(formatSlotAtInput(original))?.getTime()).toBe(original.getTime())
  })

  it('时间文本接受明确格式，拒绝模糊输入与进位日期', () => {
    expect(parseSlotAtInput('2026/05/02 15:30')?.getTime()).toBe(
      new Date(2026, 4, 2, 15, 30).getTime(),
    )
    expect(parseSlotAtInput('2026-05-02')?.getTime()).toBe(new Date(2026, 4, 2).getTime())
    expect(parseSlotAtInput('明天下午')).toBeNull()
    expect(parseSlotAtInput('')).toBeNull()
    // `new Date(2026, 1, 30)` 会静默进位到 3 月，必须被识别为非法
    expect(parseSlotAtInput('2026-02-30 10:00')).toBeNull()
    expect(parseSlotAtInput('2026-05-02 25:00')).toBeNull()
  })

  it('预约时间不能早于现在（允许 5 分钟时钟偏差）', () => {
    expect(slotAtProblem(NOW, NOW)).toBeNull()
    expect(slotAtProblem(new Date(NOW.getTime() - 4 * 60_000), NOW)).toBeNull()
    expect(slotAtProblem(new Date(NOW.getTime() - 6 * 60_000), NOW)).toBe('预约时间需要晚于现在')
    expect(slotAtProblem(new Date('nope'), NOW)).toBe('请按「YYYY-MM-DD HH:mm」填写预约时间')
  })

  it('summarize 给出卡片直接可用的字段', () => {
    const summary = summarize(appointment(), NOW)
    expect(summary.statusLabel).toBe('待确认')
    expect(summary.modeLabel).toContain('线下')
    expect(summary.slotLabel).toBe(formatSlotAtInput(new Date(appointment().slotAt)))
    expect(summary.slotRelative).not.toBe('')
    expect(summary.notePreview).toBe('想聊聊最近的作息安排。')
    expect(summary.crisisFlag).toBe(false)
    expect(summary.cancelled).toBe(false)
    expect(summary.completed).toBe(false)

    expect(summarize(appointment({ status: 'cancelled' }), NOW).cancelled).toBe(true)
    expect(summarize(appointment({ status: 'completed' }), NOW).completed).toBe(true)
    // 缺 note 与非法 slotAt 都不该抛错
    expect(summarize(appointment({ note: null }), NOW).notePreview).toBe('')
    expect(summarize(appointment({ slotAt: 'nope' }), NOW).slotLabel).toBe('时间待确认')
  })

  it('statusTimeline 把状态翻译成「已完成 / 当前 / 未开始」', () => {
    expect(statusTimeline('requested').map((step) => step.state)).toEqual([
      'current',
      'todo',
      'todo',
    ])
    expect(statusTimeline('confirmed').map((step) => step.state)).toEqual(['done', 'current', 'todo'])
    expect(statusTimeline('completed').map((step) => step.state)).toEqual(['done', 'done', 'current'])
    // 已取消是一条分支：三个节点全是 todo，页面另给"已取消"说明
    expect(statusTimeline('cancelled').map((step) => step.state)).toEqual(['todo', 'todo', 'todo'])
    expect(statusTimeline('nope').map((step) => step.state)).toEqual(['current', 'todo', 'todo'])
  })
})

describe('危机出口数据（兜底 + 防御性解析）', () => {
  it('兜底数据本身就是可执行的：号码可拨打、有辅导员渠道、公开', () => {
    expect(CRISIS_FALLBACK.module).toBe(WELLBEING_MODULE_ID)
    expect(CRISIS_FALLBACK.requiresLogin).toBe(false)
    expect(CRISIS_FALLBACK.requiresConsent).toBe(false)
    expect(CRISIS_FALLBACK.hotlines.some((hotline) => isDialable(hotline.number))).toBe(true)
    expect(CRISIS_FALLBACK.channels.length).toBeGreaterThan(0)
  })

  it('isDialable 只认纯号码：带「/」或中文的一律不给拨打按钮', () => {
    expect(isDialable('110')).toBe(true)
    expect(isDialable('021-12320-5')).toBe(true)
    expect(isDialable('110 / 120')).toBe(false)
    expect(isDialable('拨打保卫处')).toBe(false)
  })

  it('形状不合规的响应返回 null（让页面切兜底，而不是抛错让危机信息消失）', () => {
    expect(normalizeCrisisLine(null)).toBeNull()
    expect(normalizeCrisisLine({ hotlines: [] })).toBeNull()

    const line = normalizeCrisisLine({
      module: 'wellbeing',
      title: '紧急',
      message: '马上找人',
      hotlines: [{ name: '报警', number: '110' }, { name: '脏数据' }],
      channels: [{ name: '辅导员', instruction: '直接联系' }],
      prominence: 'primary',
      requiresLogin: false,
      requiresConsent: false,
    })
    expect(line).not.toBeNull()
    if (line === null) return
    expect(line.hotlines).toEqual([{ name: '报警', number: '110' }])
    expect(line.channels).toEqual([{ name: '辅导员', instruction: '直接联系' }])
    // 缺 title / message 时补兜底文案，而不是留空
    const sparse = normalizeCrisisLine({ hotlines: [{ name: '报警', number: '110' }] })
    expect(sparse?.title).toBe(CRISIS_FALLBACK.title)
    expect(sparse?.message).toBe(CRISIS_FALLBACK.message)
  })
})

describe('动作闸门（服务端仍是最终裁决，这里只是提前藏按钮）', () => {
  it('未登录 / 非本人：不能取消，文案说得清楚', () => {
    expect(cancellable(appointment(), null).message).toContain('登录')
    expect(cancellable(appointment(), OTHER).message).toContain('只能取消自己')
  })

  it('已取消 / 已完成不能取消；requested / confirmed 可以', () => {
    expect(cancellable(appointment({ status: 'cancelled' }), VIEWER).message).toContain('已经取消')
    expect(cancellable(appointment({ status: 'completed' }), VIEWER).message).toContain('已完成')
    expect(cancellable(appointment({ status: 'requested' }), VIEWER).allowed).toBe(true)
    expect(cancellable(appointment({ status: 'confirmed' }), VIEWER).allowed).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * Mock 仓储：登录、同意、归属、状态机
 * ------------------------------------------------------------------ */

describe('Mock 仓储 · 登录与同意门', () => {
  it('未登录：危机出口照常可拿，其余一律 UNAUTHENTICATED', async () => {
    const r = repo(null, [appointment({ userId: 'mock-self' })])

    const crisis = await r.crisisLine()
    expect(crisis.ok).toBe(true)

    const results = await Promise.all([
      r.list({ cursor: null, filters: {} }),
      r.detail('wb-1'),
      r.create({ counselor: '李老师', slotAt: NOW.toISOString(), mode: 'onsite' }),
      r.cancel('wb-1'),
      r.activeConsent(),
      r.grantConsent(),
    ])
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    }
  })

  it('已登录但未同意：危机出口仍公开，数据类一律 CONSENT_REQUIRED', async () => {
    const r = repo(VIEWER, [appointment()])

    const crisis = await r.crisisLine()
    expect(crisis.ok).toBe(true)

    const listed = await r.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(false)
    if (!listed.ok) {
      expect(listed.error.code).toBe('CONSENT_REQUIRED')
      expect(listed.error.details).toEqual({ module: 'wellbeing' })
    }

    const detail = await r.detail('wb-1')
    expect(detail.ok).toBe(false)
    if (!detail.ok) expect(detail.error.code).toBe('CONSENT_REQUIRED')
  })

  it('同意后放行；撤回后立刻回到 CONSENT_REQUIRED', async () => {
    const r = repo(VIEWER, [appointment()])

    const granted = await r.grantConsent()
    expect(granted.ok).toBe(true)
    if (granted.ok) {
      expect(granted.value.module).toBe('wellbeing')
      expect(granted.value.revokedAt).toBeNull()
    }

    const active = await r.activeConsent()
    if (active.ok) expect(active.value).toBe(true)

    const listed = await r.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)

    await r.revokeConsent()
    const activeAfter = await r.activeConsent()
    if (activeAfter.ok) expect(activeAfter.value).toBe(false)

    const blocked = await r.list({ cursor: null, filters: {} })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error.code).toBe('CONSENT_REQUIRED')

    // 从未同意过时撤回是幂等的：返回 ok(null)
    const fresh = repo(VIEWER, [appointment()])
    const never = await fresh.revokeConsent()
    expect(never.ok).toBe(true)
    if (never.ok) expect(never.value).toBeNull()
  })
})

describe('Mock 仓储 · 归属与隔离', () => {
  it('创建：归属是当前登录主体，状态恒为 requested，文本被 trim，空摘要归一为 null', async () => {
    const r = repo(VIEWER, [])
    await r.grantConsent()

    const created = await r.create({
      counselor: '  王老师  ',
      slotAt: NOW.toISOString(),
      mode: 'online',
      note: '    ',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(created.value.userId).toBe(VIEWER)
    expect(created.value.counselor).toBe('王老师')
    expect(created.value.mode).toBe('online')
    expect(created.value.status).toBe(WELLBEING_STATUS.requested)
    expect(created.value.note).toBeNull()
    expect(created.value.crisisFlag).toBe(false)
    expect(created.value.createdAt).toBe(NOW.toISOString())
  })

  it('别人的预约连「存在」都看不到（NOT_FOUND，不透露存在）', async () => {
    const r = repo(OTHER, [appointment({ userId: 'user-someone-else' })])
    await r.grantConsent()

    const listed = await r.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items).toHaveLength(0)

    const detail = await r.detail('wb-1')
    expect(detail.ok).toBe(false)
    if (!detail.ok) expect(detail.error.code).toBe('NOT_FOUND')

    const cancelled = await r.cancel('wb-1')
    expect(cancelled.ok).toBe(false)
    if (!cancelled.ok) expect(cancelled.error.code).toBe('NOT_FOUND')
  })

  it('演示种子算「我的预约」；列表强制只看自己', async () => {
    const r = repo(VIEWER)
    await r.grantConsent()

    const listed = await r.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (!listed.ok) return

    expect(listed.value.items.length).toBeGreaterThanOrEqual(4)
    const statuses = new Set(listed.value.items.map((item) => item.status))
    expect(statuses).toEqual(
      new Set(['requested', 'confirmed', 'completed', 'cancelled']),
    )
    for (const item of listed.value.items) {
      expect(item.userId).toBe(VIEWER)
    }
  })
})

describe('Mock 仓储 · 校验与筛选', () => {
  it('非法创建输入统一 VALIDATION_FAILED', async () => {
    const r = repo(VIEWER, [])
    await r.grantConsent()

    const base = {
      counselor: '李老师',
      slotAt: NOW.toISOString(),
      mode: 'onsite' as const,
      note: null,
    }
    const cases = [
      { ...base, counselor: '   ' },
      { ...base, counselor: 'x'.repeat(121) },
      { ...base, mode: 'phone' as never },
      { ...base, note: 'x'.repeat(1001) },
      { ...base, slotAt: new Date(NOW.getTime() - 10 * 60_000).toISOString() },
      { ...base, slotAt: 'not-a-date' },
    ]

    for (const input of cases) {
      const result = await r.create(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('status 精确筛选叠加在「只看自己」之上；非法 status → VALIDATION_FAILED', async () => {
    const r = repo(VIEWER, [
      appointment({ id: 'a', status: 'requested' }),
      appointment({ id: 'b', status: 'confirmed' }),
      appointment({ id: 'c', status: 'completed' }),
    ])
    await r.grantConsent()

    const confirmed = await r.list({ cursor: null, filters: { status: 'confirmed' } })
    if (confirmed.ok) expect(confirmed.value.items.map((item) => item.id)).toEqual(['b'])

    const invalid = await r.list({ cursor: null, filters: { status: 'crisis-escalated' as never } })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('Mock 仓储 · 取消状态机', () => {
  it('requested / confirmed → cancelled，并刷新 updatedAt', async () => {
    const fromRequested = repo(VIEWER, [appointment()])
    await fromRequested.grantConsent()
    const cancelled = await fromRequested.cancel('wb-1')
    expect(cancelled.ok).toBe(true)
    if (cancelled.ok) {
      expect(cancelled.value.status).toBe('cancelled')
      expect(cancelled.value.updatedAt).toBe(NOW.toISOString())
    }

    const fromConfirmed = repo(VIEWER, [appointment({ status: 'confirmed' })])
    await fromConfirmed.grantConsent()
    const cancelled2 = await fromConfirmed.cancel('wb-1')
    expect(cancelled2.ok).toBe(true)
    if (cancelled2.ok) expect(cancelled2.value.status).toBe('cancelled')
  })

  it('重复取消 / 已完成取消 → CONFLICT', async () => {
    const already = repo(VIEWER, [appointment({ status: 'cancelled' })])
    await already.grantConsent()
    const again = await already.cancel('wb-1')
    expect(again.ok).toBe(false)
    if (!again.ok) {
      expect(again.error.code).toBe('CONFLICT')
      expect(again.error.message).toContain('已经取消')
    }

    const completed = repo(VIEWER, [appointment({ status: 'completed' })])
    await completed.grantConsent()
    const afterComplete = await completed.cancel('wb-1')
    expect(afterComplete.ok).toBe(false)
    if (!afterComplete.ok) expect(afterComplete.error.code).toBe('CONFLICT')
  })
})

describe('Mock 仓储 · 排序与分页', () => {
  it('预约时间新 → 旧（slotAt desc + id desc），游标分页只返回下一页', async () => {
    const r = repo(VIEWER, [
      appointment({ id: 'old', slotAt: '2026-05-01T13:00:00.000Z' }),
      appointment({ id: 'new', slotAt: '2026-05-01T18:00:00.000Z' }),
      appointment({ id: 'mid', slotAt: '2026-05-01T15:00:00.000Z' }),
    ])
    await r.grantConsent()

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
    const r = repo(VIEWER, [appointment()])
    await r.grantConsent()
    r.failNextRequests(1)

    const failed = await r.list({ cursor: null, filters: {} })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    const ok2 = await r.list({ cursor: null, filters: {} })
    expect(ok2.ok).toBe(true)
  })

  it('clearAll 之后是真的空列表，reset 恢复种子并把服务端同意重置为未同意', async () => {
    const r = repo(VIEWER, [appointment()])
    await r.grantConsent()

    r.clearAll()
    const cleared = await r.list({ cursor: null, filters: {} })
    expect(cleared.ok).toBe(true)
    if (cleared.ok) expect(cleared.value.items).toHaveLength(0)

    r.reset()
    const afterReset = await r.list({ cursor: null, filters: {} })
    expect(afterReset.ok).toBe(false)
    if (!afterReset.ok) expect(afterReset.error.code).toBe('CONSENT_REQUIRED')

    await r.grantConsent()
    const seeded = await r.list({ cursor: null, filters: {} })
    if (seeded.ok) expect(seeded.value.items.map((item) => item.id)).toEqual(['wb-1'])
  })

  it('seedData 直接替换数据集；新建的记录立刻能在列表里看到', async () => {
    const r = repo(VIEWER, [])
    await r.grantConsent()

    r.seedData([appointment({ id: 'seeded' })])
    const listed = await r.list({ cursor: null, filters: {} })
    if (listed.ok) expect(listed.value.items.map((item) => item.id)).toEqual(['seeded'])

    const created = await r.create({ counselor: '王老师', slotAt: NOW.toISOString(), mode: 'onsite' })
    expect(created.ok).toBe(true)
    const after = await r.list({ cursor: null, filters: {} })
    if (after.ok && created.ok) {
      expect(after.value.items.map((item) => item.id)).toContain(created.value.id)
    }
  })

  it('revokeServerConsent 只抹服务端同意：数据请求回到 CONSENT_REQUIRED', async () => {
    const r = repo(VIEWER, [appointment()])
    await r.grantConsent()
    r.revokeServerConsent()

    const blocked = await r.list({ cursor: null, filters: {} })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.error.code).toBe('CONSENT_REQUIRED')
  })
})

/* ------------------------------------------------------------------ *
 * 用例层：草稿校验 + 同意双轨
 * ------------------------------------------------------------------ */

function draft(overrides: Partial<WellbeingDraft> = {}): WellbeingDraft {
  return {
    counselor: '李老师',
    slotAtText: formatSlotAtInput(new Date(NOW.getTime() + 24 * 60 * 60 * 1000)),
    mode: 'onsite',
    note: '',
    ...overrides,
  }
}

describe('用例校验（validateDraft，提交前即时提示）', () => {
  it('空表单逐项给出提示', () => {
    const problems = validateDraft({ counselor: '', slotAtText: '', mode: 'onsite', note: '' }, NOW)
    expect(problems).toContain('请填写想约的老师 / 咨询师')
    expect(problems).toContain('请填写预约时间')
  })

  it('时间文本无法解析 / 早于现在时给出对应提示', () => {
    expect(validateDraft(draft({ slotAtText: '明天' }), NOW)).toContain(
      '请按「YYYY-MM-DD HH:mm」填写预约时间',
    )
    expect(
      validateDraft(draft({ slotAtText: formatSlotAtInput(new Date(NOW.getTime() - 30 * 60_000)) }), NOW),
    ).toContain('预约时间需要晚于现在')
  })

  it('摘要超长时给出提示；合法草稿没有任何问题', () => {
    expect(validateDraft(draft({ note: 'x'.repeat(1001) }), NOW)).toContain('摘要最多 1000 个字')
    expect(validateDraft(draft(), NOW)).toEqual([])
  })
})

describe('用例 · 同意双轨（本地留痕 + 服务端记录）', () => {
  function useCases(viewer: string | null, seed?: WellbeingAppointment[]) {
    const repository = repo(viewer, seed)
    const cache = memoryCache()
    const useCases = createWellbeingUseCases({
      repository,
      cache,
      clock: { now: () => NOW },
      cacheKey: 'kedaya:v1:cache:wellbeing:list',
      viewerId: () => viewer,
    })
    return { repository, cache, useCases }
  }

  it('本地同意写在共享的 consent key 下，且按模块合并写回', async () => {
    const { cache, useCases: uc } = useCases(VIEWER)
    // 预置另一个敏感模块的同意，验证写回不会整块覆盖
    cache.write(WELLBEING_CONSENT_CACHE_KEY, { 'dorm-harmony': { acceptedAt: 'x', version: 'v1' } })

    const result = await uc.acceptConsent()
    expect(result.ok).toBe(true)
    expect(uc.hasConsented()).toBe(true)

    const stored = cache.read<Record<string, unknown>>(WELLBEING_CONSENT_CACHE_KEY)
    expect(stored?.['dorm-harmony']).toEqual({ acceptedAt: 'x', version: 'v1' })
    expect(stored?.wellbeing).toMatchObject({ version: 'v1' })
  })

  it('未登录时只写本地；已登录时服务端拒绝则不写本地', async () => {
    const loggedOut = useCases(null).useCases
    const accepted = await loggedOut.acceptConsent()
    expect(accepted.ok).toBe(true)
    expect(loggedOut.hasConsented()).toBe(true)

    // 已登录但服务端不可用：grantConsent 失败，本地不该留下"已同意"的假象
    const { repository, useCases: uc } = useCases(VIEWER)
    repository.failNextRequests(1)
    const failed = await uc.acceptConsent()
    expect(failed.ok).toBe(false)
    expect(uc.hasConsented()).toBe(false)
  })

  it('needsConsent：本地有、服务端没有时清本地并返回 true', async () => {
    const { repository, useCases: uc } = useCases(VIEWER, [appointment()])

    expect(await uc.needsConsent()).toBe(true)
    expect(uc.hasConsented()).toBe(false)

    await uc.acceptConsent()
    expect(await uc.needsConsent()).toBe(false)

    // 换设备 / 服务端记录被撤回：本地还在，但服务端已经没有了
    repository.revokeServerConsent()
    expect(await uc.needsConsent()).toBe(true)
    expect(uc.hasConsented()).toBe(false)
  })

  it('撤回同意先清本地再同步服务端', async () => {
    const { repository, useCases: uc } = useCases(VIEWER, [appointment()])
    await uc.acceptConsent()

    const revoked = await uc.revokeConsent()
    expect(revoked.ok).toBe(true)
    expect(uc.hasConsented()).toBe(false)

    const active = await repository.activeConsent()
    if (active.ok) expect(active.value).toBe(false)
  })

  it('create 撞上 CONSENT_REQUIRED 时会清掉本地留痕（让同意门重新出现）', async () => {
    const { repository, useCases: uc } = useCases(VIEWER, [])
    await uc.acceptConsent()
    // 本地有同意、服务端被抹掉：下一次 create 会被服务端拦下
    repository.revokeServerConsent()

    const result = await uc.create(draft())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CONSENT_REQUIRED')
    expect(uc.hasConsented()).toBe(false)
  })

  it('未登录 create / cancel 直接失败，不发注定 401 的请求', async () => {
    const { useCases: uc } = useCases(null)
    const created = await uc.create(draft())
    expect(created.ok).toBe(false)
    if (!created.ok) expect(created.error.code).toBe('UNAUTHENTICATED')

    const cancelled = await uc.cancel('wb-1')
    expect(cancelled.ok).toBe(false)
    if (!cancelled.ok) expect(cancelled.error.code).toBe('UNAUTHENTICATED')
  })
})
