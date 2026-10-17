import { describe, expect, it } from 'vitest'

import { createMockLostFoundRepository } from '../mockLostFoundRepository'
import { createMemoryStorage } from '../../storage/memoryStorage'
import { StorageKeys } from '../../storage/keys'
import { validateDraft } from '../../../application/lostFound/lostFoundUseCases'
import {
  availableActions,
  formatHappenedAtInput,
  happenedAtProblem,
  kindBadge,
  kindLabel,
  parseHappenedAtInput,
  reopenEligibility,
  resolveActionLabel,
  resolveDoneLabel,
  resolveEligibility,
  statusLabel,
  summarize,
} from '../../../domain/models/lostFound'
import type { LostFoundItem } from '../../../domain/models/lostFound'

/**
 * 失物招领「领域规则 + Mock 仓储」的可执行规格。
 *
 * Mock 仓储的价值在于**规则一致**——归属校验、open ↔ resolved 状态机、
 * 事发时间 5 分钟偏差、筛选排序都要和后端 `LostFoundItemService` 一样。
 * 所以这里既测纯函数，也测 mock 真的执行了同样的规则（而不是「看起来像」）。
 */

const NOW = new Date('2026-05-01T12:00:00.000Z')

const REPORTER = 'user-reporter'
const OTHER = 'user-other'

function item(overrides: Partial<LostFoundItem> = {}): LostFoundItem {
  return {
    id: 'lf-1',
    reporterId: REPORTER,
    kind: 'lost',
    title: '黑色雨伞',
    description: '伞柄上有个小黄鸭贴纸',
    place: '图书馆一楼大厅',
    happenedAt: '2026-05-01T10:00:00.000Z',
    contactHint: '站内私信',
    imageUrls: [],
    status: 'open',
    resolvedAt: null,
    createdAt: '2026-05-01T10:05:00.000Z',
    updatedAt: '2026-05-01T10:05:00.000Z',
    ...overrides,
  }
}

function repo(viewer: string | null, items: LostFoundItem[] = [item()]) {
  const repository = createMockLostFoundRepository({
    cache: createMemoryStorage(),
    viewerId: () => viewer,
    latencyMs: 0,
    now: () => NOW,
  })
  repository.seed(items)
  return repository
}

describe('标签、时间解析与派生视图', () => {
  it('未知类型 / 状态降级为可读文案，而不是抛错', () => {
    expect(kindLabel('nope')).toBe('失物信息')
    expect(kindBadge('nope')).toBe('信息')
    expect(statusLabel('nope')).toBe('未知状态')
    expect(kindLabel('found')).toBe('招领启事')
    expect(statusLabel('resolved')).toBe('已解决')
  })

  it('动作文案随类型变化：捡到的叫「已归还」，丢了的叫「已找回」', () => {
    expect(resolveActionLabel('found')).toBe('标记已归还')
    expect(resolveDoneLabel('found')).toBe('已归还')
    expect(resolveActionLabel('lost')).toBe('标记已找回')
    expect(resolveDoneLabel('lost')).toBe('已找回')
  })

  it('时间文本与 Date 可以互相还原（按本地时间）', () => {
    const original = new Date(2026, 4, 1, 8, 30)
    const text = formatHappenedAtInput(original)
    expect(text).toBe('2026-05-01 08:30')

    const parsed = parseHappenedAtInput(text)
    expect(parsed?.getTime()).toBe(original.getTime())
  })

  it('时间文本接受明确格式，拒绝模糊输入和进位日期', () => {
    expect(parseHappenedAtInput('2026/05/01 08:30')?.getTime()).toBe(
      new Date(2026, 4, 1, 8, 30).getTime(),
    )
    expect(parseHappenedAtInput('2026-05-01')?.getTime()).toBe(new Date(2026, 4, 1).getTime())
    expect(parseHappenedAtInput('刚刚')).toBeNull()
    expect(parseHappenedAtInput('')).toBeNull()
    // `new Date(2026, 1, 30)` 会静默进位到 3 月，必须被识别为非法
    expect(parseHappenedAtInput('2026-02-30 10:00')).toBeNull()
    expect(parseHappenedAtInput('2026-05-01 25:00')).toBeNull()
  })

  it('事发时间允许 5 分钟时钟偏差，超出即拒绝', () => {
    expect(happenedAtProblem(new Date(Date.now()), NOW)).not.toBeNull()
    expect(happenedAtProblem(NOW, NOW)).toBeNull()
    expect(happenedAtProblem(new Date(NOW.getTime() + 4 * 60_000), NOW)).toBeNull()
    expect(happenedAtProblem(new Date(NOW.getTime() + 6 * 60_000), NOW)).toBe(
      '事发时间不能晚于当前时间',
    )
    expect(happenedAtProblem(new Date('nope'), NOW)).toBe('事发时间格式不正确')
  })

  it('summarize 给出可读标签，并标记「我发布的」', () => {
    const summary = summarize(item(), REPORTER, NOW)
    expect(summary.badge).toBe('寻物')
    expect(summary.kindLabel).toBe('寻物启事')
    expect(summary.statusLabel).toBe('进行中')
    expect(summary.mine).toBe(true)
    expect(summary.resolved).toBe(false)
    expect(summary.happenedLabel).toBe('2 小时前')

    expect(summarize(item(), OTHER, NOW).mine).toBe(false)
    expect(summarize(item(), null, NOW).mine).toBe(false)
    expect(summarize(item({ status: 'resolved' }), REPORTER, NOW).resolved).toBe(true)
    expect(summarize(item({ description: null }), REPORTER, NOW).descriptionPreview).toBe('')
  })
})

