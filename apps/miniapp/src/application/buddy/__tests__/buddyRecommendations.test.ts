import { describe, expect, it } from 'vitest'
import { explainMatch, err, ok } from '@kedaya/shared'

import {
  createBuddyRecommendationsUseCase,
  deriveReasons,
  publicSubjectOf,
  reasonText,
  toMatchSubject,
} from '../buddyRecommendations'
import type { BuddyRecommendationDeps } from '../buddyRecommendations'
import { availabilityOverlapsPost } from '../../../domain/models/buddy'
import type { BuddySection } from '../../../domain/models/buddy'
import {
  TEST_NOW_ISO,
  buddyPost,
  buddyProfile,
  createFakeBuddyRepository,
  createFakeCache,
  createFakeSessionStore,
  fixedClock,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * 推荐用例测试 —— **可解释性（G3）的可执行规格**。
 *
 * 本模块最重要的要求：推荐理由必须由 `@kedaya/shared` 的 `explainMatch()`
 * 产出，与服务端排序**同一套算法**。因此这里的核心断言是：
 *
 * 1. 服务端**有**结构化理由时原样使用（并标注 `reasonSource: 'server'`）；
 * 2. 服务端**没有**结构化理由时（OpenAPI 只回了 `reason` 字符串），
 *    客户端用 `explainMatch()` 补齐它**能诚实支撑**的那部分，
 *    并标注 `reasonSource: 'client'`；
 * 3. 客户端**永远不**声称「同一个院系」或「共同兴趣 N 项」——
 *    发起人的院系与兴趣不对客户端公开（规格 §6.1），硬算只能靠编造。
 */

/** 周一 19:00（北京时间）—— 落在我 `buddyProfile()` 的周一 18:00–22:00 时段里 */
const MONDAY_1900 = '2026-10-19T11:00:00.000Z'

function createUseCase(options: Parameters<typeof createFakeBuddyRepository>[0] = {}, profile = buddyProfile()) {
  const repository = createFakeBuddyRepository({
    // 默认：服务端**只**给字符串理由，不给结构化理由（真实 OpenAPI 的形状）
    profile: ok(profile),
    ...options,
  })
  const cache = createFakeCache()
  const deps: BuddyRecommendationDeps = {
    repository,
    cache,
    clock: fixedClock(TEST_NOW_ISO),
    session: createFakeSessionStore(),
    cacheKeyFor: (section: BuddySection) => `buddy:reco:${section}`,
    feedbackCacheKey: 'buddy:feedback',
  }
  return { repository, cache, useCase: createBuddyRecommendationsUseCase(deps) }
}

describe('buddyRecommendations · 客户端用 explainMatch 补齐理由（可解释性硬要求）', () => {
  it('`deriveReasons` 的输出与 `explainMatch` **逐字一致**（同一套算法）', () => {
    const profile = buddyProfile()
    const post = buddyPost('bp-1', {
      startsAt: MONDAY_1900,
      tags: ['badminton'],
      location: '体育馆',
    })

    const availabilityOverlaps = availabilityOverlapsPost(profile.availability, post)
    const expected = explainMatch(
      'sport',
      toMatchSubject(profile),
      { creator: publicSubjectOf(post), tags: post.tags },
      { availabilityOverlaps },
    )

    expect(deriveReasons('sport', profile, post)).toEqual(expected)
  })

  it('`deriveReasons` 产出可读的中文理由（「时间能碰上」「共同活动 N 项」「常在同一个区域」）', () => {
    const profile = buddyProfile()
    const post = buddyPost('bp-1', {
      startsAt: MONDAY_1900,
      tags: ['badminton'],
      location: '体育馆',
    })

    const reasons = deriveReasons('sport', profile, post)
    const labels = reasons.map((r) => r.label)

    // ⚠️ **sport 不应出现「时间能碰上」**：`ruleScoreFor` 只在 `daily` 给这 0.2 分，
    // 在 sport 展示它会让用户看到一个解释不了分数的理由。
    // （Lead 已裁决改共享包 `explainMatch` 与打分表对齐；本条由断言旧行为改为断言新行为。）
    expect(labels).not.toContain('时间能碰上')
    expect(labels).toContain('共同活动 1 项')
    expect(labels).toContain('常在同一个区域')

    // daily 才应该有它 —— 与打分表一致
    expect(deriveReasons('daily', profile, post).map((r) => r.label)).toContain('时间能碰上')
    // 权重降序
    const weights = reasons.map((r) => r.weight)
    expect([...weights].sort((a, b) => b - a)).toEqual(weights)
  })

  it('客户端**不**声称「同一个院系」/「共同兴趣 N 项」（发起人资料不公开，规格 §6.1）', () => {
    const profile = buddyProfile({ department: '信息科学与技术学院', interestTags: ['programming'] })
    const post = buddyPost('bp-1', {
      startsAt: MONDAY_1900,
      tags: ['badminton'],
      location: '体育馆',
      minSkillLevel: 'regular',
    })

    const codes = deriveReasons('sport', profile, post).map((r) => r.code)
    expect(codes).not.toContain('same-department')
    expect(codes).not.toContain('shared-interests')

    // `publicSubjectOf` 刻意把发起人的院系与兴趣留空
    const subject = publicSubjectOf(post)
    expect(subject.department).toBeNull()
    expect(subject.interestTags).toEqual([])
  })

  it('服务端**没有**结构化理由时，客户端补齐并标注 `reasonSource: client`', async () => {
    const { useCase } = createUseCase({
      recommendations: ok({
        matchMode: 'rule',
        nextCursor: null,
        items: [
          {
            post: buddyPost('bp-1', {
              startsAt: MONDAY_1900,
              tags: ['badminton'],
              location: '体育馆',
            }),
            score: 0.45,
            reason: '',
            reasons: [],
          },
        ],
      }),
    })

    const state = await useCase.load('sport')
    const item = state.items[0]

    expect(item?.reasonSource).toBe('client')
    expect(item?.reasons.length).toBeGreaterThan(0)
    // 页面渲染的就是这些结构化条目，而不是只有一个分数
    // sport 不含「时间能碰上」（它在该板块不加分）；其余理由正常产出
    expect(item?.reasons.map((r) => r.label)).not.toContain('时间能碰上')
    expect(item?.reasons.map((r) => r.label)).toContain('共同活动 1 项')
    expect(item?.reasons.map((r) => r.label)).toContain('常在同一个区域')
  })

  it('**标题理由永远优先用服务端原文**（排序依据不能被客户端推算覆盖）', async () => {
    const { useCase } = createUseCase({
      recommendations: ok({
        matchMode: 'hash',
        nextCursor: null,
        items: [
          {
            post: buddyPost('bp-1', {
              startsAt: MONDAY_1900,
              tags: ['badminton'],
              location: '体育馆',
            }),
            score: 0.6,
            // 服务端用双方完整资料算出的原文 —— 客户端**无法**复现（规格 §6.1）
            reason: '同院系、共同兴趣 3 项、时间合适',
            reasons: [],
          },
        ],
      }),
    })

    const state = await useCase.load('sport')
    const item = state.items[0]

    // 标题 = 服务端原文；**不是**客户端推算出来的「时间能碰上、共同活动 1 项…」
    expect(item?.reason).toBe('同院系、共同兴趣 3 项、时间合适')
    expect(item?.serverReason).toBe('同院系、共同兴趣 3 项、时间合适')
    // 标签是客户端按公开信息算的，来源如实标注
    expect(item?.reasonSource).toBe('client')
    // sport 不含 availability-overlap（该板块不给这 0.2 分）
    expect(item?.reasons.map((r) => r.code)).not.toContain('availability-overlap')
  })

  it('服务端结构化理由存在时，标题与标签都来自服务端（`reasonSource: server`）', async () => {
    const { useCase } = createUseCase({
      recommendations: ok({
        matchMode: 'rule',
        nextCursor: null,
        items: [
          {
            post: buddyPost('bp-1'),
            score: 0.4,
            reason: '同一个院系',
            reasons: [{ code: 'same-department', label: '同一个院系', weight: 0.4 }],
          },
        ],
      }),
    })
    const state = await useCase.load('sport')
    expect(state.items[0]?.reasonSource).toBe('server')
    expect(state.items[0]?.serverReason).toBe('同一个院系')
    expect(state.items[0]?.reason).toBe('同一个院系')
  })

  it('服务端**有**结构化理由时优先使用，并标注 `reasonSource: server`', async () => {
    const { useCase } = createUseCase({
      recommendations: ok({
        matchMode: 'hash',
        nextCursor: null,
        items: [
          {
            post: buddyPost('bp-1', { startsAt: MONDAY_1900 }),
            score: 0.723,
            reason: '同院系',
            reasons: [{ code: 'same-department', label: '同一个院系', weight: 0.4 }],
          },
        ],
      }),
    })

    const state = await useCase.load('sport')
    const item = state.items[0]

    expect(item?.reasonSource).toBe('server')
    expect(item?.reasons).toEqual([
      { code: 'same-department', label: '同一个院系', weight: 0.4 },
    ])
    expect(item?.reason).toBe('同院系')
    expect(item?.matchMode).toBe('hash')
    expect(item?.score).toBe(0.723)
  })

  it('`reasonText` 取前 3 条并在无命中时回落「有潜在匹配」（对齐 matching.py:299-301）', () => {
    expect(reasonText([])).toBe('有潜在匹配')
    expect(
      reasonText([
        { code: 'a', label: 'A', weight: 0.4 },
        { code: 'b', label: 'B', weight: 0.3 },
        { code: 'c', label: 'C', weight: 0.2 },
        { code: 'd', label: 'D', weight: 0.1 },
      ]),
    ).toBe('A、B、C')
  })

  it('理由**永远非空**（规格 §5.7：`reason` 必须非空）', async () => {
    const { useCase } = createUseCase({
      recommendations: ok({
        matchMode: 'rule',
        nextCursor: null,
        items: [{ post: buddyPost('bp-1'), score: 0, reason: '', reasons: [] }],
      }),
      // 没有匹配资料的极端情况：客户端算不出任何理由
      profile: ok(null),
    })

    const state = await useCase.load('sport')
    expect(state.items[0]?.reason.length).toBeGreaterThan(0)
    expect(state.items[0]?.reason).toBe('有潜在匹配')
    // 服务端没给理由原文 → serverReason 为 null（页面据此改成「推荐理由」措辞）
    expect(state.items[0]?.serverReason).toBeNull()
  })
})

describe('buddyRecommendations · 匹配模式与降级', () => {
  it('`matchMode` 原样暴露（规格 §5.7 硬要求）', async () => {
    for (const mode of ['vector', 'hash', 'rule'] as const) {
      const { useCase } = createUseCase({
        recommendations: ok({
          matchMode: mode,
          nextCursor: null,
          items: [{ post: buddyPost('bp-1'), score: 0.5, reason: '有潜在匹配', reasons: [] }],
        }),
      })
      const state = await useCase.load('sport')
      expect(state.matchMode).toBe(mode)
      expect(state.items[0]?.matchMode).toBe(mode)
    }
  })

  it('匹配资料未开启 → matchEnabled=false，页面据此如实说明「按时间排序」', async () => {
    const { useCase } = createUseCase({
      profile: ok(buddyProfile({ matchEnabled: false })),
      recommendations: ok({
        matchMode: 'rule',
        nextCursor: null,
        items: [{ post: buddyPost('bp-1'), score: 0, reason: '按时间排序', reasons: [] }],
      }),
    })
    const state = await useCase.load('sport')
    expect(state.matchEnabled).toBe(false)
    expect(state.matchMode).toBe('rule')
  })

  it('匹配资料拉取失败**不阻塞**推荐（降级为 rule）', async () => {
    const { useCase } = createUseCase({
      profile: err(upstreamError('资料服务不可用')),
      recommendations: ok({
        matchMode: 'rule',
        nextCursor: null,
        items: [{ post: buddyPost('bp-1'), score: 0, reason: '按时间排序', reasons: [] }],
      }),
    })
    const state = await useCase.load('sport')
    expect(state.status).toBe('ready')
    expect(state.profile).toBeNull()
    expect(state.items).toHaveLength(1)
  })
})

describe('buddyRecommendations · 三态与缓存', () => {
  it('空结果 → empty 态', async () => {
    const { useCase } = createUseCase({
      recommendations: ok({ matchMode: 'rule', nextCursor: null, items: [] }),
    })
    expect((await useCase.load('sport')).status).toBe('empty')
  })

  it('推荐失败且无缓存 → error 态', async () => {
    const { useCase } = createUseCase({ recommendations: err(upstreamError('推荐服务不可用')) })
    const state = await useCase.load('sport')
    expect(state.status).toBe('error')
    expect(state.error).toBe('推荐服务不可用')
  })

  it('成功后写入缓存；hydrate 能同步恢复', async () => {
    const { cache, useCase } = createUseCase({
      recommendations: ok({
        matchMode: 'rule',
        nextCursor: null,
        items: [{ post: buddyPost('bp-1'), score: 0.4, reason: '有潜在匹配', reasons: [] }],
      }),
    })
    await useCase.load('sport')
    expect(cache.read('buddy:reco:sport')).not.toBeNull()

    const fresh = createBuddyRecommendationsUseCase({
      repository: createFakeBuddyRepository({ profile: ok(buddyProfile()) }),
      cache,
      clock: fixedClock(TEST_NOW_ISO),
      session: createFakeSessionStore(),
      cacheKeyFor: (section: BuddySection) => `buddy:reco:${section}`,
      feedbackCacheKey: 'buddy:feedback',
    })
    const hydrated = fresh.hydrate('sport')
    expect(hydrated.status).toBe('ready')
    expect(hydrated.fromCache).toBe(true)
    expect(hydrated.items).toHaveLength(1)
  })
})

describe('buddyRecommendations · 反馈（规格 §5.8 / §3.6）', () => {
  it('feedback 带当前板块提交，并**重新拉取**让排序立刻反映反馈', async () => {
    const { repository, useCase } = createUseCase({
      recommendations: ok({
        matchMode: 'rule',
        nextCursor: null,
        items: [{ post: buddyPost('bp-1'), score: 0.4, reason: '有潜在匹配', reasons: [] }],
      }),
    })

    await useCase.load('academic')
    const state = await useCase.feedback('bp-1', 'dislike')

    expect(repository.feedbacks).toEqual([
      { id: 'bp-1', input: { section: 'academic', action: 'dislike' } },
    ])
    // 反馈后自动重拉（load 又被调用一次）
    expect(repository.recommendationQueries.length).toBe(2)
    expect(state.items[0]?.myFeedback).toBe('dislike')
    expect(state.feedbackPending).toBeNull()
  })

  it('反馈失败 → feedbackError，且不改变按钮态', async () => {
    const { useCase } = createUseCase({
      recommendations: ok({
        matchMode: 'rule',
        nextCursor: null,
        items: [{ post: buddyPost('bp-1'), score: 0.4, reason: '有潜在匹配', reasons: [] }],
      }),
      feedback: err({ code: 'RATE_LIMITED', message: '操作过于频繁' }),
    })

    await useCase.load('sport')
    const state = await useCase.feedback('bp-1', 'like')

    expect(state.feedbackError).toBe('操作过于频繁')
    expect(state.items[0]?.myFeedback).toBeNull()
  })

  it('未登录 → feedbackError（不发请求）', async () => {
    const repository = createFakeBuddyRepository({
      profile: ok(buddyProfile()),
      recommendations: ok({ matchMode: 'rule', nextCursor: null, items: [] }),
    })
    const useCase = createBuddyRecommendationsUseCase({
      repository,
      cache: createFakeCache(),
      clock: fixedClock(TEST_NOW_ISO),
      session: createFakeSessionStore(null),
      cacheKeyFor: (section: BuddySection) => `buddy:reco:${section}`,
      feedbackCacheKey: 'buddy:feedback',
    })

    const state = await useCase.feedback('bp-1', 'like')
    expect(state.feedbackError).toContain('登录')
    expect(repository.feedbacks).toHaveLength(0)
  })

  it('反馈被本地记住（UPSERT：同一帖只保留最后一次）', async () => {
    const { cache, useCase } = createUseCase({
      recommendations: ok({
        matchMode: 'rule',
        nextCursor: null,
        items: [{ post: buddyPost('bp-1'), score: 0.4, reason: '有潜在匹配', reasons: [] }],
      }),
    })

    await useCase.load('sport')
    await useCase.feedback('bp-1', 'like')
    await useCase.feedback('bp-1', 'skip')

    expect(cache.read('buddy:feedback')).toEqual({ 'bp-1': 'skip' })
  })
})
