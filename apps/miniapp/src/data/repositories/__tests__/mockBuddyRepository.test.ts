import { beforeEach, describe, expect, it } from 'vitest'

import { createMockBuddyRepository } from '../mockBuddyRepository'
import type { MockBuddyRepository } from '../mockBuddyRepository'
import type { BuddyViewer } from '../../mock/buddyMemoryDatabase'
import { MOCK_NOW_ISO } from '../../mock/fixtures'
import { BUDDY_TAGS } from '../../../domain/models/buddy'
import type { CreateBuddyPostInput } from '../../../domain/ports/buddyRepository'

/**
 * Mock 找搭子仓储测试。
 *
 * 覆盖：游标分页（契约 §6.1）、幂等（§11.3）、动作语义（§11.2）、
 * 硬过滤与反馈（规格 §3.3 / §3.6）、三态控制面、隐私边界（§6.1）。
 *
 * ⚠️ 反馈的 **section 隔离**（规格 §3.6 / 验收 T6）是这里最关键的断言 ——
 * 跨板块反馈互相污染是这套算法最容易写错的地方。
 */

const ME: BuddyViewer = { id: 'u-me', nickname: '可达鸭测试号' }

function createRepo(viewer: BuddyViewer | null = ME): MockBuddyRepository {
  return createMockBuddyRepository({
    latencyMs: 0,
    now: () => new Date(MOCK_NOW_ISO),
    currentUser: () => viewer,
  })
}

async function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }): Promise<T> {
  if (!result.ok) throw new Error(`期望成功，实际失败：${JSON.stringify(result.error)}`)
  return result.value
}

const DRAFT: CreateBuddyPostInput = {
  activity: 'sport',
  title: '周中夜跑 5km',
  description: '田径场，配速 6 分',
  location: '田径场',
  startsAt: '2026-10-21T11:00:00.000Z', // 北京时间 10-21（周三）19:00
  durationMin: 60,
  capacity: 4,
  genderPreference: 'any',
  tags: ['running'],
  minSkillLevel: null,
}

let repo: MockBuddyRepository

beforeEach(() => {
  repo = createRepo()
})

/* ------------------------------------------------------------------ *
 * 标签表（封闭，规格 §3.2）
 * ------------------------------------------------------------------ */

