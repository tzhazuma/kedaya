import { describe, expect, it } from 'vitest'

import { createCreateForumPostUseCase } from '../createForumPost'
import { __resetIdempotencyCounterForTests } from '../../idempotency'
import {
  TEST_NOW_ISO,
  TEST_PROFILE,
  createFakeForumRepository,
  createFakeSessionStore,
  fixedClock,
  forumPost,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * 发帖用例测试 —— 会话门 → 本地校验 → 仓储写动作（带幂等键）。
 */

function createUseCase(
  repository: ReturnType<typeof createFakeForumRepository>,
  profile = TEST_PROFILE as typeof TEST_PROFILE | null,
) {
  return createCreateForumPostUseCase({
    repository,
    session: createFakeSessionStore(profile),
    clock: fixedClock(TEST_NOW_ISO),
  })
}

const VALID_DRAFT = {
  boardId: 'fb-1',
  title: '食堂窗口换了',
  body: '今天去发现换师傅了。',
  tags: ['食堂'],
}

describe('createForumPost · 会话与校验', () => {
  it('未登录直接返回 UNAUTHENTICATED，不发请求', async () => {
    const repo = createFakeForumRepository()
    const result = await createUseCase(repo, null).submit(VALID_DRAFT)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('UNAUTHENTICATED')
      expect(result.error.message).toContain('登录')
    }
    expect(repo.createdPosts).toHaveLength(0)
  })

  it('校验失败返回 VALIDATION_FAILED 并带上字段级 details，不发请求', async () => {
    const repo = createFakeForumRepository()
    const result = await createUseCase(repo).submit({ ...VALID_DRAFT, title: '   ' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
      expect(result.error.details).toMatchObject({ errors: [{ field: 'title' }] })
    }
    expect(repo.createdPosts).toHaveLength(0)
  })

  it('敏感词命中同样被本地拦截', async () => {
    const repo = createFakeForumRepository()
    const result = await createUseCase(repo).submit({ ...VALID_DRAFT, body: '求代考' })

    expect(result.ok).toBe(false)
    expect(repo.createdPosts).toHaveLength(0)
  })

  it('validate() 是纯本地校验，不触发网络', () => {
    const repo = createFakeForumRepository()
    const useCase = createUseCase(repo)

    expect(useCase.validate(VALID_DRAFT).valid).toBe(true)
    expect(useCase.validate({ ...VALID_DRAFT, body: '' }).valid).toBe(false)
    expect(repo.createdPosts).toHaveLength(0)
  })
})

describe('createForumPost · 提交成功', () => {
  it('传递规范化后的内容、作者与匿名开关，并带 Idempotency-Key', async () => {
    __resetIdempotencyCounterForTests()
    const repo = createFakeForumRepository({
      createPost: { ok: true, value: forumPost('fp-new', { title: '食堂窗口换了' }) },
    })

    const result = await createUseCase(repo).submit({
      ...VALID_DRAFT,
      title: '  食堂窗口换了  ',
      anonymous: true,
    })

    expect(result.ok).toBe(true)
    expect(repo.createdPosts).toHaveLength(1)
    const input = repo.createdPosts[0]
    expect(input).toMatchObject({
      boardId: 'fb-1',
      title: '食堂窗口换了',
      tags: ['食堂'],
      anonymous: true,
      authorId: TEST_PROFILE.id,
      authorName: TEST_PROFILE.nickname,
    })
    // 契约 §11.3：POST 必须带 Idempotency-Key
    expect(input?.idempotencyKey).toBeTruthy()
    expect(input?.idempotencyKey).toContain('forum:post')
  })

  it('每次提交生成不同的幂等键（同一毫秒内也不会撞）', async () => {
    __resetIdempotencyCounterForTests()
    const repo = createFakeForumRepository()
    const useCase = createUseCase(repo)

    await useCase.submit(VALID_DRAFT)
    await useCase.submit(VALID_DRAFT)

    expect(repo.createdPosts[0]?.idempotencyKey).not.toBe(repo.createdPosts[1]?.idempotencyKey)
  })

  it('显式传入幂等键时原样复用（失败后重试同一次提交）', async () => {
    const repo = createFakeForumRepository()
    await createUseCase(repo).submit({ ...VALID_DRAFT, idempotencyKey: 'fixed-key-1' })
    expect(repo.createdPosts[0]?.idempotencyKey).toBe('fixed-key-1')
  })

  it('返回派生摘要与 PII 提示', async () => {
    const repo = createFakeForumRepository({
      createPost: { ok: true, value: forumPost('fp-new', { title: '找失主', body: '联系 13800138000' }) },
    })

    const result = await createUseCase(repo).submit({
      ...VALID_DRAFT,
      title: '找失主',
      body: '联系 13800138000',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.summary.id).toBe('fp-new')
      expect(result.value.warnings).toHaveLength(1)
    }
  })

  it('仓储失败原样上抛（不吞错）', async () => {
    const repo = createFakeForumRepository({ createPost: { ok: false, error: upstreamError('发帖太频繁') } })
    const result = await createUseCase(repo).submit(VALID_DRAFT)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe('发帖太频繁')
  })
})
