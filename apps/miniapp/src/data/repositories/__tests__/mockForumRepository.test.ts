import { describe, expect, it } from 'vitest'

import { createMockForumRepository } from '../mockForumRepository'
import { createForumMemoryDatabase } from '../../mock/forumMemoryDatabase'
import {
  MOCK_FORUM_BOARDS,
  MOCK_FORUM_POSTS,
  MOCK_FORUM_REPLIES,
} from '../../mock/forumFixtures'
import { FORUM_REPORT_HIDE_THRESHOLD } from '../../../domain/models/forum'

/**
 * Mock 论坛仓储测试 —— 游标分页、治理规则、写动作与三态控制面。
 *
 * 这些断言同时是「UI 三态是真实触发的，不是硬编码」的证据：
 * `failNextRequests` / `clearAll` / `reset` 都真的改变仓储行为。
 */

const NOW = new Date('2026-10-16T12:00:00.000Z')

function createRepo(latencyMs = 0) {
  return createMockForumRepository({ latencyMs, now: () => NOW })
}

describe('mockForumRepository · 列表与游标分页', () => {
  it('第一页返回 nextCursor，第二页用游标续上且不重复', async () => {
    const repo = createRepo()

    const first = await repo.listPosts({ limit: 2 })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    expect(first.value.items).toHaveLength(2)
    expect(first.value.nextCursor).not.toBeNull()

    const second = await repo.listPosts({ limit: 2, cursor: first.value.nextCursor })
    expect(second.ok).toBe(true)
    if (!second.ok) return

    const firstIds = first.value.items.map((post) => post.id)
    const secondIds = second.value.items.map((post) => post.id)
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false)
  })

  it('列表不含 HIDDEN / DELETED / DRAFT（治理状态不进普通列表）', async () => {
    const repo = createRepo()
    const result = await repo.listPosts({ limit: 50 })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const ids = result.value.items.map((post) => post.id)
    expect(ids).not.toContain('fp-2007') // HIDDEN
    expect(ids).not.toContain('fp-2008') // DELETED
    expect(ids).not.toContain('fp-2009') // DRAFT
    expect(ids).toContain('fp-2001')
  })

  it('置顶主题排在首位', async () => {
    const repo = createRepo()
    const result = await repo.listPosts({ limit: 50 })
    expect(result.ok && result.value.items[0]?.id).toBe('fp-2001')
  })

  it('按版块筛选与关键词筛选', async () => {
    const repo = createRepo()

    const byBoard = await repo.listPosts({ boardId: 'fb-study', limit: 50 })
    expect(byBoard.ok && byBoard.value.items.every((post) => post.boardId === 'fb-study')).toBe(true)

    const byKeyword = await repo.listPosts({ keyword: '空调', limit: 50 })
    expect(byKeyword.ok && byKeyword.value.items.map((post) => post.id)).toEqual(['fp-2002'])
  })

  it('详情能取到 HIDDEN 主题（详情页需要如实展示治理状态）', async () => {
    const repo = createRepo()
    const result = await repo.postDetail('fp-2007')
    expect(result.ok && result.value.status).toBe('HIDDEN')
  })

  it('详情不存在返回 NOT_FOUND', async () => {
    const repo = createRepo()
    const result = await repo.postDetail('fp-missing')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('回复列表按时间升序 + 游标分页，且包含 HIDDEN（过滤是 UI/用例层的事）', async () => {
    const repo = createRepo()

    const first = await repo.listReplies('fp-2001', { limit: 3 })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    expect(first.value.items.map((reply) => reply.id)).toEqual(['fr-3001', 'fr-3002', 'fr-3003'])
    expect(first.value.nextCursor).toBe('fr-3003')

    const second = await repo.listReplies('fp-2001', { limit: 3, cursor: first.value.nextCursor })
    expect(second.ok && second.value.items.map((reply) => reply.id)).toEqual([
      'fr-3004',
      'fr-3005',
      'fr-3006',
    ])
  })

  it('返回的是深拷贝：改动结果不会污染数据库', async () => {
    const repo = createRepo()
    const first = await repo.listPosts({ limit: 1 })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const post = first.value.items[0]
    if (post !== undefined) post.title = '被外部改坏了'

    const again = await repo.listPosts({ limit: 1 })
    expect(again.ok && again.value.items[0]?.title).not.toBe('被外部改坏了')
  })
})

describe('mockForumRepository · 写动作', () => {
  it('发帖成功后出现在列表首位，版块计数 +1', async () => {
    const repo = createRepo()

    const created = await repo.createPost({
      boardId: 'fb-campus',
      title: '新帖子',
      body: '正文',
      tags: ['测试'],
      anonymous: true,
      authorId: 'u-me',
      authorName: '可达鸭测试号',
      idempotencyKey: 'k1',
    })

    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.status).toBe('PUBLISHED')
    expect(created.value.authorName).toBe('匿名同学')

    const list = await repo.listPosts({ boardId: 'fb-campus', limit: 50 })
    expect(list.ok && list.value.items.map((post) => post.id)).toContain(created.value.id)
    // 列表是「置顶优先 + 创建时间倒序」：fp-2001 是置顶种子，新帖紧随其后
    expect(list.ok && list.value.items[0]?.id).toBe('fp-2001')
    expect(list.ok && list.value.items[1]?.id).toBe(created.value.id)

    const boards = await repo.listBoards()
    const campus = boards.ok ? boards.value.find((board) => board.id === 'fb-campus') : undefined
    expect(campus?.postCount).toBe(MOCK_FORUM_BOARDS[0]!.postCount + 1)
  })

  it('回复 PUBLISHED 主题成功，并让 replyCount +1', async () => {
    const repo = createRepo()
    const before = await repo.postDetail('fp-2001')
    expect(before.ok).toBe(true)
    if (!before.ok) return

    const reply = await repo.createReply({
      postId: 'fp-2001',
      body: '我也来说一句',
      anonymous: false,
      authorId: 'u-me',
      authorName: '可达鸭测试号',
      idempotencyKey: 'k2',
    })

    expect(reply.ok).toBe(true)
    const after = await repo.postDetail('fp-2001')
    expect(after.ok && after.value.replyCount).toBe(before.value.replyCount + 1)
  })

  it('回复 LOCKED 主题返回 CONFLICT（规则来自 domain）', async () => {
    const repo = createRepo()
    const result = await repo.createReply({
      postId: 'fp-2005',
      body: '还能回吗',
      anonymous: false,
      authorId: 'u-me',
      authorName: '可达鸭测试号',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT')
      expect(result.error.details).toMatchObject({ reason: 'locked' })
    }
  })

  it('回复不存在的主题返回 NOT_FOUND', async () => {
    const repo = createRepo()
    const result = await repo.createReply({
      postId: 'fp-missing',
      body: '有人吗',
      anonymous: false,
      authorId: 'u-me',
      authorName: '可达鸭测试号',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })
})

describe('mockForumRepository · 举报与治理阈值', () => {
  function report(repo: ReturnType<typeof createRepo>, reporterId: string, targetId = 'fp-2003') {
    return repo.report({
      targetType: 'POST',
      targetId,
      reason: 'spam',
      reporterId,
      anonymous: false,
    })
  }

  it('同一用户重复举报返回 CONFLICT（幂等语义）', async () => {
    const repo = createRepo()
    const first = await report(repo, 'u-1')
    const second = await report(repo, 'u-1')

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('CONFLICT')
  })

  it(`达到 ${FORUM_REPORT_HIDE_THRESHOLD} 个不同用户举报后，目标自动 HIDDEN`, async () => {
    const repo = createRepo()

    for (let index = 0; index < FORUM_REPORT_HIDE_THRESHOLD; index += 1) {
      const result = await report(repo, `u-${index}`)
      expect(result.ok).toBe(true)
    }

    const detail = await repo.postDetail('fp-2003')
    expect(detail.ok && detail.value.status).toBe('HIDDEN')

    const list = await repo.listPosts({ limit: 50 })
    expect(list.ok && list.value.items.map((post) => post.id)).not.toContain('fp-2003')
  })

  it('同一用户重复举报不推进阈值（必须「不同用户」）', async () => {
    const repo = createRepo()
    await report(repo, 'u-1')
    await report(repo, 'u-1')
    await report(repo, 'u-1')

    const detail = await repo.postDetail('fp-2003')
    expect(detail.ok && detail.value.status).toBe('PUBLISHED')
  })

  it('可以举报回复（targetType = REPLY）', async () => {
    const repo = createRepo()
    const result = await repo.report({
      targetType: 'REPLY',
      targetId: 'fr-3001',
      reason: 'abuse',
      reporterId: 'u-1',
      anonymous: true,
    })
    expect(result.ok && result.value.targetType).toBe('REPLY')
  })
})

describe('mockForumRepository · 三态控制面（演示用）', () => {
  it('failNextRequests 只影响接下来的 N 次请求', async () => {
    const repo = createRepo()
    repo.failNextRequests(1)

    const failed = await repo.listPosts()
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    const recovered = await repo.listPosts()
    expect(recovered.ok).toBe(true)
  })

  it('clearAll 制造空态，reset 恢复种子数据', async () => {
    const repo = createRepo()

    repo.clearAll()
    const empty = await repo.listPosts()
    expect(empty.ok && empty.value.items).toEqual([])

    repo.reset()
    const restored = await repo.listPosts({ limit: 50 })
    expect(restored.ok && restored.value.items.length).toBeGreaterThan(0)
  })

  it('reset 同时清掉失败计数', async () => {
    const repo = createRepo()
    repo.failNextRequests(5)
    repo.reset()
    const result = await repo.listPosts()
    expect(result.ok).toBe(true)
  })

  it('版块列表与种子一致（且是拷贝）', async () => {
    const repo = createRepo()
    const boards = await repo.listBoards()
    expect(boards.ok && boards.value).toHaveLength(MOCK_FORUM_BOARDS.length)
  })

  it('用独立的内存数据库时互不影响（测试隔离）', async () => {
    const db = createForumMemoryDatabase(MOCK_FORUM_BOARDS, MOCK_FORUM_POSTS, MOCK_FORUM_REPLIES)
    const repo = createMockForumRepository({ latencyMs: 0, now: () => NOW, database: db })

    await repo.createPost({
      boardId: 'fb-campus',
      title: '只在本地库里的帖子',
      body: '正文',
      tags: [],
      anonymous: false,
      authorId: 'u-me',
      authorName: '可达鸭测试号',
    })

    const fresh = createRepo()
    const list = await fresh.listPosts({ limit: 50 })
    expect(list.ok && list.value.items.map((post) => post.title)).not.toContain('只在本地库里的帖子')
  })
})