describe('动作闸门（服务端仍是最终裁决，这里只是提前藏按钮）', () => {
  it('未登录时没有任何动作', () => {
    expect(availableActions(item(), null)).toEqual([])
  })

  it('发布者：open 时可标记已解决，resolved 时可重新开放', () => {
    expect(availableActions(item(), REPORTER)).toEqual(['resolve', 'edit', 'delete'])
    expect(availableActions(item({ status: 'resolved' }), REPORTER)).toEqual([
      'reopen',
      'edit',
      'delete',
    ])
  })

  it('非发布者没有任何动作（别人的登记不能改状态）', () => {
    expect(availableActions(item(), OTHER)).toEqual([])
    expect(availableActions(item({ status: 'resolved' }), OTHER)).toEqual([])
  })

  it('resolve / reopen 给出可读的拒绝原因', () => {
    expect(resolveEligibility(item(), null).message).toContain('登录')
    expect(resolveEligibility(item(), OTHER).message).toContain('只有发布者')
    expect(resolveEligibility(item({ status: 'resolved' }), REPORTER).message).toContain(
      '已经标记为已解决',
    )
    expect(resolveEligibility(item(), REPORTER).allowed).toBe(true)

    expect(reopenEligibility(item(), REPORTER).message).toContain('不是已解决状态')
    expect(reopenEligibility(item({ status: 'resolved' }), REPORTER).allowed).toBe(true)
  })
})

