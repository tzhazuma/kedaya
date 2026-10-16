import { describe, expect, it } from 'vitest'

import { createReplyToPostUseCase } from '../replyToPost'
import {
  TEST_NOW_ISO,
  TEST_PROFILE,
  createFakeForumRepository,
  createFakeSessionStore,
  fixedClock,
  forumPost,
  forumReply,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * 回复用例测试 —— 会话门 → 主题状态机（canReply）→ 本地校验 → 写动作。
 */

function createUseCase(
  repository: ReturnType<typeof createFakeForumRepository>,
  profile = TEST_PROFILE as typeof TEST_PROFILE | null,
) {
  return createReplyToPostUseCase({
    repository,
    session: createFakeSessionStore(profile),
    clock: fixedClock(TEST_NOW_ISO),
  })
}

describe('replyToPost · 前置校验', () => {
  it('未登录返回 UNAUTHENTICATED，不发请求', async () => {
    const repo = createFakeForumRepository()
    const result = await createUseCase(repo, null).submit({ postId: 'fp-1', body: '同意' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(repo.createdReplies).toHaveLength(0)
  })

  it('空回复被本地拦截，不发请求', async () => {
    const repo = createFakeForumRepository()
    const result = await createUseCase(repo).submit({ postId: 'fp-1', body: '   ' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    expect(repo.createdReplies).toHaveLength(0)
  })

  it('LOCKED 主题用 domain 状态机拦截，返回 CONFLICT + reason', async () => {
    const repo = createFakeForumRepository({
      postDetail: { ok: true, value: forumPost('fp-1', { status: 'LOCKED' }) },
    })

    const result = await createUseCase(repo).submit({ postId: 'fp-1', body: '还能回吗' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CONFLICT')
      expect(result.error.details).toMatchObject({ reason: 'locked' })
    }
    expect(repo.createdReplies).toHaveLength(0)
  })

  it('HIDDEN / DELETED 主题同样被拦截', async () => {
    for (const status of ['HIDDEN', 'DELETED', 'DRAFT'] as const) {
      const repo = createFakeForumRepository({
        postDetail: { ok: true, value: forumPost('fp-1', { status }) },
      })
      const result = await createUseCase(repo).submit({ postId: 'fp-1', body: '试试' })
      expect(result.ok).toBe(false)
      expect(repo.createdReplies).toHaveLength(0)
    }
  })

  it('主题详情拉取失败时原样上抛', async () => {
    const repo = createFakeForumRepository({
      postDetail: { ok: false, error: upstreamError('主题不存在') },
    })
    const result = await createUseCase(repo).submit({ postId: 'fp-1', body: '试试' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe('主题不存在')
  })
})

describe('replyToPost · 提交成功', () => {
  it('写入规范化正文、父回复、匿名开关与幂等键，并乐观更新 replyCount', async () => {
    const repo = createFakeForumRepository({
      postDetail: { ok: true, value: forumPost('fp-1', { replyCount: 2 }) },
      createReply: { ok: true, value: forumReply('fr-new') },
    })

    const result = await createUseCase(repo).submit({
      postId: 'fp-1',
      body: '  同意楼上  ',
      parentReplyId: 'fr-1',
      anonymous: true,
    })

    expect(result.ok).toBe(true)
    expect(repo.createdReplies[0]).toMatchObject({
      postId: 'fp-1',
      body: '同意楼上',
      parentReplyId: 'fr-1',
      anonymous: true,
      authorId: TEST_PROFILE.id,
    })
    expect(repo.createdReplies[0]?.idempotencyKey).toContain('forum:reply')
    if (result.ok) {
      expect(result.value.reply.id).toBe('fr-new')
      expect(result.value.post.replyCount).toBe(3)
    }
  })

  it('仓储失败原样上抛', async () => {
    const repo = createFakeForumRepository({
      postDetail: { ok: true, value: forumPost('fp-1') },
      createReply: { ok: false, error: upstreamError('回复太频繁') },
    })
    const result = await createUseCase(repo).submit({ postId: 'fp-1', body: '同意' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe('回复太频繁')
  })
})
