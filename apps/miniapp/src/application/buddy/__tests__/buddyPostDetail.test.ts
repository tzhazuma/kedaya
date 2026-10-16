import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import { createBuddyPostDetailUseCase } from '../buddyPostDetail'
import type { BuddyPostDetailDeps } from '../buddyPostDetail'
import type { BuddyPost } from '../../../domain/models/buddy'
import {
  TEST_NOW_ISO,
  TEST_PROFILE,
  buddyApplication,
  buddyPost,
  createFakeBuddyRepository,
  createFakeCache,
  createFakeSessionStore,
  fixedClock,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * 搭子详情用例测试 —— 申请 / 撤回 / 审批 / 关闭（契约 §11.2 的四个动作）。
 *
 * 两条关键语义：
 * 1. **`join` 是「申请」不是「入队」**（规格 §5.5）：`join` 之后必须重新拉详情，
 *    因为申请**不**占名额 —— 用例不能假设 `joinedCount` 变了。
 * 2. **申请列表仅发起人可见**（规格 §6.1）：非发起人拿到 `FORBIDDEN` 时
 *    应被视为「不可见」而不是页面故障。
 */

const OTHER_POST = buddyPost('bp-1', {
  creator: { id: 'u-other', nickname: '王同学', avatarUrl: null },
})

const MY_POST = buddyPost('bp-mine', {
  creator: { id: TEST_PROFILE.id, nickname: TEST_PROFILE.nickname, avatarUrl: null },
})

function createUseCase(
  options: Parameters<typeof createFakeBuddyRepository>[0] = {},
  session = createFakeSessionStore(),
  cacheSeed?: Record<string, unknown>,
) {
  const repository = createFakeBuddyRepository(options)
  const cache = createFakeCache(cacheSeed)
  const deps: BuddyPostDetailDeps = {
    repository,
    cache,
    clock: fixedClock(TEST_NOW_ISO),
    cacheKeyFor: (id: string) => `buddy:detail:${id}`,
    session,
  }
  return { repository, cache, useCase: createBuddyPostDetailUseCase(deps) }
}

describe('buddyPostDetail · 契约 §8 hydrate', () => {
  it('hydrate 同步恢复缓存详情，并把申请资格一并算出来', () => {
    const { repository, useCase } = createUseCase({}, createFakeSessionStore(), {
      'buddy:detail:bp-1': { post: OTHER_POST, updatedAt: TEST_NOW_ISO },
    })

    const state = useCase.hydrate('bp-1')

    expect(state.status).toBe('ready')
    expect(state.post?.id).toBe('bp-1')
    expect(state.fromCache).toBe(true)
    expect(state.summary).not.toBeNull()
    // 不是我的帖子 → 可以申请
    expect(state.eligibility?.allowed).toBe(true)
    expect(repository.detailQueue).toHaveLength(0)
  })

  it('自己的帖子 → eligibility 为 own-post，isCreator 为 true', () => {
    const { useCase } = createUseCase({}, createFakeSessionStore(), {
      'buddy:detail:bp-mine': { post: MY_POST, updatedAt: TEST_NOW_ISO },
    })
    const state = useCase.hydrate('bp-mine')
    expect(state.isCreator).toBe(true)
    expect(state.eligibility?.allowed).toBe(false)
    if (state.eligibility !== null && !state.eligibility.allowed) {
      expect(state.eligibility.reason).toBe('own-post')
    }
  })

  it('hydrate 对不同 id 是独立的', () => {
    const { useCase } = createUseCase({}, createFakeSessionStore(), {
      'buddy:detail:bp-1': { post: OTHER_POST, updatedAt: TEST_NOW_ISO },
      'buddy:detail:bp-mine': { post: MY_POST, updatedAt: TEST_NOW_ISO },
    })
    useCase.hydrate('bp-1')
    expect(useCase.hydrate('bp-mine').post?.id).toBe('bp-mine')
  })
})

describe('buddyPostDetail · 加载与申请列表可见性（规格 §6.1）', () => {
  it('发起人视角：拿到申请列表，applicationsVisible=true', async () => {
    const { repository, useCase } = createUseCase({
      detail: [ok(MY_POST)],
      applications: ok({ items: [buddyApplication('ba-1'), buddyApplication('ba-2')], nextCursor: null }),
    })

    const state = await useCase.load('bp-mine')

    expect(state.status).toBe('ready')
    expect(state.isCreator).toBe(true)
    expect(state.applicationsVisible).toBe(true)
    expect(state.applications).toHaveLength(2)
    expect(repository.applicationQueries).toEqual(['bp-mine'])
  })

  it('非发起人视角：FORBIDDEN 被当作「不可见」，**不是**页面错误', async () => {
    const { useCase } = createUseCase({
      detail: [ok(OTHER_POST)],
      applications: err({ code: 'FORBIDDEN', message: '只有发起人可以查看申请列表' }),
    })

    const state = await useCase.load('bp-1')

    expect(state.status).toBe('ready')
    expect(state.error).toBeNull()
    expect(state.applicationsVisible).toBe(false)
    expect(state.applications).toEqual([])
  })

  it('详情加载失败且无缓存 → error 态', async () => {
    const { useCase } = createUseCase({ detail: [err(upstreamError('详情服务不可用'))] })
    const state = await useCase.load('bp-1')
    expect(state.status).toBe('error')
    expect(state.error).toBe('详情服务不可用')
  })

  it('成功后写入缓存', async () => {
    const { cache, useCase } = createUseCase({ detail: [ok(OTHER_POST)] })
    await useCase.load('bp-1')
    expect(cache.read('buddy:detail:bp-1')).not.toBeNull()
  })
})

describe('buddyPostDetail · join / leave（规格 §5.5）', () => {
  it('join 带幂等键提交，随后**重新拉详情**（因为 join 不占名额）', async () => {
    const { repository, useCase } = createUseCase({
      detail: [ok(OTHER_POST), ok(OTHER_POST)],
      join: ok(buddyApplication('ba-new')),
    })

    await useCase.load('bp-1')
    const state = await useCase.join('bp-1', '一起打')

    expect(repository.joins).toEqual([
      {
        id: 'bp-1',
        input: { message: '一起打', idempotencyKey: `buddy:join:bp-1:${TEST_PROFILE.id}` },
      },
    ])
    // 详情被拉了两次：load 一次 + join 后刷新一次
    expect(repository.detailQueue).toHaveLength(0)
    expect(state.lastAction).toBe('join')
    expect(state.actionError).toBeNull()
  })

  it('join 的幂等键与 (帖, 人) 绑定 —— 弱网重试不会产生第二条申请', async () => {
    const { repository, useCase } = createUseCase({
      detail: [ok(OTHER_POST), ok(OTHER_POST), ok(OTHER_POST)],
    })
    await useCase.load('bp-1')
    await useCase.join('bp-1')
    await useCase.join('bp-1')
    expect(repository.joins[0]?.input.idempotencyKey).toBe(repository.joins[1]?.input.idempotencyKey)
  })

  it('join 失败 → actionError，lastAction 保持 null', async () => {
    const { useCase } = createUseCase({
      detail: [ok(OTHER_POST)],
      join: err({ code: 'CONFLICT', message: '人数已满，来晚了一步' }),
    })
    await useCase.load('bp-1')
    const state = await useCase.join('bp-1')
    expect(state.actionError).toBe('人数已满，来晚了一步')
    expect(state.lastAction).toBeNull()
    expect(state.acting).toBe(false)
  })

  it('未登录 join → actionError 且**不发请求**', async () => {
    const { repository, useCase } = createUseCase({}, createFakeSessionStore(null))
    const state = await useCase.join('bp-1')
    expect(state.actionError).toContain('登录')
    expect(repository.joins).toHaveLength(0)
  })

  it('leave 撤回申请并刷新详情', async () => {
    const { repository, useCase } = createUseCase({
      detail: [ok(OTHER_POST), ok(OTHER_POST)],
      leave: ok(buddyApplication('ba-1', { status: 'WITHDRAWN' })),
    })
    await useCase.load('bp-1')
    const state = await useCase.leave('bp-1')

    expect(repository.leaves).toHaveLength(1)
    expect(repository.leaves[0]?.idempotencyKey).toBeTruthy()
    expect(state.lastAction).toBe('leave')
  })
})

describe('buddyPostDetail · decide / close（规格 §5.6，仅发起人）', () => {
  it('decide 把 applicationId + decision 原样传给仓储', async () => {
    const { repository, useCase } = createUseCase({
      detail: [ok(MY_POST)],
      decide: ok(buddyPost('bp-mine', { joinedCount: 2 })),
    })
    await useCase.load('bp-mine')

    const state = await useCase.decide('bp-mine', 'ba-1', 'ACCEPTED')

    expect(repository.decisions).toEqual([
      {
        id: 'bp-mine',
        input: {
          applicationId: 'ba-1',
          decision: 'ACCEPTED',
          idempotencyKey: 'buddy:decide:ba-1:ACCEPTED',
        },
      },
    ])
    expect(state.lastAction).toBe('decide')
  })

  it('decide(REJECTED) 与 ACCEPTED 走同一个动作，只是 decision 不同（契约 §11.2 的理由）', async () => {
    const { repository, useCase } = createUseCase({ detail: [ok(MY_POST)] })
    await useCase.load('bp-mine')
    await useCase.decide('bp-mine', 'ba-2', 'REJECTED')
    expect(repository.decisions[0]?.input.decision).toBe('REJECTED')
  })

  it('非发起人 decide → 服务端 FORBIDDEN 如实暴露为 actionError', async () => {
    const { useCase } = createUseCase({
      detail: [ok(OTHER_POST)],
      decide: err({ code: 'FORBIDDEN', message: '只有发起人可以审批申请' }),
    })
    await useCase.load('bp-1')
    const state = await useCase.decide('bp-1', 'ba-1', 'ACCEPTED')
    expect(state.actionError).toBe('只有发起人可以审批申请')
  })

  it('close 关闭招募并把状态更新为 CLOSED', async () => {
    const { repository, useCase } = createUseCase({
      detail: [ok(MY_POST)],
      close: ok(buddyPost('bp-mine', { status: 'CLOSED' })),
    })
    await useCase.load('bp-mine')

    const state = await useCase.close('bp-mine')

    expect(repository.closes).toHaveLength(1)
    expect(state.post?.status).toBe('CLOSED')
    expect(state.summary?.statusLabel).toBe('已关闭')
    expect(state.lastAction).toBe('close')
  })

  it('非发起人 close → actionError', async () => {
    const { useCase } = createUseCase({
      detail: [ok(OTHER_POST)],
      close: err({ code: 'FORBIDDEN', message: '只有发起人可以关闭招募' }),
    })
    await useCase.load('bp-1')
    expect((await useCase.close('bp-1')).actionError).toBe('只有发起人可以关闭招募')
  })
})

describe('buddyPostDetail · 匹配反馈（规格 §5.8）', () => {
  it('feedback 用**帖子的 activity 派生**出 section 再提交（不是页面猜的）', async () => {
    const studyPost: BuddyPost = buddyPost('bp-study', { activity: 'study', tags: ['self-study'] })
    const { repository, useCase } = createUseCase({ detail: [ok(studyPost)] })
    await useCase.load('bp-study')

    const state = await useCase.feedback('bp-study', 'like')

    expect(repository.feedbacks).toEqual([
      { id: 'bp-study', input: { section: 'academic', action: 'like' } },
    ])
    expect(state.myFeedback).toBe('like')
    expect(state.actionError).toBeNull()
  })

  it('反馈失败 → actionError，按钮态不变', async () => {
    const { useCase } = createUseCase({
      detail: [ok(OTHER_POST)],
      feedback: err({ code: 'RATE_LIMITED', message: '操作过于频繁' }),
    })
    await useCase.load('bp-1')
    const state = await useCase.feedback('bp-1', 'dislike')
    expect(state.actionError).toBe('操作过于频繁')
    expect(state.myFeedback).toBeNull()
  })

  it('还没加载到帖子时反馈被拒（不猜 section）', async () => {
    const { repository, useCase } = createUseCase()
    const state = await useCase.feedback('bp-1', 'like')
    expect(state.actionError).toContain('还没有加载到')
    expect(repository.feedbacks).toHaveLength(0)
  })
})
