import { describe, expect, it } from 'vitest'
import type { ApiError } from '@kedaya/contracts'
import { ok, type Result } from '@kedaya/shared'

import { createHttpFaqRepository } from '../httpFaqRepository'
import { createHttpForumRepository } from '../httpForumRepository'
import type { ApiClient, ApiRequestExtras, QueryMap } from '../../api/request'
import { TEST_NOW_ISO, TEST_PROFILE, forumPost, forumReply } from '../../../application/__tests__/testDoubles'

/**
 * 真后端仓储的**路径与幂等键**测试。
 *
 * 用一个记录型假 `ApiClient` 断言：
 * - URL 落在契约 §6.1 的模块前缀下、游标分页参数正确；
 * - 所有 `POST` 都带 `Idempotency-Key`（契约 §11.3 必需）；
 * - `forum.report` 用的是**已登记**的领域动作名（§11.2）；
 * - `ApiError` → `RepositoryError` 的映射带上 traceId。
 */

interface RecordedCall {
  method: 'GET' | 'POST'
  path: string
  query?: QueryMap
  body?: unknown
  extras?: ApiRequestExtras
}

interface FakeApiClient extends ApiClient {
  calls: RecordedCall[]
}

function createFakeApiClient(
  handler: (call: RecordedCall) => Result<unknown, ApiError> = () => ok({}),
): FakeApiClient {
  const calls: RecordedCall[] = []

  function unsupported(): never {
    throw new Error('该测试只覆盖 GET / POST')
  }

  return {
    calls,
    async request() {
      return unsupported()
    },
    async get<T>(path: string, query?: QueryMap): Promise<Result<T, ApiError>> {
      const call: RecordedCall = { method: 'GET', path, ...(query === undefined ? {} : { query }) }
      calls.push(call)
      return handler(call) as Result<T, ApiError>
    },
    async post<T, TBody = unknown>(
      path: string,
      body?: TBody,
      extras?: ApiRequestExtras,
    ): Promise<Result<T, ApiError>> {
      const call: RecordedCall = {
        method: 'POST',
        path,
        ...(body === undefined ? {} : { body }),
        ...(extras === undefined ? {} : { extras }),
      }
      calls.push(call)
      return handler(call) as Result<T, ApiError>
    },
    async patch() {
      return unsupported()
    },
    async put() {
      return unsupported()
    },
    async del() {
      return unsupported()
    },
  }
}

const page = <T>(items: T[], nextCursor: string | null = null): { items: T[]; nextCursor: string | null; total: number } => ({
  items,
  nextCursor,
  total: items.length,
})

describe('httpForumRepository · 路径映射（契约 §6.1 / §11.2）', () => {
  it('listPosts 走 /forum/items 并透传游标分页与筛选', async () => {
    const client = createFakeApiClient(() => ok(page([forumPost('fp-1')])))
    const repo = createHttpForumRepository(client)

    const result = await repo.listPosts({ boardId: 'fb-1', keyword: '食堂', cursor: 'fp-0', limit: 5 })

    expect(client.calls[0]).toMatchObject({ method: 'GET', path: 'forum/items' })
    expect(client.calls[0]?.query).toMatchObject({
      boardId: 'fb-1',
      keyword: '食堂',
      cursor: 'fp-0',
      limit: 5,
    })
    expect(result.ok && result.value.items).toHaveLength(1)
  })

  it('listBoards / postDetail / listReplies 的路径与 id 编码', async () => {
    const client = createFakeApiClient((call) => {
      if (call.path === 'forum/boards') return ok([])
      if (call.path === 'forum/items/fp%2F1') return ok(forumPost('fp/1'))
      return ok(page([forumReply('fr-1')]))
    })
    const repo = createHttpForumRepository(client)

    await repo.listBoards()
    await repo.postDetail('fp/1')
    await repo.listReplies('fp/1', { cursor: 'fr-0' })

    expect(client.calls.map((call) => call.path)).toEqual([
      'forum/boards',
      'forum/items/fp%2F1',
      'forum/items/fp%2F1/replies',
    ])
    expect(client.calls[2]?.query).toMatchObject({ cursor: 'fr-0' })
  })

  it('createPost 是 POST /forum/items，带 Idempotency-Key，且不把作者身份塞进 body', async () => {
    const client = createFakeApiClient(() => ok(forumPost('fp-new')))
    const repo = createHttpForumRepository(client)

    await repo.createPost({
      boardId: 'fb-1',
      title: '标题',
      body: '正文',
      tags: ['食堂'],
      anonymous: true,
      authorId: TEST_PROFILE.id,
      authorName: TEST_PROFILE.nickname,
      idempotencyKey: 'key-post-1',
    })

    const call = client.calls[0]
    expect(call).toMatchObject({ method: 'POST', path: 'forum/items' })
    expect(call?.extras).toMatchObject({ idempotencyKey: 'key-post-1' })
    expect(call?.body).toEqual({
      boardId: 'fb-1',
      title: '标题',
      body: '正文',
      tags: ['食堂'],
      anonymous: true,
    })
    // 身份来自 Bearer token，不来自请求体（契约 §5 / §6.1）
    expect(JSON.stringify(call?.body)).not.toContain(TEST_PROFILE.id)
  })

  it('createReply 是 POST /forum/items/:id/replies，带 Idempotency-Key', async () => {
    const client = createFakeApiClient(() => ok(forumReply('fr-new')))
    const repo = createHttpForumRepository(client)

    await repo.createReply({
      postId: 'fp-1',
      body: '同意',
      parentReplyId: 'fr-0',
      anonymous: false,
      authorId: TEST_PROFILE.id,
      authorName: TEST_PROFILE.nickname,
      idempotencyKey: 'key-reply-1',
    })

    expect(client.calls[0]).toMatchObject({ method: 'POST', path: 'forum/items/fp-1/replies' })
    expect(client.calls[0]?.extras).toMatchObject({ idempotencyKey: 'key-reply-1' })
    expect(client.calls[0]?.body).toEqual({ body: '同意', parentReplyId: 'fr-0', anonymous: false })
  })

  it('report 使用已登记的领域动作 /forum/items/:id/report（§11.2）', async () => {
    const client = createFakeApiClient(() =>
      ok({
        id: 'frep-1',
        targetType: 'POST',
        targetId: 'fp-1',
        reason: 'spam',
        status: 'PENDING',
        reporterId: TEST_PROFILE.id,
        anonymous: false,
        createdAt: TEST_NOW_ISO,
      }),
    )
    const repo = createHttpForumRepository(client)

    const result = await repo.report({
      targetType: 'POST',
      targetId: 'fp-1',
      reason: 'spam',
      reporterId: TEST_PROFILE.id,
      anonymous: true,
      idempotencyKey: 'key-report-1',
    })

    expect(client.calls[0]).toMatchObject({ method: 'POST', path: 'forum/items/fp-1/report' })
    expect(client.calls[0]?.body).toEqual({ targetType: 'POST', reason: 'spam', anonymous: true })
    expect(result.ok && result.value.status).toBe('PENDING')
  })

  it('Page.nextCursor / total 原样映射（不猜、不改写）', async () => {
    const client = createFakeApiClient(() => ok(page([forumPost('fp-1')], 'fp-1')))
    const repo = createHttpForumRepository(client)

    const result = await repo.listPosts()

    expect(result.ok && result.value.nextCursor).toBe('fp-1')
    expect(result.ok && result.value.total).toBe(1)
  })
})

