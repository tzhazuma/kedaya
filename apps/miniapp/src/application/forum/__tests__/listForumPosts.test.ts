import { describe, expect, it } from 'vitest'

import { createListForumPostsUseCase } from '../listForumPosts'
import type { CachedForumPostList } from '../listForumPosts'
import {
  TEST_NOW_ISO,
  createFakeCache,
  createFakeForumRepository,
  fixedClock,
  forumPost,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * 主题列表用例测试 —— 契约 §8 启动时序 + 小程序游标分页（`onReachBottom`）。
 */

const CACHE_KEY = 'test:cache:forum:posts'

function createUseCase(
  repository: ReturnType<typeof createFakeForumRepository>,
  cache = createFakeCache(),
) {
  return {
    cache,
    useCase: createListForumPostsUseCase({
      repository,
      cache,
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
    }),
  }
}

function cachedList(overrides: Partial<CachedForumPostList> = {}): CachedForumPostList {
  return {
    posts: [forumPost('fp-1', { anonymous: true, authorName: '张同学' })],
    activeBoardId: 'fb-1',
    keyword: '',
    nextCursor: 'fp-1',
    total: 2,
    updatedAt: '2026-10-16T11:00:00.000Z',
    ...overrides,
  }
}

describe('listForumPosts · hydrate（契约 §8 第 1 步）', () => {
  it('无缓存时保持 idle，不触发请求', () => {
    const repo = createFakeForumRepository()
    const { useCase } = createUseCase(repo)

    const state = useCase.hydrate()

    expect(state.status).toBe('idle')
    expect(repo.postsQueries).toHaveLength(0)
  })

  it('有缓存时同步产出 ready + fromCache，并给出派生摘要与匿名展示名', () => {
    const repo = createFakeForumRepository()
    const { useCase } = createUseCase(repo, createFakeCache({ [CACHE_KEY]: cachedList() }))

    const state = useCase.hydrate()

    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(true)
    expect(state.activeBoardId).toBe('fb-1')
    expect(state.nextCursor).toBe('fp-1')
    expect(state.total).toBe(2)
    expect(state.posts[0]?.authorName).toBe('匿名同学')
    expect(repo.postsQueries).toHaveLength(0)
  })

  it('缓存形状非法时视为没有缓存（防御旧版本写入）', () => {
    const { useCase } = createUseCase(
      createFakeForumRepository(),
      createFakeCache({ [CACHE_KEY]: { posts: 'nope' } }),
    )
    expect(useCase.hydrate().status).toBe('idle')
  })

  it('hydrate 幂等：第二次调用不覆盖已有状态', () => {
    const { useCase } = createUseCase(createFakeForumRepository(), createFakeCache({ [CACHE_KEY]: cachedList() }))
    expect(useCase.hydrate().status).toBe('ready')
    expect(useCase.hydrate().status).toBe('ready')
  })
})

describe('listForumPosts · load（契约 §8 第 3 步）', () => {
  it('成功：ready + fromCache=false，写回缓存，并把 boardId 记进状态', async () => {
    const repo = createFakeForumRepository({
      posts: [
        {
          ok: true,
          value: { items: [forumPost('fp-1'), forumPost('fp-2')], nextCursor: null, total: 2 },
        },
      ],
    })
    const { useCase, cache } = createUseCase(repo)

    const state = await useCase.load({ boardId: 'fb-1', keyword: '食堂' })

    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(false)
    expect(state.posts).toHaveLength(2)
    expect(state.activeBoardId).toBe('fb-1')
    expect(state.keyword).toBe('食堂')
    expect(repo.postsQueries[0]).toMatchObject({ boardId: 'fb-1', keyword: '食堂', cursor: null })
    expect(cache.dump()[CACHE_KEY]).toBeDefined()
  })

  it('结果为空：status = empty（而不是 ready + 空数组）', async () => {
    const repo = createFakeForumRepository({
      posts: [{ ok: true, value: { items: [], nextCursor: null, total: 0 } }],
    })
    const { useCase } = createUseCase(repo)
    expect((await useCase.load()).status).toBe('empty')
  })

  it('失败且无缓存：status = error 并暴露文案', async () => {
    const repo = createFakeForumRepository({ posts: [{ ok: false, error: upstreamError('服务端 500') }] })
    const { useCase } = createUseCase(repo)

    const state = await useCase.load()

    expect(state.status).toBe('error')
    expect(state.error).toBe('服务端 500')
    expect(state.posts).toEqual([])
  })

  it('失败但有缓存：静默降级，仍展示缓存主题（契约 §8）', async () => {
    const repo = createFakeForumRepository({ posts: [{ ok: false, error: upstreamError() }] })
    const { useCase } = createUseCase(repo, createFakeCache({ [CACHE_KEY]: cachedList() }))
    useCase.hydrate()

    const state = await useCase.load()

    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(true)
    expect(state.error).toBe('网络不可用')
    expect(state.posts).toHaveLength(1)
  })

  it('未显式传 boardId 时沿用当前筛选（便于下拉刷新）', async () => {
    const repo = createFakeForumRepository({
      posts: [
        { ok: true, value: { items: [forumPost('fp-1')], nextCursor: null, total: 1 } },
        { ok: true, value: { items: [forumPost('fp-1')], nextCursor: null, total: 1 } },
      ],
    })
    const { useCase } = createUseCase(repo)

    await useCase.load({ boardId: 'fb-9' })
    await useCase.load()

    expect(repo.postsQueries[1]?.boardId).toBe('fb-9')
  })
})

describe('listForumPosts · loadMore（游标续页，onReachBottom）', () => {
  it('用上一页的 nextCursor 请求下一页并追加', async () => {
    const repo = createFakeForumRepository({
      posts: [
        { ok: true, value: { items: [forumPost('fp-1')], nextCursor: 'fp-1', total: 2 } },
        { ok: true, value: { items: [forumPost('fp-2')], nextCursor: null, total: 2 } },
      ],
    })
    const { useCase } = createUseCase(repo)

    await useCase.load({ boardId: 'fb-1' })
    const state = await useCase.loadMore()

    expect(repo.postsQueries[1]?.cursor).toBe('fp-1')
    expect(state.posts.map((item) => item.id)).toEqual(['fp-1', 'fp-2'])
    expect(state.nextCursor).toBeNull()
    expect(state.loadingMore).toBe(false)
  })

  it('没有下一页时是空操作（不发请求）', async () => {
    const repo = createFakeForumRepository({
      posts: [{ ok: true, value: { items: [forumPost('fp-1')], nextCursor: null, total: 1 } }],
    })
    const { useCase } = createUseCase(repo)

    await useCase.load()
    const state = await useCase.loadMore()

    expect(repo.postsQueries).toHaveLength(1)
    expect(state.posts).toHaveLength(1)
  })

  it('续页失败时保留已加载数据，只挂错误文案', async () => {
    const repo = createFakeForumRepository({
      posts: [
        { ok: true, value: { items: [forumPost('fp-1')], nextCursor: 'fp-1', total: 2 } },
        { ok: false, error: upstreamError('请求超时') },
      ],
    })
    const { useCase } = createUseCase(repo)

    await useCase.load()
    const state = await useCase.loadMore()

    expect(state.posts).toHaveLength(1)
    expect(state.error).toBe('请求超时')
    expect(state.loadingMore).toBe(false)
  })
})

describe('listForumPosts · selectBoard 与订阅稳定性', () => {
  it('切换版块会清空列表与游标，等待调用方重新 load', async () => {
    const repo = createFakeForumRepository({
      posts: [{ ok: true, value: { items: [forumPost('fp-1')], nextCursor: 'fp-1', total: 5 } }],
    })
    const { useCase } = createUseCase(repo)
    await useCase.load({ boardId: 'fb-1' })

    const state = useCase.selectBoard('fb-2')

    expect(state.activeBoardId).toBe('fb-2')
    expect(state.posts).toEqual([])
    expect(state.nextCursor).toBeNull()
    expect(state.status).toBe('idle')
  })

  it('未变更时 getSnapshot 返回同一引用（useSyncExternalStore 硬要求）', () => {
    const { useCase } = createUseCase(createFakeForumRepository())
    expect(useCase.getSnapshot()).toBe(useCase.getSnapshot())
  })

  it('变更时通知订阅者，取消订阅后不再通知', async () => {
    const repo = createFakeForumRepository({
      posts: [
        { ok: true, value: { items: [forumPost('fp-1')], nextCursor: null, total: 1 } },
        { ok: true, value: { items: [forumPost('fp-2')], nextCursor: null, total: 1 } },
      ],
    })
    const { useCase } = createUseCase(repo)

    let notified = 0
    const unsubscribe = useCase.subscribe(() => {
      notified += 1
    })

    await useCase.load()
    const afterFirst = notified
    expect(afterFirst).toBeGreaterThan(0)

    unsubscribe()
    await useCase.load()
    expect(notified).toBe(afterFirst)
  })
})
