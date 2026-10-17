import { describe, expect, it } from 'vitest'

import {
  availableErrandActions,
  canAcceptErrand,
  errandRouteLabel,
  errandSortLabel,
  errandStatusLabel,
  formatMoment,
  summarizeErrandTask,
} from '../../../domain/models/errand'
import type { ErrandTask } from '../../../domain/models/errand'
import { createMemoryStorage } from '../../storage/memoryStorage'
import { createMockErrandRepository } from '../mockErrandRepository'

/**
 * 跑腿「领域规则 + Mock 仓储」的可执行规格。
 *
 * 与跳蚤市场同样的理由：Mock 仓储的价值在于**规则一致**——
 * 归属校验、状态机、筛选排序、时间校验都要和后端 `errand.service.ts`
 * 一样。所以这里既测纯函数，也测 mock 真的执行了同样的规则。
 */

const NOW = new Date('2026-05-01T12:00:00.000Z')
const REQUESTER = 'user-requester'
const RUNNER = 'user-runner'
const STRANGER = 'user-stranger'

const LATER = '2026-05-01T18:00:00.000Z'

function task(overrides: Partial<ErrandTask> = {}): ErrandTask {
  return {
    id: 't1',
    requesterId: REQUESTER,
    runnerId: null,
    title: '帮忙取快递',
    detail: '菜鸟驿站 3 号柜',
    rewardFen: 500,
    fromPlace: '菜鸟驿站',
    toPlace: '3 号楼楼下',
    deadline: LATER,
    status: 'open',
    acceptedAt: null,
    deliveredAt: null,
    settledAt: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  }
}

function repo(viewer: string | null, seed: ErrandTask[] = [task()]) {
  return createMockErrandRepository({
    cache: createMemoryStorage(),
    viewerId: () => viewer,
    latencyMs: 0,
    now: () => NOW,
    seed,
  })
}

