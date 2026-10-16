import { describe, expect, it } from 'vitest'

import { createForumPostDetailUseCase } from '../forumPostDetail'
import type { CachedForumPostDetail } from '../forumPostDetail'
import {
  TEST_NOW_ISO,
  createFakeCache,
  createFakeForumRepository,
  fixedClock,
  forumPost,
  forumReply,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * 主题详情用例测试 —— 主题与回复分别分页、分别失败。
 */

const cacheKeyFor = (id: string): string => `test:cache:forum:post:${id}`
const POST_ID = 'fp-1'

function createUseCase(
  repository: ReturnType<typeof createFakeForumRepository>,
  cache = createFakeCache(),
) {
  return {
    cache,
    useCase: createForumPostDetailUseCase({
      repository,
      cache,
      clock: fixedClock(TEST_NOW_ISO),
      cacheKeyFor,
    }),
  }
}

function cachedDetail(overrides: Partial<CachedForumPostDetail> = {}): CachedForumPostDetail {
  return {
    post: forumPost(POST_ID),
    replies: [forumReply('fr-1')],
    nextReplyCursor: null,
    updatedAt: '2026-10-16T11:00:00.000Z',
    ...overrides,
  }
}

describe('forumPostDetail · hydrate', () => {
  it('无缓存保持 idle', () => {
    const { useCase } = createUseCase(createFakeForumRepository())
    expect(useCase.hydrate(POST_ID).status).toBe('idle')
  })

  it('有缓存时同步产出 ready + fromCache（列表点进详情不白屏）', () => {
    const { useCase } = createUseCase(
      createFakeForumRepository(),
      createFakeCache({ [cacheKeyFor(POST_ID)]: cachedDetail() }),
    )

    const state = useCase.hydrate(POST_ID)

    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(true)
    expect(state.summary?.id).toBe(POST_ID)
    expect(state.replies).toHaveLength(1)
  })

  it('缓存形状非法时视为没有缓存', () => {
    const { useCase } = createUseCase(
      createFakeForumRepository(),
      createFakeCache({ [cacheKeyFor(POST_ID)]: { post: null } }),
    )
    expect(useCase.hydrate(POST_ID).status).toBe('idle')
  })
})

describe('forumPostDetail · load', () => {
  it('成功：并行拉主题与回复，构建回复树，过滤被隐藏回复', async () => {
    const repo = createFakeForumRepository({
      postDetail: { ok: true, value: forumPost(POST_ID, { replyCount: 3 }) },
      replies: [
        {
          ok: true,
          value: {
            items: [
              forumReply('fr-1'),
              forumReply('fr-2', { parentReplyId: 'fr-1' }),
              forumReply('fr-hidden', { status: 'HIDDEN' }),
            ],
            nextCursor: 'fr-2',
            total: 3,
          },
        },
      ],
    })
    const { useCase } = createUseCase(repo)

    const state = await useCase.load(POST_ID)

    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(false)
    expect(state.replies.map((item) => item.id)).toEqual(['fr-1', 'fr-2'])
    expect(state.threads).toHaveLength(1)
    expect(state.threads[0]?.children.map((item) => item.id)).toEqual(['fr-2'])
    expect(state.nextReplyCursor).toBe('fr-2')
    expect(repo.repliesQueries[0]).toMatchObject({ postId: POST_ID, query: { cursor: null } })
  })

  it('主题失败且无缓存：整页 error', async () => {
    const repo = createFakeForumRepository({ postDetail: { ok: false, error: upstreamError('主题不存在') } })
    const { useCase } = createUseCase(repo)

    const state = await useCase.load(POST_ID)

    expect(state.status).toBe('error')
    expect(state.error).toBe('主题不存在')
  })

  it('回复失败但主题成功：主题照常展示，只在回复区提示', async () => {
    const repo = createFakeForumRepository({
      postDetail: { ok: true, value: forumPost(POST_ID) },
      replies: [{ ok: false, error: upstreamError('回复加载失败') }],
    })
    const { useCase } = createUseCase(repo)

    const state = await useCase.load(POST_ID)

    expect(state.status).toBe('ready')
    expect(state.post).not.toBeNull()
    expect(state.repliesError).toBe('回复加载失败')
    expect(state.error).toBeNull()
  })

  it('主题失败但有缓存：保留缓存主题（契约 §8 静默降级）', async () => {
    const repo = createFakeForumRepository({ postDetail: { ok: false, error: upstreamError() } })
    const { useCase } = createUseCase(
      repo,
      createFakeCache({ [cacheKeyFor(POST_ID)]: cachedDetail() }),
    )
    useCase.hydrate(POST_ID)

    const state = await useCase.load(POST_ID)

    expect(state.status).toBe('ready')
    expect(state.error).toBe('网络不可用')
    expect(state.summary?.id).toBe(POST_ID)
  })
})

describe('forumPostDetail · loadMoreReplies（触底加载）', () => {
  it('用游标续页并追加，同时重建回复树', async () => {
    const repo = createFakeForumRepository({
      postDetail: { ok: true, value: forumPost(POST_ID) },
      replies: [
        { ok: true, value: { items: [forumReply('fr-1')], nextCursor: 'fr-1', total: 2 } },
        {
          ok: true,
          value: {
            items: [forumReply('fr-2', { parentReplyId: 'fr-1' })],
            nextCursor: null,
            total: 2,
          },
        },
      ],
    })
    const { useCase } = createUseCase(repo)

    await useCase.load(POST_ID)
    const state = await useCase.loadMoreReplies()

    expect(repo.repliesQueries[1]?.query.cursor).toBe('fr-1')
    expect(state.replies.map((item) => item.id)).toEqual(['fr-1', 'fr-2'])
    expect(state.threads[0]?.children).toHaveLength(1)
    expect(state.nextReplyCursor).toBeNull()
    expect(state.loadingReplies).toBe(false)
  })

  it('没有下一页时是空操作', async () => {
    const repo = createFakeForumRepository({
      postDetail: { ok: true, value: forumPost(POST_ID) },
      replies: [{ ok: true, value: { items: [forumReply('fr-1')], nextCursor: null, total: 1 } }],
    })
    const { useCase } = createUseCase(repo)

    await useCase.load(POST_ID)
    const state = await useCase.loadMoreReplies()

    expect(repo.repliesQueries).toHaveLength(1)
    expect(state.replies).toHaveLength(1)
  })

  it('续页失败时保留已加载回复，只挂局部错误', async () => {
    const repo = createFakeForumRepository({
      postDetail: { ok: true, value: forumPost(POST_ID) },
      replies: [
        { ok: true, value: { items: [forumReply('fr-1')], nextCursor: 'fr-1', total: 2 } },
        { ok: false, error: upstreamError('超时') },
      ],
    })
    const { useCase } = createUseCase(repo)

    await useCase.load(POST_ID)
    const state = await useCase.loadMoreReplies()

    expect(state.replies).toHaveLength(1)
    expect(state.repliesError).toBe('超时')
  })
})

describe('forumPostDetail · 写动作后的就地更新', () => {
  it('appendReply 插入新回复并把 replyCount 乐观 +1', async () => {
    const repo = createFakeForumRepository({
      postDetail: { ok: true, value: forumPost(POST_ID, { replyCount: 2 }) },
      replies: [{ ok: true, value: { items: [forumReply('fr-1')], nextCursor: null, total: 1 } }],
    })
    const { useCase } = createUseCase(repo)
    await useCase.load(POST_ID)

    const state = useCase.appendReply(forumReply('fr-new', { postId: POST_ID }))

    expect(state.post?.replyCount).toBe(3)
    expect(state.replies.map((item) => item.id)).toEqual(['fr-1', 'fr-new'])
  })

  it('applyPost 就地替换主题并刷新摘要', async () => {
    const repo = createFakeForumRepository({
      postDetail: { ok: true, value: forumPost(POST_ID, { status: 'PUBLISHED' }) },
      replies: [{ ok: true, value: { items: [], nextCursor: null, total: 0 } }],
    })
    const { useCase } = createUseCase(repo)
    await useCase.load(POST_ID)

    const state = useCase.applyPost(forumPost(POST_ID, { status: 'LOCKED', title: '被锁定' }))

    expect(state.summary?.title).toBe('被锁定')
    expect(state.summary?.commentable).toBe(false)
  })

  it('appendReply 在没有主题时是空操作', () => {
    const { useCase } = createUseCase(createFakeForumRepository())
    const before = useCase.getSnapshot()
    expect(useCase.appendReply(forumReply('fr-x'))).toBe(before)
  })

  it('写动作会写回缓存（返回详情页仍有数据）', async () => {
    const repo = createFakeForumRepository({
      postDetail: { ok: true, value: forumPost(POST_ID, { replyCount: 0 }) },
      replies: [{ ok: true, value: { items: [], nextCursor: null, total: 0 } }],
    })
    const { useCase, cache } = createUseCase(repo)
    await useCase.load(POST_ID)

    useCase.appendReply(forumReply('fr-new', { postId: POST_ID }))

    const cached = cache.read<CachedForumPostDetail>(cacheKeyFor(POST_ID))
    expect(cached?.replies.map((item) => item.id)).toEqual(['fr-new'])
    expect(cached?.post.replyCount).toBe(1)
  })
})
