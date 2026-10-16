import { describe, expect, it } from 'vitest'

import { createListForumBoardsUseCase } from '../listForumBoards'
import type { CachedForumBoardList } from '../listForumBoards'
import {
  TEST_NOW_ISO,
  createFakeCache,
  createFakeForumRepository,
  fixedClock,
  forumBoard,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * 版块用例测试 —— 契约 §8：同步 hydrate、失败静默降级、三态齐全。
 */

const CACHE_KEY = 'test:cache:forum:boards'

function createUseCase(repository: ReturnType<typeof createFakeForumRepository>, cache = createFakeCache()) {
  return {
    cache,
    useCase: createListForumBoardsUseCase({
      repository,
      cache,
      clock: fixedClock(TEST_NOW_ISO),
      cacheKey: CACHE_KEY,
    }),
  }
}

describe('listForumBoards · hydrate（契约 §8 第 1 步）', () => {
  it('无缓存时保持 idle，且不触发任何请求', () => {
    const repo = createFakeForumRepository()
    const { useCase } = createUseCase(repo)

    const state = useCase.hydrate()

    expect(state.status).toBe('idle')
    expect(state.boards).toEqual([])
    expect(repo.boardsQueue).toHaveLength(0)
  })

  it('有缓存时同步产出 ready + fromCache 与派生摘要', () => {
    const cached: CachedForumBoardList = {
      boards: [forumBoard('fb-1', { visibility: 'campus_only', postCount: 3 })],
      updatedAt: '2026-10-16T11:00:00.000Z',
    }
    const { useCase } = createUseCase(createFakeForumRepository(), createFakeCache({ [CACHE_KEY]: cached }))

    const state = useCase.hydrate()

    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(true)
    expect(state.boards[0]?.campusOnly).toBe(true)
    expect(state.boards[0]?.visibilityLabel).toBe('仅校内')
    expect(state.updatedAt).toBe('2026-10-16T11:00:00.000Z')
  })

  it('缓存形状非法时视为没有缓存', () => {
    const { useCase } = createUseCase(
      createFakeForumRepository(),
      createFakeCache({ [CACHE_KEY]: { boards: 'not-an-array' } }),
    )
    expect(useCase.hydrate().status).toBe('idle')
  })
})

describe('listForumBoards · load', () => {
  it('成功：ready + fromCache=false，并写回缓存', async () => {
    const repo = createFakeForumRepository({ boards: [{ ok: true, value: [forumBoard('fb-1')] }] })
    const { useCase, cache } = createUseCase(repo)

    const state = await useCase.load()

    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(false)
    expect(state.boards).toHaveLength(1)
    expect(cache.dump()[CACHE_KEY]).toBeDefined()
  })

  it('返回空数组：status = empty', async () => {
    const repo = createFakeForumRepository({ boards: [{ ok: true, value: [] }] })
    const { useCase } = createUseCase(repo)
    expect((await useCase.load()).status).toBe('empty')
  })

  it('失败且无缓存：status = error 并暴露文案', async () => {
    const repo = createFakeForumRepository({ boards: [{ ok: false, error: upstreamError() }] })
    const { useCase } = createUseCase(repo)

    const state = await useCase.load()

    expect(state.status).toBe('error')
    expect(state.error).toBe('网络不可用')
  })

  it('失败但有缓存：静默降级，仍展示缓存版块（契约 §8）', async () => {
    const cached: CachedForumBoardList = {
      boards: [forumBoard('fb-cached')],
      updatedAt: '2026-10-16T11:00:00.000Z',
    }
    const repo = createFakeForumRepository({ boards: [{ ok: false, error: upstreamError() }] })
    const { useCase } = createUseCase(repo, createFakeCache({ [CACHE_KEY]: cached }))
    useCase.hydrate()

    const state = await useCase.load()

    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(true)
    expect(state.error).toBe('网络不可用')
    expect(state.boards).toHaveLength(1)
  })
})

describe('listForumBoards · 订阅', () => {
  it('未变更时快照引用稳定；变更后引用被替换', async () => {
    const repo = createFakeForumRepository({ boards: [{ ok: true, value: [forumBoard('fb-1')] }] })
    const { useCase } = createUseCase(repo)

    const before = useCase.getSnapshot()
    expect(useCase.getSnapshot()).toBe(before)

    await useCase.load()
    expect(useCase.getSnapshot()).not.toBe(before)
  })

  it('取消订阅后不再收到通知', async () => {
    const repo = createFakeForumRepository({
      boards: [
        { ok: true, value: [forumBoard('fb-1')] },
        { ok: true, value: [forumBoard('fb-2')] },
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
