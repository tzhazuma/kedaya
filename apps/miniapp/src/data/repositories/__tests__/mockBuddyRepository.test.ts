import { describe, expect, it } from 'vitest'

import {
  availableBuddyActions,
  buddyActivityLabel,
  buddyCapacityLabel,
  buddyRoleLabel,
  buddySortLabel,
  buddyStatusLabel,
  buddyViewerRole,
  canJoinBuddy,
  countMembers,
  findViewerMembership,
  formatMoment,
  isBuddyActivity,
  isBuddyStatus,
  summarizeBuddyGroup,
} from '../../../domain/models/buddy'
import type {
  BuddyGroup,
  BuddyGroupDetail,
  BuddyMemberRow,
  BuddyMemberView,
} from '../../../domain/models/buddy'
import { createMemoryStorage } from '../../storage/memoryStorage'
import { createMockBuddyRepository } from '../mockBuddyRepository'
import type { MockBuddySeed } from '../mockBuddyRepository'

/**
 * 找搭子「领域规则 + Mock 仓储」的可执行规格。
 *
 * 与跳蚤 / 跑腿同样的理由：Mock 仓储的价值在于**规则一致**——归属校验、
 * 成员关系、状态机（含「满了自动 full / 有人退回落 recruiting」）、筛选排序
 * 都要和后端 `buddy.service.ts` 一样。所以这里既测纯函数，也测 mock 真的
 * 执行了同样的规则，而不是「看起来像」。
 */

const NOW = new Date('2026-05-01T12:00:00.000Z')
const OWNER = 'user-owner'
const MEMBER = 'user-member'
const STRANGER = 'user-stranger'

const LATER = '2026-05-01T18:00:00.000Z'

function group(overrides: Partial<BuddyGroup> = {}): BuddyGroup {
  return {
    id: 'g1',
    ownerId: OWNER,
    activity: 'study',
    title: '一起自习',
    description: '图书馆 4 楼安静区',
    campusSpot: '图书馆一楼闸机',
    startsAt: LATER,
    capacity: 4,
    status: 'recruiting',
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    ...overrides,
  }
}

function memberView(userId: string, role = 'member'): BuddyMemberView {
  return {
    userId,
    role,
    joinedAt: '2026-05-01T10:00:00.000Z',
    displayName: userId,
    avatarUrl: null,
  }
}

function memberRow(
  groupId: string,
  userId: string,
  role = 'member',
  joinedAt = '2026-05-01T10:00:00.000Z',
): BuddyMemberRow {
  return {
    id: `bm-${groupId}-${userId}`,
    groupId,
    userId,
    role,
    joinedAt,
  }
}

/** 详情视图：默认只有组长一人 */
function detail(overrides: Partial<BuddyGroupDetail> = {}): BuddyGroupDetail {
  return {
    ...group(),
    members: [memberView(OWNER, 'owner')],
    ...overrides,
  }
}

function repo(
  viewer: string | null,
  seed: MockBuddySeed = { groups: [group()], members: [memberRow('g1', OWNER, 'owner')] },
) {
  return createMockBuddyRepository({
    cache: createMemoryStorage(),
    viewerId: () => viewer,
    latencyMs: 0,
    now: () => NOW,
    seed,
  })
}