describe('Mock 仓储 · 发布与归属', () => {
  it('未登录不能发布', async () => {
    const r = repo(null, [])
    const result = await r.create({
      kind: 'lost',
      title: 'x',
      place: '图书馆',
      happenedAt: NOW.toISOString(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
  })

  it('发布者永远是当前登录用户，默认 open 且 resolvedAt 为空', async () => {
    const r = repo(REPORTER, [])
    const created = await r.create({
      kind: 'found',
      title: '  捡到一张校园卡  ',
      place: '  二食堂  ',
      description: '   ',
      happenedAt: NOW.toISOString(),
      contactHint: '  到失物招领柜认领  ',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(created.value.reporterId).toBe(REPORTER)
    expect(created.value.title).toBe('捡到一张校园卡')
    expect(created.value.place).toBe('二食堂')
    // 与后端 normalizeText 一致：空串归一成 null
    expect(created.value.description).toBeNull()
    expect(created.value.contactHint).toBe('到失物招领柜认领')
    expect(created.value.status).toBe('open')
    expect(created.value.resolvedAt).toBeNull()
  })

  it('非法类型 / 空标题 / 空地点 / 未来时间统一 VALIDATION_FAILED', async () => {
    const r = repo(REPORTER, [])
    const base = { kind: 'lost', title: '钥匙', place: '教学楼', happenedAt: NOW.toISOString() }

    const cases = [
      { ...base, kind: 'borrow' },
      { ...base, title: '   ' },
      { ...base, title: 'x'.repeat(61) },
      { ...base, place: '' },
      { ...base, happenedAt: new Date(NOW.getTime() + 6 * 60_000).toISOString() },
      { ...base, happenedAt: 'not-a-date' },
      { ...base, description: 'x'.repeat(2001) },
      { ...base, contactHint: 'x'.repeat(61) },
    ]

    for (const input of cases) {
      const result = await r.create(input)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    }
  })

  it('5 分钟时钟偏差内的「刚刚发生」可以发布', async () => {
    const r = repo(REPORTER, [])
    const result = await r.create({
      kind: 'lost',
      title: '校园卡',
      place: '二食堂',
      happenedAt: new Date(NOW.getTime() + 60_000).toISOString(),
    })
    expect(result.ok).toBe(true)
  })

  it('非发布者不能改 / 删 / 标记已解决 / 重新开放（FORBIDDEN）', async () => {
    const r = repo(OTHER, [item(), item({ id: 'lf-2', status: 'resolved', resolvedAt: NOW.toISOString() })])
    const attempts = [
      await r.update('lf-1', { title: '改个名' }),
      await r.remove('lf-1'),
      await r.resolve('lf-1'),
      await r.reopen('lf-2'),
    ]
    for (const result of attempts) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('FORBIDDEN')
    }
  })

  it('未登录：记录不存在先 NOT_FOUND，存在则 UNAUTHENTICATED', async () => {
    const r = repo(null, [item()])
    const missing = await r.remove('ghost')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('NOT_FOUND')

    const existing = await r.update('lf-1', { title: 'x' })
    expect(existing.ok).toBe(false)
    if (!existing.ok) expect(existing.error.code).toBe('UNAUTHENTICATED')
  })
})

describe('Mock 仓储 · open ↔ resolved 状态机', () => {
  it('resolve：open → resolved，并写入 resolvedAt', async () => {
    const r = repo(REPORTER, [item()])
    const resolved = await r.resolve('lf-1')
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.value.status).toBe('resolved')
    expect(resolved.value.resolvedAt).toBe(NOW.toISOString())
  })

  it('重复 resolve → CONFLICT（幂等冲突而不是静默改写）', async () => {
    const r = repo(REPORTER, [item()])
    await r.resolve('lf-1')
    const again = await r.resolve('lf-1')
    expect(again.ok).toBe(false)
    if (!again.ok) {
      expect(again.error.code).toBe('CONFLICT')
      expect(again.error.message).toContain('已经标记为已解决')
    }
  })

  it('reopen：resolved → open，并清空 resolvedAt', async () => {
    const r = repo(REPORTER, [item({ status: 'resolved', resolvedAt: NOW.toISOString() })])
    const reopened = await r.reopen('lf-1')
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.value.status).toBe('open')
    expect(reopened.value.resolvedAt).toBeNull()
  })

  it('非 resolved 的 reopen → CONFLICT', async () => {
    const r = repo(REPORTER, [item()])
    const result = await r.reopen('lf-1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CONFLICT')
  })

  it('resolved 之后仍可编辑 / 删除（后端 update 不限制状态）', async () => {
    const r = repo(REPORTER, [item({ status: 'resolved', resolvedAt: NOW.toISOString() })])
    const updated = await r.update('lf-1', { title: '黑色折叠伞' })
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.value.title).toBe('黑色折叠伞')
      expect(updated.value.status).toBe('resolved')
    }

    const removed = await r.remove('lf-1')
    expect(removed.ok).toBe(true)
    const missing = await r.detail('lf-1')
    expect(missing.ok).toBe(false)
  })

  it('修改会顺带校验字段（非法时间 / 空标题）', async () => {
    const r = repo(REPORTER, [item()])
    const badTitle = await r.update('lf-1', { title: '  ' })
    expect(badTitle.ok).toBe(false)
    if (!badTitle.ok) expect(badTitle.error.code).toBe('VALIDATION_FAILED')

    const future = await r.update('lf-1', {
      happenedAt: new Date(NOW.getTime() + 10 * 60_000).toISOString(),
    })
    expect(future.ok).toBe(false)
    if (!future.ok) expect(future.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('Mock 仓储 · 筛选、排序与分页', () => {
  const seed: LostFoundItem[] = [
    item({ id: 'a', kind: 'lost', title: '苹果耳机', place: '二食堂', happenedAt: '2026-05-01T09:00:00.000Z' }),
    item({
      id: 'b',
      kind: 'found',
      title: '黑色钱包',
      description: '里面有校园卡',
      place: '图书馆',
      happenedAt: '2026-05-01T11:00:00.000Z',
    }),
    item({
      id: 'c',
      kind: 'found',
      title: '蓝色水杯',
      place: '体育馆',
      status: 'resolved',
      resolvedAt: NOW.toISOString(),
      happenedAt: '2026-05-01T08:00:00.000Z',
    }),
  ]

  it('按类型 / 状态筛选可以叠加', async () => {
    const r = repo(OTHER, seed)
    const found = await r.list({ cursor: null, filters: { kind: 'found' } })
    if (found.ok) expect(found.value.items.map((i) => i.id).sort()).toEqual(['b', 'c'])

    const open = await r.list({ cursor: null, filters: { kind: 'found', status: 'open' } })
    if (open.ok) expect(open.value.items.map((i) => i.id)).toEqual(['b'])

    const resolved = await r.list({ cursor: null, filters: { status: 'resolved' } })
    if (resolved.ok) expect(resolved.value.items.map((i) => i.id)).toEqual(['c'])
  })

  it('关键词同时匹配标题、描述与地点', async () => {
    const r = repo(OTHER, seed)
    const byTitle = await r.list({ cursor: null, filters: { keyword: '水杯' } })
    if (byTitle.ok) expect(byTitle.value.items.map((i) => i.id)).toEqual(['c'])

    const byDescription = await r.list({ cursor: null, filters: { keyword: '校园卡' } })
    if (byDescription.ok) expect(byDescription.value.items.map((i) => i.id)).toEqual(['b'])

    const byPlace = await r.list({ cursor: null, filters: { keyword: '二食堂' } })
    if (byPlace.ok) expect(byPlace.value.items.map((i) => i.id)).toEqual(['a'])
  })

  it('地点筛选与关键词是两个独立条件，可以叠加', async () => {
    const r = repo(OTHER, seed)
    const placeOnly = await r.list({ cursor: null, filters: { place: '食堂' } })
    if (placeOnly.ok) expect(placeOnly.value.items.map((i) => i.id)).toEqual(['a'])

    const both = await r.list({ cursor: null, filters: { place: '食堂', keyword: '钱包' } })
    if (both.ok) expect(both.value.items).toHaveLength(0)
  })

  it('latest 按事发时间倒序，oldest 正序', async () => {
    const r = repo(OTHER, seed)
    const latest = await r.list({ cursor: null, filters: { sort: 'latest' } })
    if (latest.ok) expect(latest.value.items.map((i) => i.id)).toEqual(['b', 'a', 'c'])

    const oldest = await r.list({ cursor: null, filters: { sort: 'oldest' } })
    if (oldest.ok) expect(oldest.value.items.map((i) => i.id)).toEqual(['c', 'a', 'b'])
  })

  it('游标分页只返回下一页，并给出正确的 nextCursor', async () => {
    const r = repo(OTHER, seed)
    const first = await r.list({ cursor: null, limit: 2, filters: { sort: 'oldest' } })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.items.map((i) => i.id)).toEqual(['c', 'a'])
    expect(first.value.nextCursor).toBe('a')
    // 后端不返回 total（Page.total 是可选字段）
    expect(first.value.total).toBeUndefined()

    const second = await r.list({ cursor: 'a', limit: 2, filters: { sort: 'oldest' } })
    if (second.ok) {
      expect(second.value.items.map((i) => i.id)).toEqual(['b'])
      expect(second.value.nextCursor).toBeNull()
    }
  })

  it('mine 只看自己发布的（用当前登录主体判定）', async () => {
    const mine = repo(REPORTER, seed)
    const result = await mine.list({ cursor: null, filters: { mine: true } })
    if (result.ok) expect(result.value.items.map((i) => i.id)).toEqual(['b', 'a', 'c'])

    const other = repo(OTHER, seed)
    const otherResult = await other.list({ cursor: null, filters: { mine: true } })
    if (otherResult.ok) expect(otherResult.value.items).toHaveLength(0)

    const anonymous = repo(null, seed)
    const anonymousResult = await anonymous.list({ cursor: null, filters: { mine: true } })
    if (anonymousResult.ok) expect(anonymousResult.value.items).toHaveLength(0)
  })

  it('非法 kind / status / sort → VALIDATION_FAILED', async () => {
    const r = repo(OTHER, seed)
    const results = await Promise.all([
      r.list({ cursor: null, filters: { kind: 'borrow' as never } }),
      r.list({ cursor: null, filters: { status: 'closed' as never } }),
      r.list({ cursor: null, filters: { sort: 'hot' as never } }),
    ])
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    }
  })
})

describe('Mock 仓储 · 持久化与演示控制', () => {
  it('数据落在 CachePort：新实例读到同一份数据（刷新页面不丢）', async () => {
    const cache = createMemoryStorage()
    const options = { cache, viewerId: () => REPORTER, latencyMs: 0, now: () => NOW }

    const first = createMockLostFoundRepository(options)
    const created = await first.create({
      kind: 'lost',
      title: '宿舍钥匙',
      place: '5 号宿舍楼门口',
      happenedAt: NOW.toISOString(),
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const second = createMockLostFoundRepository(options)
    const listed = await second.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items.map((i) => i.id)).toContain(created.value.id)
  })

  it('数据集与列表缓存使用不同的 key：写缓存不会覆盖数据集', async () => {
    const cache = createMemoryStorage()
    const r = createMockLostFoundRepository({
      cache,
      viewerId: () => REPORTER,
      latencyMs: 0,
      now: () => NOW,
    })
    r.seed([item()])

    // 模拟 listUseCase.writeCache 往列表缓存 key 写一页载荷
    cache.write(StorageKeys.lostFoundListCache, {
      items: [],
      nextCursor: null,
      updatedAt: NOW.toISOString(),
    })

    const listed = await r.list({ cursor: null, filters: {} })
    expect(listed.ok).toBe(true)
    if (listed.ok) expect(listed.value.items.map((i) => i.id)).toEqual(['lf-1'])
  })

  it('不存在的记录统一 NOT_FOUND', async () => {
    const r = repo(REPORTER, [])
    const results = await Promise.all([
      r.detail('ghost'),
      r.update('ghost', { title: 'x' }),
      r.remove('ghost'),
      r.resolve('ghost'),
      r.reopen('ghost'),
    ])
    for (const result of results) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
    }
  })

  it('failNextRequests 只影响接下来 N 次请求', async () => {
    const r = repo(REPORTER, [item()])
    r.failNextRequests(1)
    const failed = await r.list({ cursor: null, filters: {} })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    const ok2 = await r.list({ cursor: null, filters: {} })
    expect(ok2.ok).toBe(true)
  })

  it('clearAll 之后是真的空列表（不会把种子数据又塞回来）', async () => {
    const r = repo(REPORTER, [item()])
    r.clearAll()
    const result = await r.list({ cursor: null, filters: {} })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.items).toHaveLength(0)

    r.reset()
    const afterReset = await r.list({ cursor: null, filters: {} })
    if (afterReset.ok) expect(afterReset.value.items.length).toBeGreaterThan(0)
  })
})

describe('用例校验（validateDraft，发布前即时提示）', () => {
  it('空表单逐项给出提示', () => {
    const problems = validateDraft(
      { kind: 'lost', title: '', description: '', place: '', happenedAtText: '', contactHint: '' },
      NOW,
    )
    expect(problems).toContain('请填写物品名称')
    expect(problems).toContain('请填写地点')
    expect(problems).toContain('请填写事发时间')
  })

  it('时间文本无法解析时提示格式', () => {
    const problems = validateDraft(
      {
        kind: 'lost',
        title: '钥匙',
        description: '',
        place: '教学楼',
        happenedAtText: '刚才',
        contactHint: '',
      },
      NOW,
    )
    expect(problems).toContain('请按「YYYY-MM-DD HH:mm」填写事发时间')
  })

  it('时间晚于当前超过 5 分钟时钟偏差时给出提示', () => {
    const problems = validateDraft(
      {
        kind: 'lost',
        title: '钥匙',
        description: '',
        place: '教学楼',
        happenedAtText: formatHappenedAtInput(new Date(NOW.getTime() + 30 * 60_000)),
        contactHint: '',
      },
      NOW,
    )
    expect(problems).toContain('事发时间不能晚于当前时间')
  })

  it('合法草稿没有任何问题', () => {
    expect(
      validateDraft(
        {
          kind: 'found',
          title: '捡到一张校园卡',
          description: '已交到二食堂失物招领柜',
          place: '二食堂二楼',
          happenedAtText: formatHappenedAtInput(new Date(NOW.getTime() - 30 * 60_000)),
          contactHint: '站内私信',
        },
        NOW,
      ),
    ).toEqual([])
  })
})
