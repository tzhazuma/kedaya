import { describe, expect, it } from 'vitest'

import { createReportForumContentUseCase } from '../reportForumContent'
import {
  TEST_NOW_ISO,
  TEST_PROFILE,
  createFakeForumRepository,
  createFakeSessionStore,
  fixedClock,
  upstreamError,
} from '../../__tests__/testDoubles'

/**
 * 举报用例测试 —— 契约 §11.2 已登记动作 `forum.report`。
 *
 * 重点验证两件事：
 * 1. 必须登录（治理阈值依赖真实身份）；
 * 2. 「匿名展示」与 `reporterId` 落库是**解耦**的（契约 §9）。
 */

function createUseCase(
  repository: ReturnType<typeof createFakeForumRepository>,
  profile = TEST_PROFILE as typeof TEST_PROFILE | null,
) {
  return createReportForumContentUseCase({
    repository,
    session: createFakeSessionStore(profile),
    clock: fixedClock(TEST_NOW_ISO),
  })
}

describe('reportForumContent · 前置校验', () => {
  it('未登录返回 UNAUTHENTICATED，不发请求', async () => {
    const repo = createFakeForumRepository()
    const result = await createUseCase(repo, null).submit({
      targetType: 'POST',
      targetId: 'fp-1',
      reason: 'spam',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(repo.reports).toHaveLength(0)
  })

  it('缺少举报对象时返回 VALIDATION_FAILED', async () => {
    const repo = createFakeForumRepository()
    const result = await createUseCase(repo).submit({ targetType: 'POST', targetId: '  ', reason: 'spam' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_FAILED')
    expect(repo.reports).toHaveLength(0)
  })

  it('非法举报理由（运行时数据不可信）被拦截', async () => {
    const repo = createFakeForumRepository()
    const result = await createUseCase(repo).submit({
      targetType: 'POST',
      targetId: 'fp-1',
      reason: 'not-a-reason' as never,
    })

    expect(result.ok).toBe(false)
    expect(repo.reports).toHaveLength(0)
  })
})

describe('reportForumContent · 提交', () => {
  it('带上真实 reporterId 与幂等键；匿名只影响展示', async () => {
    const repo = createFakeForumRepository()
    const result = await createUseCase(repo).submit({
      targetType: 'REPLY',
      targetId: 'fr-1',
      reason: 'abuse',
      anonymous: true,
    })

    expect(result.ok).toBe(true)
    expect(repo.reports[0]).toMatchObject({
      targetType: 'REPLY',
      targetId: 'fr-1',
      reason: 'abuse',
      anonymous: true,
      reporterId: TEST_PROFILE.id,
    })
    expect(repo.reports[0]?.idempotencyKey).toContain('forum:report')
  })

  it('重复举报（仓储返回 CONFLICT）原样上抛，不静默成功', async () => {
    const repo = createFakeForumRepository({
      report: { ok: false, error: { code: 'CONFLICT', message: '你已经举报过这条内容了' } },
    })

    const result = await createUseCase(repo).submit({ targetType: 'POST', targetId: 'fp-1', reason: 'spam' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CONFLICT')
  })

  it('上游失败原样上抛', async () => {
    const repo = createFakeForumRepository({ report: { ok: false, error: upstreamError('服务不可用') } })
    const result = await createUseCase(repo).submit({ targetType: 'POST', targetId: 'fp-1', reason: 'other' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe('服务不可用')
  })

  it('reasonLabel 提供页面可直接展示的中文', () => {
    const useCase = createUseCase(createFakeForumRepository())
    expect(useCase.reasonLabel('privacy')).toBe('泄露隐私')
  })
})