describe('找搭子：标签与派生视图', () => {
  it('未知活动 / 状态 / 角色 / 排序都降级为可读文案，而不是抛错', () => {
    expect(isBuddyActivity('nope')).toBe(false)
    expect(buddyActivityLabel('nope')).toBe('其它')
    expect(buddyActivityLabel('study')).toBe('自习')
    expect(isBuddyStatus('nope')).toBe(false)
    expect(buddyStatusLabel('nope')).toBe('未知状态')
    expect(buddyStatusLabel('full')).toBe('已满员')
    expect(buddyRoleLabel('nope')).toBe('成员')
    expect(buddySortLabel('nope')).toBe('最新发布')
  })

  it('卡片派生视图：活动标签、名额、开始时间与「我发起的」', () => {
    const summary = summarizeBuddyGroup(group({ capacity: 4 }), OWNER, NOW)
    expect(summary.badge).toBe('自习')
    expect(summary.activityLabel).toBe('自习')
    expect(buddyCapacityLabel(4)).toBe('共 4 个名额')
    expect(summary.capacityLabel).toBe('共 4 个名额')
    expect(summary.startsLabel).toBe('6 小时后开始')
    expect(summary.mine).toBe(true)
    expect(summarizeBuddyGroup(group(), STRANGER, NOW).mine).toBe(false)
    expect(summarizeBuddyGroup(group(), null, NOW).mine).toBe(false)
  })

  it('成员工具：找身份与计数（组长也占一个名额）', () => {
    const view = detail({
      members: [memberView(OWNER, 'owner'), memberView(MEMBER)],
    })
    expect(countMembers(view.members)).toBe(2)
    expect(findViewerMembership(view.members, MEMBER)?.role).toBe('member')
    expect(findViewerMembership(view.members, STRANGER)).toBeNull()
    expect(findViewerMembership(view.members, null)).toBeNull()
    expect(buddyViewerRole(view, OWNER)).toBe('owner')
    expect(buddyViewerRole(view, MEMBER)).toBe('member')
    expect(buddyViewerRole(view, STRANGER)).toBeNull()
  })

  it('formatMoment 对空值 / 非法值给出占位符', () => {
    expect(formatMoment(null)).toBe('—')
    expect(formatMoment('not-a-date')).toBe('—')
    expect(formatMoment('2026-05-01T00:00:00.000Z')).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('找搭子：动作权限（服务端仍是最终裁决，这里只是提前藏按钮）', () => {
  it('未登录时没有任何动作', () => {
    expect(availableBuddyActions(detail(), null)).toEqual([])
    expect(canJoinBuddy(detail(), null).allowed).toBe(false)
    expect(canJoinBuddy(detail(), null).message).toContain('登录')
  })

  it('组长：招募中可停止 / 取消；满员只能取消；终态无动作', () => {
    expect(availableBuddyActions(detail({ status: 'recruiting' }), OWNER)).toEqual([
      'close',
      'cancel',
    ])
    expect(availableBuddyActions(detail({ status: 'full' }), OWNER)).toEqual(['cancel'])
    expect(availableBuddyActions(detail({ status: 'closed' }), OWNER)).toEqual([])
    expect(availableBuddyActions(detail({ status: 'cancelled' }), OWNER)).toEqual([])
  })

  it('已加入的普通成员只能退出；组长即使不算 ownerId 也按角色识别', () => {
    const withMember = detail({
      members: [memberView(OWNER, 'owner'), memberView(MEMBER)],
    })
    expect(availableBuddyActions(withMember, MEMBER)).toEqual(['leave'])

    // 组长的判定同时看 ownerId 与成员角色，漏了 ownerId 也不会误判成「成员」
    const roleOnlyOwner = detail({
      ownerId: 'someone-else',
      members: [memberView(OWNER, 'owner'), memberView(MEMBER)],
    })
    expect(availableBuddyActions(roleOnlyOwner, OWNER)).toEqual(['close', 'cancel'])
  })

  it('路人：招募中且未满员可加入，满员 / 非招募中无动作', () => {
    expect(availableBuddyActions(detail({ capacity: 4 }), STRANGER)).toEqual(['join'])
    expect(
      availableBuddyActions(
        detail({ capacity: 2, members: [memberView(OWNER, 'owner'), memberView(MEMBER)] }),
        STRANGER,
      ),
    ).toEqual([])
    expect(availableBuddyActions(detail({ status: 'full' }), STRANGER)).toEqual([])
    expect(availableBuddyActions(detail({ status: 'closed' }), STRANGER)).toEqual([])
  })

  it('canJoin 给出与后端一致的拒绝原因', () => {
    expect(canJoinBuddy(detail(), OWNER).message).toContain('自己')
    expect(
      canJoinBuddy(detail({ members: [memberView(OWNER, 'owner'), memberView(MEMBER)] }), MEMBER)
        .message,
    ).toContain('已经加入')
    expect(canJoinBuddy(detail({ status: 'full' }), STRANGER).message).toContain('满员')
    expect(canJoinBuddy(detail({ status: 'closed' }), STRANGER).message).toContain('停止招募')
    expect(
      canJoinBuddy(
        detail({ capacity: 2, members: [memberView(OWNER, 'owner'), memberView(MEMBER)] }),
        STRANGER,
      ).message,
    ).toContain('满员')
    expect(canJoinBuddy(detail(), STRANGER).allowed).toBe(true)
  })
})

describe('找搭子 Mock 仓储：筛选、排序与范围', () => {
  const seed: MockBuddySeed = {
    groups: [
      group({
        id: 'a',
        ownerId: OWNER,
        activity: 'study',
        title: '一起自习',
        description: '图书馆 4 楼',
        startsAt: '2026-05-01T18:00:00.000Z',
        createdAt: '2026-05-01T11:00:00.000Z',
        status: 'recruiting',
      }),
      group({
        id: 'b',
        ownerId: STRANGER,
        activity: 'sport',
        title: '羽毛球 2v2',
        description: '体育馆场地已订',
        startsAt: '2026-05-01T02:00:00.000Z',
        createdAt: '2026-05-01T09:00:00.000Z',
        status: 'recruiting',
      }),
      group({
        id: 'c',
        ownerId: STRANGER,
        activity: 'study',
        title: '考研搭子',
        description: null,
        startsAt: '2026-05-01T14:00:00.000Z',
        createdAt: '2026-05-01T10:00:00.000Z',
        status: 'full',
      }),
    ],
    members: [
      memberRow('a', OWNER, 'owner'),
      memberRow('b', STRANGER, 'owner'),
      memberRow('b', MEMBER),
      memberRow('c', STRANGER, 'owner'),
    ],
  }

  it('关键词同时匹配标题与简介', async () => {
    const r = repo(STRANGER, seed)
    const byTitle = await r.list({ cursor: null, filters: { keyword: '自习' } })
    if (byTitle.ok) expect(byTitle.value.items.map((i) => i.id)).toEqual(['a'])

    const byDescription = await r.list({ cursor: null, filters: { keyword: '体育馆' } })
    if (byDescription.ok) expect(byDescription.value.items.map((i) => i.id)).toEqual(['b'])
  })

  it('活动 / 状态筛选可以叠加', async () => {
    const r = repo(STRANGER, seed)
    const study = await r.list({ cursor: null, filters: { activity: 'study' } })
    if (study.ok) expect(study.value.items.map((i) => i.id)).toEqual(['a', 'c'])

    const full = await r.list({ cursor: null, filters: { status: 'full' } })
    if (full.ok) expect(full.value.items.map((i) => i.id)).toEqual(['c'])

    const stacked = await r.list({
      cursor: null,
      filters: { activity: 'study', status: 'recruiting' },
    })
    if (stacked.ok) expect(stacked.value.items.map((i) => i.id)).toEqual(['a'])
  })

  it('scope=mine / joined 只看自己，且都要登录', async () => {
    const mine = await repo(OWNER, seed).list({ cursor: null, filters: { scope: 'mine' } })
    if (mine.ok) expect(mine.value.items.map((i) => i.id)).toEqual(['a'])

    const joined = await repo(MEMBER, seed).list({ cursor: null, filters: { scope: 'joined' } })
    if (joined.ok) expect(joined.value.items.map((i) => i.id)).toEqual(['b'])

    for (const scope of ['mine', 'joined'] as const) {
      const anonymous = await repo(null, seed).list({ cursor: null, filters: { scope } })
      expect(anonymous.ok).toBe(false)
      if (!anonymous.ok) expect(anonymous.error.code).toBe('UNAUTHENTICATED')
    }
  })

  it('onlyUpcoming 过滤掉已经开始的活动', async () => {
    const r = repo(STRANGER, seed)
    const upcoming = await r.list({ cursor: null, filters: { onlyUpcoming: true } })
    // b 已经开始（02:00）被过滤，剩下按最新发布排：a(11:00) → c(10:00)
    if (upcoming.ok) expect(upcoming.value.items.map((i) => i.id)).toEqual(['a', 'c'])
  })

  it('两种排序：最新按发布倒序，即将开始按开始时间正序', async () => {
    const r = repo(STRANGER, seed)
    const latest = await r.list({ cursor: null, filters: { sort: 'latest' } })
    if (latest.ok) expect(latest.value.items.map((i) => i.id)).toEqual(['a', 'c', 'b'])

    const soon = await r.list({ cursor: null, filters: { sort: 'soon' } })
    if (soon.ok) expect(soon.value.items.map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('游标分页只返回下一页，并给出正确的 nextCursor', async () => {
    const r = repo(STRANGER, seed)
    const first = await r.list({ cursor: null, limit: 2, filters: { sort: 'latest' } })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.items.map((i) => i.id)).toEqual(['a', 'c'])
    expect(first.value.nextCursor).toBe('c')

    const second = await r.list({ cursor: 'c', limit: 2, filters: { sort: 'latest' } })
    if (second.ok) {
      expect(second.value.items.map((i) => i.id)).toEqual(['b'])
      expect(second.value.nextCursor).toBeNull()
    }
  })
})

describe('找搭子 Mock 仓储：发起与校验（与服务端同一套规则）', () => {
  const draft = {
    activity: 'study',
    title: '一起自习',
    campusSpot: '图书馆一楼',
    startsAt: '2026-05-01T18:00:00.000Z',
    capacity: 4,
  }

  it('未登录不能发起', async () => {
    const result = await repo(null, { groups: [], members: [] }).create(draft)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
  })

  it('活动类型必须在白名单内', async () => {
    const result = await repo(OWNER, { groups: [], members: [] }).create({
      ...draft,
      activity: 'nope',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
  })

  it('标题 / 地点为空或过长都会被拒绝', async () => {
    const r = () => repo(OWNER, { groups: [], members: [] })
    expect((await r().create({ ...draft, title: '   ' })).ok).toBe(false)
    expect((await r().create({ ...draft, title: 'x'.repeat(61) })).ok).toBe(false)

    const emptySpot = await r().create({ ...draft, campusSpot: '' })
    expect(emptySpot.ok).toBe(false)
    if (!emptySpot.ok) expect(emptySpot.error.message).toContain('集合地点')
  })

  it('容量必须是 2~50 的整数', async () => {
    const r = () => repo(OWNER, { groups: [], members: [] })
    expect((await r().create({ ...draft, capacity: 1 })).ok).toBe(false)
    expect((await r().create({ ...draft, capacity: 51 })).ok).toBe(false)
    expect((await r().create({ ...draft, capacity: 2.5 })).ok).toBe(false)

    const lower = await r().create({ ...draft, capacity: 2 })
    expect(lower.ok).toBe(true)
    const upper = await r().create({ ...draft, capacity: 50 })
    expect(upper.ok).toBe(true)
  })

  it('开始时间必须晚于当前时间', async () => {
    const past = await repo(OWNER, { groups: [], members: [] }).create({
      ...draft,
      startsAt: '2026-05-01T11:00:00.000Z',
    })
    expect(past.ok).toBe(false)
    if (!past.ok) expect(past.error.message).toContain('晚于当前时间')
  })

  it('发起者永远是当前登录用户，并同步成为组长成员', async () => {
    const r = repo(OWNER, { groups: [], members: [] })
    const created = await r.create({ ...draft, description: '  安静一点  ' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.ownerId).toBe(OWNER)
    expect(created.value.status).toBe('recruiting')
    expect(created.value.description).toBe('安静一点')

    const view = await r.detail(created.value.id)
    expect(view.ok).toBe(true)
    if (!view.ok) return
    const owner = findViewerMembership(view.value.members, OWNER)
    expect(owner?.role).toBe('owner')
  })

  it('数据真的落在 CachePort 里（换了仓储实例还在）', async () => {
    const cache = createMemoryStorage()
    const first = createMockBuddyRepository({
      cache,
      viewerId: () => OWNER,
      latencyMs: 0,
      now: () => NOW,
      seed: { groups: [], members: [] },
    })
    const created = await first.create(draft)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // 模拟「刷新页面」：同一个 cache，新的仓储实例
    const second = createMockBuddyRepository({
      cache,
      viewerId: () => OWNER,
      latencyMs: 0,
      now: () => NOW,
    })
    const listed = await second.list({ cursor: null, filters: {} })
    if (listed.ok) expect(listed.value.items.map((i) => i.id)).toContain(created.value.id)
  })
})

describe('找搭子 Mock 仓储：成员关系与状态机', () => {
  it('不存在统一返回 NOT_FOUND', async () => {
    const r = repo(OWNER, { groups: [], members: [] })
    for (const result of [
      await r.detail('ghost'),
      await r.join('ghost'),
      await r.leave('ghost'),
      await r.close('ghost'),
      await r.cancel('ghost'),
    ]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
    }
  })

  it('未登录不能加入 / 退出 / 停止 / 取消', async () => {
    const r = repo(null)
    for (const result of [
      await r.join('g1'),
      await r.leave('g1'),
      await r.close('g1'),
      await r.cancel('g1'),
    ]) {
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    }
  })

  it('加入：不能加入自己发起的；重复加入是 CONFLICT', async () => {
    const self = await repo(OWNER).join('g1')
    expect(self.ok).toBe(false)
    if (!self.ok) expect(self.error.code).toBe('VALIDATION_FAILED')

    const already = await repo(STRANGER, {
      groups: [group()],
      members: [memberRow('g1', OWNER, 'owner'), memberRow('g1', STRANGER)],
    }).join('g1')
    expect(already.ok).toBe(false)
    if (!already.ok) {
      expect(already.error.code).toBe('CONFLICT')
      expect(already.error.message).toContain('已经加入')
    }
  })

  it('加入：非招募中或已满员都是 CONFLICT', async () => {
    const full = await repo(STRANGER, {
      groups: [group({ status: 'full' })],
      members: [memberRow('g1', OWNER, 'owner')],
    }).join('g1')
    expect(full.ok).toBe(false)
    if (!full.ok) expect(full.error.message).toContain('满员')

    const closed = await repo(STRANGER, {
      groups: [group({ status: 'closed' })],
      members: [memberRow('g1', OWNER, 'owner')],
    }).join('g1')
    expect(closed.ok).toBe(false)
    if (!closed.ok) expect(closed.error.message).toContain('停止招募')

    // 状态还是 recruiting，但人数已经到容量（不一致数据）也要拦住
    const inconsistent = await repo(STRANGER, {
      groups: [group({ capacity: 2 })],
      members: [memberRow('g1', OWNER, 'owner'), memberRow('g1', MEMBER)],
    }).join('g1')
    expect(inconsistent.ok).toBe(false)
    if (!inconsistent.ok) expect(inconsistent.error.code).toBe('CONFLICT')
  })

  it('加入成功；人数刚好到容量时自动推进为 full', async () => {
    const r = repo(STRANGER, {
      groups: [group({ capacity: 3 })],
      members: [memberRow('g1', OWNER, 'owner'), memberRow('g1', MEMBER)],
    })
    const joined = await r.join('g1')
    expect(joined.ok).toBe(true)
    if (joined.ok) expect(joined.value.status).toBe('full')

    const view = await r.detail('g1')
    if (view.ok) {
      expect(view.value.members.map((m) => m.userId)).toContain(STRANGER)
      expect(view.value.status).toBe('full')
    }
  })

  it('加入未满员时状态保持 recruiting，成员真的写进去了', async () => {
    const r = repo(STRANGER, {
      groups: [group({ capacity: 4 })],
      members: [memberRow('g1', OWNER, 'owner', '2026-05-01T09:00:00.000Z')],
    })
    const joined = await r.join('g1')
    expect(joined.ok).toBe(true)
    if (joined.ok) expect(joined.value.status).toBe('recruiting')

    const view = await r.detail('g1')
    if (view.ok) expect(view.value.members.map((m) => m.userId)).toEqual([OWNER, STRANGER])
  })

  it('退出：组长不能退出（要改用取消），非成员报 VALIDATION_FAILED', async () => {
    const owner = await repo(OWNER).leave('g1')
    expect(owner.ok).toBe(false)
    if (!owner.ok) {
      expect(owner.error.code).toBe('CONFLICT')
      expect(owner.error.message).toContain('取消招募')
    }

    const stranger = await repo(STRANGER).leave('g1')
    expect(stranger.ok).toBe(false)
    if (!stranger.ok) expect(stranger.error.code).toBe('VALIDATION_FAILED')
  })

  it('退出：满员的人退出后腾出名额，重新回到 recruiting', async () => {
    const r = repo(STRANGER, {
      groups: [group({ status: 'full', capacity: 3 })],
      members: [
        memberRow('g1', OWNER, 'owner', '2026-05-01T09:00:00.000Z'),
        memberRow('g1', MEMBER, 'member', '2026-05-01T09:30:00.000Z'),
        memberRow('g1', STRANGER, 'member', '2026-05-01T10:00:00.000Z'),
      ],
    })
    const left = await r.leave('g1')
    expect(left.ok).toBe(true)
    if (left.ok) expect(left.value.status).toBe('recruiting')

    const view = await r.detail('g1')
    if (view.ok) expect(view.value.members.map((m) => m.userId)).toEqual([OWNER, MEMBER])
  })

  it('停止招募：只有组长，且只有招募中可以停', async () => {
    const notOwner = await repo(STRANGER).close('g1')
    expect(notOwner.ok).toBe(false)
    if (!notOwner.ok) expect(notOwner.error.code).toBe('FORBIDDEN')

    const notRecruiting = await repo(OWNER, {
      groups: [group({ status: 'full' })],
      members: [memberRow('g1', OWNER, 'owner')],
    }).close('g1')
    expect(notRecruiting.ok).toBe(false)
    if (!notRecruiting.ok) expect(notRecruiting.error.code).toBe('CONFLICT')

    const closed = await repo(OWNER).close('g1')
    expect(closed.ok).toBe(true)
    if (closed.ok) expect(closed.value.status).toBe('closed')
  })

  it('取消招募：只有组长；closed / cancelled 是终态', async () => {
    const notOwner = await repo(STRANGER).cancel('g1')
    expect(notOwner.ok).toBe(false)
    if (!notOwner.ok) expect(notOwner.error.code).toBe('FORBIDDEN')

    const recruiting = await repo(OWNER).cancel('g1')
    expect(recruiting.ok).toBe(true)
    if (recruiting.ok) expect(recruiting.value.status).toBe('cancelled')

    const full = await repo(OWNER, {
      groups: [group({ status: 'full' })],
      members: [memberRow('g1', OWNER, 'owner')],
    }).cancel('g1')
    expect(full.ok).toBe(true)
    if (full.ok) expect(full.value.status).toBe('cancelled')

    for (const status of ['closed', 'cancelled'] as const) {
      const done = await repo(OWNER, {
        groups: [group({ status })],
        members: [memberRow('g1', OWNER, 'owner')],
      }).cancel('g1')
      expect(done.ok).toBe(false)
      if (!done.ok) expect(done.error.code).toBe('CONFLICT')
    }
  })
})

describe('找搭子 Mock 仓储：演示开关', () => {
  it('failNextRequests 只影响接下来 N 次请求', async () => {
    const r = repo(OWNER)
    r.failNextRequests(1)
    const failed = await r.list({ cursor: null, filters: {} })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    const healthy = await r.list({ cursor: null, filters: {} })
    expect(healthy.ok).toBe(true)
  })

  it('clearAll 得到真的空列表；reset 重新灌入种子数据', async () => {
    const r = repo(OWNER)
    r.clearAll()
    const empty = await r.list({ cursor: null, filters: {} })
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.value.items).toHaveLength(0)

    r.reset()
    const restored = await r.detail('g1')
    expect(restored.ok).toBe(true)
    if (restored.ok) expect(restored.value.members).toHaveLength(1)
  })
})