describe('mockBuddyRepository · 封闭标签表', () => {
  it('只返回 isActive 的标签（下架标签不出现，但仍在表里被引用）', async () => {
    const tags = await unwrap(await repo.listTags())
    expect(tags.length).toBeGreaterThan(20)
    expect(tags.every((tag) => tag.isActive)).toBe(true)
    expect(tags.some((tag) => tag.key === 'dating-night')).toBe(false)
    // 镜像与服务端权威表一致：62 项，全部 active（服务端表当前没有下架条目）
    expect(BUDDY_TAGS).toHaveLength(62)
    expect(BUDDY_TAGS.every((tag) => tag.isActive)).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * 列表：游标分页 + 板块筛选 + 标签筛选
 * ------------------------------------------------------------------ */

describe('mockBuddyRepository · 列表（契约 §6.1 游标分页）', () => {
  it('默认排除已开始的活动（规格 §5.3 `startsAfter` 默认 now）', async () => {
    const page = await unwrap(await repo.listItems({ limit: 100 }))
    expect(page.items.some((item) => item.id === 'bp-1009')).toBe(false)
    for (const item of page.items) {
      expect(new Date(item.startsAt).getTime()).toBeGreaterThan(new Date(MOCK_NOW_ISO).getTime())
    }
  })

  it('按 startsAt 升序返回', async () => {
    const page = await unwrap(await repo.listItems({ limit: 100 }))
    const times = page.items.map((item) => item.startsAt)
    expect([...times].sort()).toEqual(times)
  })

  it('section 筛选按 activity 派生（study→academic / meal→daily / sport→sport）', async () => {
    const academic = await unwrap(await repo.listItems({ section: 'academic', limit: 100 }))
    expect(academic.items.length).toBeGreaterThan(0)
    for (const item of academic.items) {
      expect(['study']).toContain(item.activity)
    }

    const sport = await unwrap(await repo.listItems({ section: 'sport', limit: 100 }))
    for (const item of sport.items) {
      expect(['sport', 'game']).toContain(item.activity)
    }

    const daily = await unwrap(await repo.listItems({ section: 'daily', limit: 100 }))
    for (const item of daily.items) {
      expect(['meal', 'travel', 'other']).toContain(item.activity)
    }
  })

  it('`all` 不过滤板块', async () => {
    const all = await unwrap(await repo.listItems({ section: 'all', limit: 100 }))
    const sport = await unwrap(await repo.listItems({ section: 'sport', limit: 100 }))
    expect(all.items.length).toBeGreaterThan(sport.items.length)
  })

  it('tags 命中任一即返回', async () => {
    const page = await unwrap(await repo.listItems({ tags: ['badminton'], limit: 100 }))
    expect(page.items.length).toBeGreaterThan(0)
    for (const item of page.items) expect(item.tags).toContain('badminton')
  })

  it('limit=1 连续翻页能遍历全部结果且**无重复无跳过**（验收 T20 的同款）', async () => {
    const full = await unwrap(await repo.listItems({ limit: 100 }))
    const seen: string[] = []
    let cursor: string | null = null
    let guard = 0

    do {
      const page: { items: Array<{ id: string }>; nextCursor: string | null } = await unwrap(
        await repo.listItems({ limit: 1, cursor }),
      )
      seen.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor
      guard += 1
      if (guard > 50) throw new Error('翻页未收敛')
    } while (cursor !== null)

    expect(seen).toEqual(full.items.map((item) => item.id))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('列表带出我的申请状态（详情页用；列表页也一致）', async () => {
    const page = await unwrap(await repo.listItems({ limit: 100 }))
    const applied = page.items.find((item) => item.id === 'bp-1002')
    expect(applied?.myApplication?.status).toBe('PENDING')
  })
})

/* ------------------------------------------------------------------ *
 * 详情 + 可见性
 * ------------------------------------------------------------------ */

describe('mockBuddyRepository · 详情', () => {
  it('不存在 → NOT_FOUND', async () => {
    const result = await repo.itemDetail('bp-not-exist')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('详情含完整 description（列表不含）', async () => {
    const detail = await unwrap(await repo.itemDetail('bp-1001'))
    expect(detail.description).not.toBeNull()
    const page = await unwrap(await repo.listItems({ limit: 100 }))
    const inList = page.items.find((item) => item.id === 'bp-1001')
    expect(inList).toBeDefined()
  })
})

/* ------------------------------------------------------------------ *
 * 发布：封闭标签 + 幂等（契约 §11.3）
 * ------------------------------------------------------------------ */

describe('mockBuddyRepository · 发布（规格 §5.4）', () => {
  it('joinedCount 初值为 1（含发起人，契约 §11.10-D）', async () => {
    const created = await unwrap(await repo.createItem(DRAFT, 'k-create-1'))
    expect(created.joinedCount).toBe(1)
    expect(created.capacity).toBe(4)
    expect(created.status).toBe('OPEN')
    expect(created.creator.id).toBe(ME.id)
  })

  it('**自由文本标签被拒**，错误码对齐 UNKNOWN_TAG（规格 §3.2 / §5.4）', async () => {
    const result = await repo.createItem({ ...DRAFT, tags: ['打羽毛球'] }, 'k-create-free')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
      expect(result.error.details).toMatchObject({ reason: 'UNKNOWN_TAG:打羽毛球' })
    }
  })

  it('地点不在白名单 → VALIDATION_FAILED / UNKNOWN_LOCATION', async () => {
    const result = await repo.createItem({ ...DRAFT, location: '不存在的地方' }, 'k-create-loc')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.details).toMatchObject({ reason: 'UNKNOWN_LOCATION' })
  })

  it('缺 Idempotency-Key → VALIDATION_FAILED / IDEMPOTENCY_KEY_REQUIRED（契约 §11.3）', async () => {
    const result = await repo.createItem(DRAFT)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
      expect(result.error.details).toMatchObject({ reason: 'IDEMPOTENCY_KEY_REQUIRED' })
    }
  })

  it('同一 key + 同一 body 重复提交 → 只创建一条，返回**相同** id（验收 T17）', async () => {
    const first = await unwrap(await repo.createItem(DRAFT, 'k-same'))
    const second = await unwrap(await repo.createItem(DRAFT, 'k-same'))
    expect(second.id).toBe(first.id)

    const page = await unwrap(await repo.listItems({ limit: 100 }))
    expect(page.items.filter((item) => item.id === first.id)).toHaveLength(1)
  })

  it('同一 key + 不同 body → CONFLICT / IDEMPOTENCY_KEY_REUSED', async () => {
    await repo.createItem(DRAFT, 'k-reuse')
    const result = await repo.createItem({ ...DRAFT, title: '换了标题' }, 'k-reuse')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT')
      expect(result.error.details).toMatchObject({ reason: 'IDEMPOTENCY_KEY_REUSED' })
    }
  })

  it('未登录 → UNAUTHENTICATED', async () => {
    const anonymous = createRepo(null)
    const result = await anonymous.createItem(DRAFT, 'k-anon')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
  })
})

/* ------------------------------------------------------------------ *
 * join / leave / decide / close（契约 §11.2 的四个动作）
 * ------------------------------------------------------------------ */

describe('mockBuddyRepository · join / leave / decide / close', () => {
  it('join 只建申请、**不占名额**（规格 §5.5 的语义澄清）', async () => {
    const before = await unwrap(await repo.itemDetail('bp-1001'))
    const application = await unwrap(await repo.join('bp-1001', { message: '一起', idempotencyKey: 'k-join-1' }))
    expect(application.status).toBe('PENDING')
    const after = await unwrap(await repo.itemDetail('bp-1001'))
    expect(after.joinedCount).toBe(before.joinedCount)
  })

  it('重复申请 → CONFLICT / already-applied', async () => {
    await repo.join('bp-1001', { idempotencyKey: 'k-join-a' })
    const again = await repo.join('bp-1001', { idempotencyKey: 'k-join-b' })
    expect(again.ok).toBe(false)
    if (!again.ok) {
      expect(again.error.code).toBe('CONFLICT')
      expect(again.error.details).toMatchObject({ reason: 'already-applied' })
    }
  })

  it('申请自己的帖子 → CONFLICT / own-post', async () => {
    const result = await repo.join('bp-1006', { idempotencyKey: 'k-join-own' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.details).toMatchObject({ reason: 'own-post' })
  })

  it('申请已满的帖子 → CONFLICT / full（bp-1007 是 3/3）', async () => {
    const result = await repo.join('bp-1007', { idempotencyKey: 'k-join-full' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.details).toMatchObject({ reason: 'full' })
  })

  it('运动水平不足 → FORBIDDEN / skill-too-low（bp-1012 要求 competitive，我是 regular）', async () => {
    const result = await repo.join('bp-1012', { idempotencyKey: 'k-join-skill' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN')
      expect(result.error.details).toMatchObject({ reason: 'skill-too-low' })
    }
  })

  it('leave → WITHDRAWN，之后可以重新申请并**复用同一行**（规格 §2.8 / 未决 U7）', async () => {
    const joined = await unwrap(await repo.join('bp-1001', { idempotencyKey: 'k-leave-1' }))
    const left = await unwrap(await repo.leave('bp-1001', 'k-leave-2'))
    expect(left.status).toBe('WITHDRAWN')
    expect(left.id).toBe(joined.id)

    const rejoined = await unwrap(await repo.join('bp-1001', { idempotencyKey: 'k-leave-3' }))
    expect(rejoined.status).toBe('PENDING')
    expect(rejoined.id).toBe(joined.id)
  })

  it('decide(ACCEPTED) 才递增 joinedCount（bp-1006 我是发起人，ba-2002 待审批）', async () => {
    const before = await unwrap(await repo.itemDetail('bp-1006'))
    const updated = await unwrap(
      await repo.decide('bp-1006', {
        applicationId: 'ba-2002',
        decision: 'ACCEPTED',
        idempotencyKey: 'k-decide-1',
      }),
    )
    expect(updated.joinedCount).toBe(before.joinedCount + 1)
  })

  it('decide(REJECTED) 不改 joinedCount', async () => {
    const before = await unwrap(await repo.itemDetail('bp-1006'))
    const updated = await unwrap(
      await repo.decide('bp-1006', {
        applicationId: 'ba-2003',
        decision: 'REJECTED',
        idempotencyKey: 'k-decide-2',
      }),
    )
    expect(updated.joinedCount).toBe(before.joinedCount)
  })

  it('重复 decide 同一申请 → CONFLICT（申请已不是 PENDING）', async () => {
    await repo.decide('bp-1006', {
      applicationId: 'ba-2002',
      decision: 'ACCEPTED',
      idempotencyKey: 'k-decide-3',
    })
    const again = await repo.decide('bp-1006', {
      applicationId: 'ba-2002',
      decision: 'REJECTED',
      idempotencyKey: 'k-decide-4',
    })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.code).toBe('CONFLICT')
  })

  it('非发起人 decide / close → FORBIDDEN（验收 T23）', async () => {
    const other = createRepo({ id: 'u-0001', nickname: '张同学' })
    const decide = await other.decide('bp-1006', {
      applicationId: 'ba-2002',
      decision: 'ACCEPTED',
      idempotencyKey: 'k-other-decide',
    })
    expect(decide.ok).toBe(false)
    if (!decide.ok) expect(decide.error.code).toBe('FORBIDDEN')

    const close = await other.close('bp-1006', 'k-other-close')
    expect(close.ok).toBe(false)
    if (!close.ok) expect(close.error.code).toBe('FORBIDDEN')
  })

  it('close → CLOSED（我是发起人的 bp-1006）', async () => {
    const closed = await unwrap(await repo.close('bp-1006', 'k-close-1'))
    expect(closed.status).toBe('CLOSED')
  })

  it('申请列表**仅发起人**可见（规格 §6.1 可见性矩阵）', async () => {
    const mine = await unwrap(await repo.listApplications('bp-1006'))
    expect(mine.items).toHaveLength(2)

    const other = createRepo({ id: 'u-0001', nickname: '张同学' })
    const forbidden = await other.listApplications('bp-1006')
    expect(forbidden.ok).toBe(false)
    if (!forbidden.ok) expect(forbidden.error.code).toBe('FORBIDDEN')
  })
})

/* ------------------------------------------------------------------ *
 * 推荐：硬过滤 + explainMatch 理由 + 反馈（规格 §3.3 / §3.6）
 * ------------------------------------------------------------------ */

describe('mockBuddyRepository · 推荐（规格 §3.3 / §5.7）', () => {
  it('返回 matchMode 与**非空** reason（规格 §5.7 硬要求）', async () => {
    const page = await unwrap(await repo.recommendations('sport', 10))
    expect(page.matchMode).toBe('rule')
    expect(page.items.length).toBeGreaterThan(0)
    for (const item of page.items) {
      expect(item.reason.length).toBeGreaterThan(0)
      expect(item.reasons.length).toBeGreaterThan(0)
    }
  })

  it('理由来自 `explainMatch`（与服务端同源）：结构化条目 + 权重降序', async () => {
    const page = await unwrap(await repo.recommendations('sport', 10))
    const badminton = page.items.find((item) => item.post.id === 'bp-1001')
    expect(badminton).toBeDefined()

    // ⚠️ 「同一个院系」是 **academic 板块专属**规则（规格 §3.3）：
    // `explainMatch`/`ruleScoreFor` 只在 section === 'academic' 时产出它。
    // 在 sport 板块断言它会失败 —— 这是测试的错，不是实现的错（下面单独验证 academic）。
    const codes = badminton?.reasons.map((r) => r.code) ?? []
    expect(codes).toContain('shared-activities') // 我 activityTags 与 u-0003 有共同项（badminton）
    // ⚠️ **sport 不含 availability-overlap**：`ruleScoreFor` 只在 `daily` 给这 0.2 分。
    // 虽然周六 14:00 确实落在我的周末时段里，但在 sport 板块它**不影响分数** ——
    // 展示一条不加分的理由就是"解释不了排序的理由"（Lead 已裁决修正 explainMatch）。
    expect(codes).not.toContain('availability-overlap')
    expect(codes).not.toContain('same-department')

    // 权重降序（explainMatch 的契约）
    const weights = badminton?.reasons.map((r) => r.weight) ?? []
    expect(weights.length).toBeGreaterThan(0)
    expect([...weights].sort((a, b) => b - a)).toEqual(weights)
  })

  it('academic 板块：同院系候选的理由含「同一个院系」（规格 §3.3 / 验收 T4）', async () => {
    const page = await unwrap(await repo.recommendations('academic', 50))
    // bp-1013 的发起人 u-0003 与我同属「信息科学与技术学院」
    const sameDepartment = page.items.find((item) => item.post.id === 'bp-1013')
    expect(sameDepartment).toBeDefined()
    expect(sameDepartment?.reasons.map((r) => r.code)).toContain('same-department')
    expect(sameDepartment?.reason).toContain('同一个院系')
    // 权重 0.4 是最高的，因此排在第一条
    expect(sameDepartment?.reasons[0]?.code).toBe('same-department')
  })

  it('硬过滤 F1/F3/F6/F7 逐条生效（验收 T13 的搭子版）', async () => {
    const page = await unwrap(await repo.recommendations('sport', 50))
    const ids = page.items.map((item) => item.post.id)
    expect(ids).not.toContain('bp-1007') // F1：已满（3/3）
    expect(ids).not.toContain('bp-1006') // 不是 sport，但顺带断言不属于本板块
    expect(ids).not.toContain('bp-1012') // F6：minSkillLevel=competitive > 我的 regular
    expect(ids).not.toContain('bp-1011') // F7：周二 06:00 不在我的可用时段里
  })

  it('F4：已申请（PENDING）的活动不再被推荐', async () => {
    const page = await unwrap(await repo.recommendations('academic', 50))
    expect(page.items.map((item) => item.post.id)).not.toContain('bp-1002')
  })

  it('反馈按 **section 隔离**：daily 的 dislike 不改变该帖在 sport 的分数（验收 T6）', async () => {
    const before = await unwrap(await repo.recommendations('sport', 50))
    const beforeScore = before.items.find((item) => item.post.id === 'bp-1001')?.score

    // 同一个帖子，但反馈记在 **daily** 板块
    await repo.feedback('bp-1001', { section: 'daily', action: 'dislike' })
    const afterCrossSection = await unwrap(await repo.recommendations('sport', 50))
    const crossScore = afterCrossSection.items.find((item) => item.post.id === 'bp-1001')?.score
    expect(crossScore).toBe(beforeScore)

    // 记在 **sport** 板块则必须生效
    await repo.feedback('bp-1001', { section: 'sport', action: 'dislike' })
    const afterSameSection = await unwrap(await repo.recommendations('sport', 50))
    const sameScore = afterSameSection.items.find((item) => item.post.id === 'bp-1001')?.score
    expect(sameScore).toBeLessThan(beforeScore ?? 0)
  })

  it('`like` 让分数升高、`dislike` 让分数降低（验收 T5 的搭子版）', async () => {
    const base = await unwrap(await repo.recommendations('sport', 50))
    const baseScore = base.items.find((item) => item.post.id === 'bp-1001')?.score ?? 0

    await repo.feedback('bp-1001', { section: 'sport', action: 'like' })
    const liked = await unwrap(await repo.recommendations('sport', 50))
    expect(liked.items.find((item) => item.post.id === 'bp-1001')?.score).toBeGreaterThan(baseScore)

    await repo.feedback('bp-1001', { section: 'sport', action: 'dislike' })
    const disliked = await unwrap(await repo.recommendations('sport', 50))
    expect(disliked.items.find((item) => item.post.id === 'bp-1001')?.score).toBeLessThan(baseScore)
  })

  it('反馈是 UPSERT：同一 (帖, 板块) 只保留最后一次', async () => {
    await repo.feedback('bp-1001', { section: 'sport', action: 'like' })
    await repo.feedback('bp-1001', { section: 'sport', action: 'skip' })
    const page = await unwrap(await repo.recommendations('sport', 50))
    const score = page.items.find((item) => item.post.id === 'bp-1001')?.score ?? 0
    // skip 的权重是 -0.05，因此分数应低于「无反馈」的基线
    const fresh = createRepo()
    const freshPage = await unwrap(await fresh.recommendations('sport', 50))
    expect(score).toBeLessThan(freshPage.items.find((item) => item.post.id === 'bp-1001')?.score ?? 0)
  })

  it('种子里的 dislike（bp-1004）把分数压到低于无反馈的同分帖', async () => {
    const page = await unwrap(await repo.recommendations('sport', 50))
    const disliked = page.items.find((item) => item.post.id === 'bp-1004')
    expect(disliked).toBeDefined()
    expect(disliked?.score).toBeLessThan(1)
  })

  it('未开启匹配资料 / 已删除资料 → matchMode=rule + 「按时间排序」+ score 0（规格 §5.7 末段）', async () => {
    await repo.deleteProfile()
    const page = await unwrap(await repo.recommendations('sport', 10))
    expect(page.matchMode).toBe('rule')
    for (const item of page.items) {
      expect(item.reason).toBe('按时间排序')
      expect(item.score).toBe(0)
      expect(item.reasons).toEqual([])
    }
  })

  it('未登录也能拿到推荐（降级为按时间排序，不报错）', async () => {
    const anonymous = createRepo(null)
    const page = await unwrap(await anonymous.recommendations('sport', 10))
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.matchMode).toBe('rule')
  })
})

/* ------------------------------------------------------------------ *
 * 匹配资料
 * ------------------------------------------------------------------ */

describe('mockBuddyRepository · 匹配资料（规格 §2.2 / §6.3）', () => {
  it('读取种子资料（含可用时段 —— F7 的依据）', async () => {
    const profile = await unwrap(await repo.getProfile())
    expect(profile?.matchEnabled).toBe(true)
    expect(profile?.availability.length).toBeGreaterThan(0)
    expect(profile?.interestTags).toContain('programming')
  })

  it('保存非法资料 → VALIDATION_FAILED', async () => {
    const profile = await unwrap(await repo.getProfile())
    if (profile === null) throw new Error('种子资料应存在')
    const result = await repo.putProfile({
      ...profile,
      availability: [{ dow: 1, startMin: 1200, endMin: 600 }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
  })

  it('保存合法资料后读回一致', async () => {
    const profile = await unwrap(await repo.getProfile())
    if (profile === null) throw new Error('种子资料应存在')
    await repo.putProfile({
      ...profile,
      department: '生命科学与技术学院',
      availability: [{ dow: 6, startMin: 9 * 60, endMin: 12 * 60 }],
    })
    const reloaded = await unwrap(await repo.getProfile())
    expect(reloaded?.department).toBe('生命科学与技术学院')
    expect(reloaded?.availability).toEqual([{ dow: 6, startMin: 540, endMin: 720 }])
  })

  it('deleteProfile 后 getProfile 返回 null（硬删，规格 §6.3）', async () => {
    await repo.deleteProfile()
    expect(await unwrap(await repo.getProfile())).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * 三态控制面（页面用它真实演示 loading / empty / error）
 * ------------------------------------------------------------------ */

describe('mockBuddyRepository · 三态控制面', () => {
  it('failNextRequests 让下一次请求返回 UPSTREAM_UNAVAILABLE', async () => {
    repo.failNextRequests(1)
    const failed = await repo.listItems({ limit: 10 })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    // 只失败一次
    const ok2 = await repo.listItems({ limit: 10 })
    expect(ok2.ok).toBe(true)
  })

  it('clearAll 清空数据，reset 恢复种子', async () => {
    repo.clearAll()
    const empty = await unwrap(await repo.listItems({ limit: 10 }))
    expect(empty.items).toHaveLength(0)
    expect(empty.total).toBe(0)

    repo.reset()
    const restored = await unwrap(await repo.listItems({ limit: 10 }))
    expect(restored.items.length).toBeGreaterThan(0)
  })

  it('addDemoApplication 让「发起人审批」在任何自己的帖子上都可演示', async () => {
    const created = await unwrap(await repo.createItem(DRAFT, 'k-demo-app'))
    const application = await unwrap(await repo.addDemoApplication(created.id))
    expect(application.status).toBe('PENDING')
    const list = await unwrap(await repo.listApplications(created.id))
    expect(list.items).toHaveLength(1)
  })
})