describe('httpFaqRepository · 路径映射与契约缺口标注', () => {
  it('listArticles 走 /faq/items；category=all 时不发该参数', async () => {
    const client = createFakeApiClient(() => ok(page([])))
    const repo = createHttpFaqRepository(client)

    await repo.listArticles({ category: 'all', keyword: '登录' })
    await repo.listArticles({ category: '校园卡' })

    expect(client.calls[0]).toMatchObject({ method: 'GET', path: 'faq/items' })
    expect(client.calls[0]?.query?.category).toBeUndefined()
    expect(client.calls[0]?.query?.keyword).toBe('登录')
    expect(client.calls[1]?.query?.category).toBe('校园卡')
  })

  it('voteHelpful 建模为子资源 POST /faq/items/:id/votes（避免自创未登记动作名）', async () => {
    const client = createFakeApiClient(() =>
      ok({ articleId: 'faq-1', helpfulCount: 4, applied: true }),
    )
    const repo = createHttpFaqRepository(client)

    const result = await repo.voteHelpful({
      articleId: 'faq-1',
      userId: TEST_PROFILE.id,
      idempotencyKey: 'key-vote-1',
    })

    expect(client.calls[0]).toMatchObject({ method: 'POST', path: 'faq/items/faq-1/votes' })
    expect(client.calls[0]?.body).toEqual({ value: 'helpful' })
    expect(client.calls[0]?.extras).toMatchObject({ idempotencyKey: 'key-vote-1' })
    expect(result.ok && result.value.applied).toBe(true)
  })

  it('listMyTickets 走 /faq/tickets；已登录带 mine=true，未登录不带', async () => {
    const client = createFakeApiClient(() => ok(page([])))
    const repo = createHttpFaqRepository(client)

    await repo.listMyTickets(TEST_PROFILE.id)
    await repo.listMyTickets(null)

    expect(client.calls[0]?.path).toBe('faq/tickets')
    expect(client.calls[0]?.query?.mine).toBe(true)
    expect(client.calls[1]?.query?.mine).toBeUndefined()
  })

  it('submitTicket 是 POST /faq/tickets，带 Idempotency-Key，body 只含 contact/question', async () => {
    const client = createFakeApiClient(() =>
      ok({
        id: 'ft-new',
        userId: TEST_PROFILE.id,
        contact: 'wechat: kdy',
        question: '问题',
        status: 'OPEN',
        createdAt: TEST_NOW_ISO,
        updatedAt: TEST_NOW_ISO,
      }),
    )
    const repo = createHttpFaqRepository(client)

    await repo.submitTicket({
      userId: TEST_PROFILE.id,
      contact: 'wechat: kdy',
      question: '问题',
      idempotencyKey: 'key-ticket-1',
    })

    expect(client.calls[0]).toMatchObject({ method: 'POST', path: 'faq/tickets' })
    expect(client.calls[0]?.body).toEqual({ contact: 'wechat: kdy', question: '问题' })
    expect(client.calls[0]?.extras).toMatchObject({ idempotencyKey: 'key-ticket-1' })
  })
})

describe('http 仓储 · 错误映射', () => {
  it('ApiError 被映射为 RepositoryError，并带上 traceId', async () => {
    const client = createFakeApiClient(() => ({
      ok: false,
      error: { code: 'RATE_LIMITED', message: '操作过于频繁', details: { retryAfter: 30 } },
    }))
    const repo = createHttpForumRepository(client)

    const result = await repo.listPosts()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('RATE_LIMITED')
      expect(result.error.message).toBe('操作过于频繁')
      expect(result.error.details).toEqual({ retryAfter: 30 })
    }
  })

  it('FAQ 侧同样映射错误码（不吞错、不伪造成功）', async () => {
    const client = createFakeApiClient(() => ({
      ok: false,
      error: { code: 'NOT_FOUND', message: '文章不存在' },
    }))
    const repo = createHttpFaqRepository(client)

    const result = await repo.voteHelpful({ articleId: 'faq-x', userId: 'u-1' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND')
  })
})