describe('跑腿：标签与派生视图', () => {
  it('未知状态降级为可读文案，而不是抛错', () => {
    expect(errandStatusLabel('open')).toBe('待接单')
    expect(errandStatusLabel('nope')).toBe('未知状态')
    expect(errandSortLabel('nope')).toBe('最新发布')
  })

  it('悬赏按整数分展示成元；路线与截止时间可读', () => {
    const summary = summarizeErrandTask(task({ rewardFen: 1_250 }), null, NOW)
    expect(summary.rewardLabel).toBe('12.50')
    expect(summary.routeLabel).toBe('菜鸟驿站 → 3 号楼楼下')
    // formatDeadline 给出「还有 6 小时」/「已截止」，两者都可读
    expect(summary.deadlineLabel).toBe('还有 6 小时')
    expect(
      summarizeErrandTask(task({ deadline: '2026-05-01T11:00:00.000Z' }), null, NOW).deadlineLabel,
    ).toBe('已截止')
    expect(errandRouteLabel({ fromPlace: 'A', toPlace: 'B' })).toBe('A → B')
    // 两点**分开**给（卡片要画成两行导轨，不能靠解析 routeLabel 得到）
    expect(summary.fromPlace).toBe('菜鸟驿站')
    expect(summary.toPlace).toBe('3 号楼楼下')
  })

  it('截止状态由领域层算好：临期（≤2 小时）与已过是**两个**独立标记', () => {
    // 6 小时后 → 不紧急、未过期
    const far = summarizeErrandTask(task({ deadline: LATER }), null, NOW)
    expect(far.deadlineUrgent).toBe(false)
    expect(far.deadlinePassed).toBe(false)

    // 90 分钟后 → 处于 2 小时窗口内
    const near = summarizeErrandTask(task({ deadline: '2026-05-01T13:30:00.000Z' }), null, NOW)
    expect(near.deadlineUrgent).toBe(true)
    expect(near.deadlinePassed).toBe(false)

    // 正好 2 小时（边界含端点）算临期
    const edge = summarizeErrandTask(task({ deadline: '2026-05-01T14:00:00.000Z' }), null, NOW)
    expect(edge.deadlineUrgent).toBe(true)

    // 1 小时前 → 已过期，且**不再**算临期（两个标记互斥）
    const past = summarizeErrandTask(task({ deadline: '2026-05-01T11:00:00.000Z' }), null, NOW)
    expect(past.deadlinePassed).toBe(true)
    expect(past.deadlineUrgent).toBe(false)

    // 残缺时间不抛错，也不误判成紧急
    const broken = summarizeErrandTask(task({ deadline: 'not-a-date' }), null, NOW)
    expect(broken.deadlineUrgent).toBe(false)
    expect(broken.deadlinePassed).toBe(false)
  })

  it('「我发布的 / 我接的单」标记依赖当前用户', () => {
    const open = task()
    expect(summarizeErrandTask(open, REQUESTER, NOW).mine).toBe(true)
    expect(summarizeErrandTask(open, REQUESTER, NOW).takenByMe).toBe(false)

    const accepted = task({ status: 'accepted', runnerId: RUNNER })
    expect(summarizeErrandTask(accepted, RUNNER, NOW).takenByMe).toBe(true)
    expect(summarizeErrandTask(accepted, RUNNER, NOW).hasRunner).toBe(true)
    expect(summarizeErrandTask(accepted, null, NOW).mine).toBe(false)
  })

  it('formatMoment 对空值 / 非法值给出占位符', () => {
    expect(formatMoment(null)).toBe('—')
    expect(formatMoment('not-a-date')).toBe('—')
    expect(formatMoment('2026-05-01T00:00:00.000Z')).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('跑腿：动作权限（服务端仍是最终裁决，这里只是提前藏按钮）', () => {
  it('未登录时没有任何动作', () => {
    expect(availableErrandActions(task(), null)).toEqual([])
    expect(canAcceptErrand(task(), null).allowed).toBe(false)
    expect(canAcceptErrand(task(), null).message).toContain('登录')
  })

  it('发布者：未结束可改 / 删 / 取消；已送达可确认完成；终态无可执行动作', () => {
    expect(availableErrandActions(task(), REQUESTER)).toEqual(['cancel', 'edit', 'delete'])
    expect(
      availableErrandActions(task({ status: 'accepted', runnerId: RUNNER }), REQUESTER),
    ).toEqual(['cancel', 'edit', 'delete'])
    expect(
      availableErrandActions(task({ status: 'delivered', runnerId: RUNNER }), REQUESTER),
    ).toEqual(['complete', 'edit', 'delete'])
    expect(availableErrandActions(task({ status: 'completed' }), REQUESTER)).toEqual([])
    expect(availableErrandActions(task({ status: 'cancelled' }), REQUESTER)).toEqual([])
  })

  it('接单者：只有「已接单」能确认送达', () => {
    const accepted = task({ status: 'accepted', runnerId: RUNNER })
    expect(availableErrandActions(accepted, RUNNER)).toEqual(['deliver'])
    expect(availableErrandActions({ ...accepted, status: 'delivered' }, RUNNER)).toEqual([])
    expect(availableErrandActions({ ...accepted, status: 'completed' }, RUNNER)).toEqual([])
  })

  it('路人：只有待接单可以接，且不能接自己的单', () => {
    expect(availableErrandActions(task(), STRANGER)).toEqual(['accept'])
    expect(availableErrandActions(task({ status: 'accepted', runnerId: RUNNER }), STRANGER)).toEqual(
      [],
    )
    expect(canAcceptErrand(task(), REQUESTER).message).toContain('自己')
  })

  it('canAccept 给出与后端一致的拒绝原因', () => {
    expect(canAcceptErrand(task(), STRANGER).allowed).toBe(true)

    const taken = task({ status: 'accepted', runnerId: RUNNER })
    expect(canAcceptErrand(taken, STRANGER).message).toContain('已被接单')
    expect(canAcceptErrand(taken, RUNNER).message).toContain('已经接过')
  })
})

describe('跑腿 Mock 仓储：筛选与排序', () => {
  const seed: ErrandTask[] = [
    task({
      id: 'a',
      title: '取快递',
      detail: '菜鸟驿站 1 号柜',
      rewardFen: 500,
      fromPlace: '菜鸟驿站',
      toPlace: '3 号楼楼下',
      deadline: '2026-05-01T20:00:00.000Z',
      createdAt: '2026-05-01T09:00:00.000Z',
      status: 'open',
    }),
    task({
      id: 'b',
      title: '带午饭',
      detail: '二食堂',
      rewardFen: 2_000,
      fromPlace: '二食堂',
      toPlace: '5 号楼 412',
      deadline: '2026-05-01T14:00:00.000Z',
      createdAt: '2026-05-01T10:00:00.000Z',
      status: 'open',
    }),
    task({
      id: 'c',
      title: '还书',
      detail: null,
      rewardFen: 800,
      fromPlace: '图书馆',
      toPlace: '图书馆一楼',
      deadline: '2026-05-01T23:00:00.000Z',
      createdAt: '2026-05-01T11:00:00.000Z',
      status: 'completed',
    }),
  ]

  it('关键词同时匹配标题与明细', async () => {
    const r = repo(STRANGER, seed)
    const byTitle = await r.list({ cursor: null, filters: { keyword: '午饭' } })
    if (byTitle.ok) expect(byTitle.value.items.map((i) => i.id)).toEqual(['b'])

    const byDetail = await r.list({ cursor: null, filters: { keyword: '菜鸟' } })
    if (byDetail.ok) expect(byDetail.value.items.map((i) => i.id)).toEqual(['a'])
  })

  it('状态 / 出发地 / 目的地筛选可以叠加', async () => {
    const r = repo(STRANGER, seed)
    const done = await r.list({ cursor: null, filters: { status: 'completed' } })
    if (done.ok) expect(done.value.items.map((i) => i.id)).toEqual(['c'])

    const place = await r.list({ cursor: null, filters: { fromPlace: '菜鸟驿站' } })
    if (place.ok) expect(place.value.items.map((i) => i.id)).toEqual(['a'])

    const none = await r.list({ cursor: null, filters: { fromPlace: '不存在的地方' } })
    if (none.ok) expect(none.value.items).toHaveLength(0)
  })

  it('三种排序：最新 / 悬赏最高 / 最紧急', async () => {
    const r = repo(STRANGER, seed)
    const latest = await r.list({ cursor: null, filters: { sort: 'latest' } })
    if (latest.ok) expect(latest.value.items.map((i) => i.id)).toEqual(['c', 'b', 'a'])

    const reward = await r.list({ cursor: null, filters: { sort: 'reward-desc' } })
    if (reward.ok) expect(reward.value.items.map((i) => i.id)).toEqual(['b', 'c', 'a'])

    const deadline = await r.list({ cursor: null, filters: { sort: 'deadline' } })
    if (deadline.ok) expect(deadline.value.items.map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })

  it('游标分页只返回下一页，并给出正确的 nextCursor', async () => {
    const r = repo(STRANGER, seed)
    const first = await r.list({ cursor: null, limit: 2, filters: { sort: 'reward-desc' } })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.items.map((i) => i.id)).toEqual(['b', 'c'])
    expect(first.value.nextCursor).toBe('c')

    const second = await r.list({ cursor: 'c', limit: 2, filters: { sort: 'reward-desc' } })
    if (second.ok) {
      expect(second.value.items.map((i) => i.id)).toEqual(['a'])
      expect(second.value.nextCursor).toBeNull()
    }
  })

  it('scope=requester / runner 只看自己，且未登录直接 UNAUTHENTICATED', async () => {
    const mine = repo(REQUESTER, seed)
    // 默认排序是「最新发布」（createdAt 倒序），所以是 c → b → a
    const requester = await mine.list({ cursor: null, filters: { scope: 'requester' } })
    if (requester.ok) expect(requester.value.items.map((i) => i.id)).toEqual(['c', 'b', 'a'])

    const runner = await repo(RUNNER, seed).list({ cursor: null, filters: { scope: 'runner' } })
    if (runner.ok) expect(runner.value.items).toHaveLength(0)

    const anonymous = await repo(null, seed).list({ cursor: null, filters: { scope: 'requester' } })
    expect(anonymous.ok).toBe(false)
    if (!anonymous.ok) expect(anonymous.error.code).toBe('UNAUTHENTICATED')
  })
})

describe('跑腿 Mock 仓储：发布与校验（与服务端同一套规则）', () => {
  const draft = {
    title: '帮忙带咖啡',
    rewardFen: 800,
    fromPlace: '二食堂',
    toPlace: '图书馆',
    deadline: '2026-05-01T18:00:00.000Z',
  }

  it('未登录不能发布', async () => {
    const result = await repo(null, []).create(draft)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
  })

  it('悬赏必须是以分为单位的整数，且不超上限', async () => {
    const nonInteger = await repo(REQUESTER, []).create({ ...draft, rewardFen: 1.5 })
    expect(nonInteger.ok).toBe(false)

    const tooBig = await repo(REQUESTER, []).create({ ...draft, rewardFen: 100_001 })
    expect(tooBig.ok).toBe(false)
    if (!tooBig.ok) expect(tooBig.error.message).toContain('上限')

    const zero = await repo(REQUESTER, []).create({ ...draft, rewardFen: 0 })
    expect(zero.ok).toBe(true)
  })

  it('截止时间必须晚于当前时间', async () => {
    const past = await repo(REQUESTER, []).create({
      ...draft,
      deadline: '2026-05-01T11:00:00.000Z',
    })
    expect(past.ok).toBe(false)
    if (!past.ok) expect(past.error.message).toContain('晚于当前时间')
  })

  it('标题 / 地点为空或过长都会被拒绝', async () => {
    const emptyTitle = await repo(REQUESTER, []).create({ ...draft, title: '   ' })
    expect(emptyTitle.ok).toBe(false)

    const longTitle = await repo(REQUESTER, []).create({ ...draft, title: 'x'.repeat(61) })
    expect(longTitle.ok).toBe(false)

    const emptyPlace = await repo(REQUESTER, []).create({ ...draft, fromPlace: '' })
    expect(emptyPlace.ok).toBe(false)
    if (!emptyPlace.ok) expect(emptyPlace.error.message).toContain('出发地')
  })

  it('发布者永远是当前登录用户，且数据真的落在 CachePort 里（换了仓储实例还在）', async () => {
    const cache = createMemoryStorage()
    const first = createMockErrandRepository({
      cache,
      viewerId: () => REQUESTER,
      latencyMs: 0,
      now: () => NOW,
      seed: [],
    })
    const created = await first.create({ ...draft, detail: '  微辣  ' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.requesterId).toBe(REQUESTER)
    expect(created.value.status).toBe('open')
    expect(created.value.detail).toBe('微辣')

    // 模拟「刷新页面」：同一个 cache，新的仓储实例
    const second = createMockErrandRepository({
      cache,
      viewerId: () => REQUESTER,
      latencyMs: 0,
      now: () => NOW,
    })
    const listed = await second.list({ cursor: null, filters: {} })
    if (listed.ok) {
      expect(listed.value.items.map((i) => i.id)).toContain(created.value.id)
    }
  })
})

describe('跑腿 Mock 仓储：状态机与归属', () => {
  it('不存在统一返回 NOT_FOUND', async () => {
    const r = repo(REQUESTER, [])
    for (const result of [
      await r.detail('ghost'),
      await r.accept('ghost'),
      await r.deliver('ghost'),
      await r.complete('ghost'),
      await r.cancel('ghost'),
      await r.remove('ghost'),
    ]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
    }
  })

  it('接单：不能接自己的单；重复接单 / 已结束都是 CONFLICT', async () => {
    const self = await repo(REQUESTER, [task()]).accept('t1')
    expect(self.ok).toBe(false)
    if (!self.ok) expect(self.error.code).toBe('VALIDATION_FAILED')

    const r = repo(RUNNER, [task()])
    const accepted = await r.accept('t1')
    expect(accepted.ok).toBe(true)
    if (accepted.ok) {
      expect(accepted.value.status).toBe('accepted')
      expect(accepted.value.runnerId).toBe(RUNNER)
      expect(accepted.value.acceptedAt).toBe(NOW.toISOString())
    }

    const again = await r.accept('t1')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.message).toContain('已经接过')

    const other = await repo(STRANGER, [task({ status: 'accepted', runnerId: RUNNER })]).accept('t1')
    expect(other.ok).toBe(false)
    if (!other.ok) expect(other.error.code).toBe('CONFLICT')
  })

  it('未登录不能接单 / 送达', async () => {
    const r = repo(null, [task()])
    const accepted = await r.accept('t1')
    expect(accepted.ok).toBe(false)
    if (!accepted.ok) expect(accepted.error.code).toBe('UNAUTHENTICATED')

    const delivered = await r.deliver('t1')
    expect(delivered.ok).toBe(false)
    if (!delivered.ok) expect(delivered.error.code).toBe('UNAUTHENTICATED')
  })

  it('送达：只有接单者本人、且状态为 accepted', async () => {
    const wrongActor = await repo(STRANGER, [task({ status: 'accepted', runnerId: RUNNER })]).deliver('t1')
    expect(wrongActor.ok).toBe(false)
    if (!wrongActor.ok) expect(wrongActor.error.code).toBe('FORBIDDEN')

    const wrongStatus = await repo(RUNNER, [task({ status: 'open', runnerId: RUNNER })]).deliver('t1')
    expect(wrongStatus.ok).toBe(false)
    if (!wrongStatus.ok) expect(wrongStatus.error.message).toContain('已接单')

    const r = repo(RUNNER, [task({ status: 'accepted', runnerId: RUNNER })])
    const delivered = await r.deliver('t1')
    expect(delivered.ok).toBe(true)
    if (delivered.ok) {
      expect(delivered.value.status).toBe('delivered')
      expect(delivered.value.deliveredAt).toBe(NOW.toISOString())
    }
  })

  it('确认完成：只有发布者、且状态必须是 delivered', async () => {
    const notOwner = await repo(RUNNER, [task({ status: 'delivered', runnerId: RUNNER })]).complete('t1')
    expect(notOwner.ok).toBe(false)
    if (!notOwner.ok) expect(notOwner.error.code).toBe('FORBIDDEN')

    const wrongStatus = await repo(REQUESTER, [task({ status: 'accepted', runnerId: RUNNER })]).complete('t1')
    expect(wrongStatus.ok).toBe(false)
    if (!wrongStatus.ok) expect(wrongStatus.error.message).toContain('已送达')

    const r = repo(REQUESTER, [task({ status: 'delivered', runnerId: RUNNER })])
    const completed = await r.complete('t1')
    expect(completed.ok).toBe(true)
    if (completed.ok) {
      expect(completed.value.status).toBe('completed')
      expect(completed.value.settledAt).toBe(NOW.toISOString())
    }
  })

  it('取消：只有发布者；open / accepted 可取消；终态 CONFLICT', async () => {
    const notOwner = await repo(RUNNER, [task()]).cancel('t1')
    expect(notOwner.ok).toBe(false)
    if (!notOwner.ok) expect(notOwner.error.code).toBe('FORBIDDEN')

    const open = repo(REQUESTER, [task()])
    const cancelled = await open.cancel('t1')
    expect(cancelled.ok).toBe(true)
    if (cancelled.ok) expect(cancelled.value.status).toBe('cancelled')

    const accepted = await repo(REQUESTER, [task({ status: 'accepted', runnerId: RUNNER })]).cancel('t1')
    expect(accepted.ok).toBe(true)

    const completed = await repo(REQUESTER, [task({ status: 'completed' })]).cancel('t1')
    expect(completed.ok).toBe(false)
    if (!completed.ok) expect(completed.error.code).toBe('CONFLICT')
  })

  it('修改 / 删除：只有发布者；终态锁定', async () => {
    const asRunner = await repo(RUNNER, [task()]).update('t1', { title: '改标题' })
    expect(asRunner.ok).toBe(false)
    if (!asRunner.ok) expect(asRunner.error.code).toBe('FORBIDDEN')

    const owner = repo(REQUESTER, [task()])
    const updated = await owner.update('t1', { title: '  改标题  ', rewardFen: 900 })
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.value.title).toBe('改标题')
      expect(updated.value.rewardFen).toBe(900)
    }

    const invalid = await owner.update('t1', { rewardFen: -1 })
    expect(invalid.ok).toBe(false)

    const locked = await repo(REQUESTER, [task({ status: 'completed' })]).update('t1', {
      title: 'x',
    })
    expect(locked.ok).toBe(false)
    if (!locked.ok) expect(locked.error.code).toBe('CONFLICT')

    const removeLocked = await repo(REQUESTER, [task({ status: 'cancelled' })]).remove('t1')
    expect(removeLocked.ok).toBe(false)

    const removed = await repo(REQUESTER, [task()]).remove('t1')
    expect(removed.ok).toBe(true)
  })
})

describe('跑腿 Mock 仓储：演示开关', () => {
  it('failNextRequests 只影响接下来 N 次请求', async () => {
    const r = repo(REQUESTER, [task()])
    r.failNextRequests(1)
    const failed = await r.list({ cursor: null, filters: {} })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    const healthy = await r.list({ cursor: null, filters: {} })
    expect(healthy.ok).toBe(true)
  })

  it('clearAll 得到真的空列表；reset 重新灌入种子数据', async () => {
    const r = repo(REQUESTER, [task()])
    r.clearAll()
    const empty = await r.list({ cursor: null, filters: {} })
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.value.items).toHaveLength(0)

    r.reset()
    const restored = await r.list({ cursor: null, filters: {} })
    expect(restored.ok).toBe(true)
    if (restored.ok) expect(restored.value.items).toHaveLength(1)
  })
})
