import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import { canInitiateBinding, createBindCampusUseCase } from '../bindCampus'
import {
  TEST_NOW_ISO,
  TEST_PROFILE,
  TEST_TOKENS,
  campusBinding,
  createFakeSessionStore,
  createFakeTechpieRepository,
  fixedClock,
} from '../../__tests__/testDoubles'
import { createLogPort, createMemorySink } from '../../../platform/log'
import { __resetIdempotencyCounterForTests } from '../../idempotency'

/**
 * 绑定动作用例 —— 契约 §11.18-D（Phase 0 只允许校园卡）+ 规格 §10.3（日志脱敏）。
 */

const CREDENTIAL = { channel: 'wechat-openid' as const, wechatLoginCode: 'wx-code-SECRET-123' }

function setup(options: Parameters<typeof createFakeTechpieRepository>[0] = {}, signedIn = true) {
  const repository = createFakeTechpieRepository(options)
  const session = createFakeSessionStore(signedIn ? TEST_PROFILE : null, signedIn ? TEST_TOKENS : null)
  const sink = createMemorySink()
  const log = createLogPort({ sink, now: () => new Date(TEST_NOW_ISO) })
  const useCase = createBindCampusUseCase({
    repository,
    session,
    clock: fixedClock(TEST_NOW_ISO),
    log,
  })
  return { repository, session, sink, log, useCase }
}

describe('application · techpie · bindCampus（Phase 0 只允许校园卡）', () => {
  it('绑定校园卡：带 OPENID 通道凭证 + 幂等键（契约 §11.3）', async () => {
    __resetIdempotencyCounterForTests()
    const { repository, useCase } = setup({ create: ok(campusBinding('tpl-new')) })

    const result = await useCase.bindEcard(CREDENTIAL)

    expect(result.ok).toBe(true)
    expect(repository.created).toHaveLength(1)
    expect(repository.created[0]?.input.provider).toBe('ecard')
    expect(repository.created[0]?.input.credential).toEqual(CREDENTIAL)
    expect(repository.created[0]?.idempotencyKey).toMatch(/^techpie-bind:/)
    expect(useCase.getSnapshot().notice).toBe('校园卡绑定成功')
  })

  it('⚠️ Phase 1 平台的绑定请求**根本不发出去**（契约 §11.18-D）', () => {
    const { repository, useCase } = setup()

    for (const platform of ['egate', 'cpdaily', 'cas', 'techpie'] as const) {
      const result = useCase.requestPhase1Binding(platform)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('FORBIDDEN')
        expect(result.error.message).toContain('信息办')
      }
    }

    // 关键断言：一次网络调用都没有发生
    expect(repository.totalCalls).toBe(0)
  })

  it('canInitiateBinding 与 PHASE0_BINDABLE_PLATFORMS 一致（UI 据此决定画不画按钮）', () => {
    expect(canInitiateBinding('ecard')).toBe(true)
    expect(canInitiateBinding('egate')).toBe(false)
    expect(canInitiateBinding('cpdaily')).toBe(false)
  })

  it('未登录 → UNAUTHENTICATED，且**不发请求**（与"未绑定"区分开）', async () => {
    const { repository, useCase } = setup({}, false)

    const result = await useCase.bindEcard(CREDENTIAL)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(repository.totalCalls).toBe(0)
  })

  it('绑定失败（上游不可用）→ error 状态 + 只记错误码', async () => {
    const { useCase } = setup({
      create: err({ code: 'UPSTREAM_UNAVAILABLE', message: '上游超时' }),
    })
    const result = await useCase.bindEcard(CREDENTIAL)
    expect(result.ok).toBe(false)
    expect(useCase.getSnapshot().status).toBe('error')
    expect(useCase.getSnapshot().error).toBe('上游超时')
  })
})

describe('application · techpie · bindCampus（解绑 / 续期）', () => {
  it('解绑带幂等键；成功后 notice 更新', async () => {
    __resetIdempotencyCounterForTests()
    const { repository, useCase } = setup({ unbind: ok(true) })
    const result = await useCase.unbind('tpl-1')
    expect(result.ok).toBe(true)
    expect(repository.unbinds[0]?.id).toBe('tpl-1')
    expect(repository.unbinds[0]?.idempotencyKey).toMatch(/^techpie-unbind:/)
    expect(useCase.getSnapshot().notice).toBe('已解绑')
  })

  it('⚠️ 续期不被支持时**不谎称成功**（规格 §10.1 的 F3 / R4）', async () => {
    const { useCase } = setup({
      renew: err({
        code: 'CONFLICT',
        message: '该平台的续期能力尚未确认',
        details: { reason: 'RENEW_NOT_SUPPORTED' },
      }),
    })
    const result = await useCase.renew('tpl-1')
    expect(result.ok).toBe(false)
    expect(useCase.getSnapshot().status).toBe('error')
    expect(useCase.getSnapshot().notice).toBeNull()
    expect(useCase.getSnapshot().error).toContain('尚未确认')
  })

  it('未登录时解绑 / 续期都不发请求', async () => {
    const { repository, useCase } = setup({}, false)
    expect((await useCase.unbind('tpl-1')).ok).toBe(false)
    expect((await useCase.renew('tpl-1')).ok).toBe(false)
    expect(repository.totalCalls).toBe(0)
  })
})

describe('application · techpie · bindCampus（规格 §10.3：凭证绝不进日志）', () => {
  it('⚠️ 完整绑定流程的日志里**没有** wx.login code / 密码 / cookie / CASTGC', async () => {
    __resetIdempotencyCounterForTests()
    const { sink, useCase } = setup({ create: ok(campusBinding('tpl-new')) })

    await useCase.bindEcard(CREDENTIAL)

    const dump = JSON.stringify(sink.records)
    expect(sink.records.length).toBeGreaterThan(0)
    expect(dump).not.toContain('SECRET-123')
    expect(dump).not.toMatch(/castgc|tgc=|password|cookie|bearer/i)
    // 该记的还是记了：provider 与 bindingId 用于诊断
    expect(dump).toContain('ecard')
    expect(dump).toContain('tpl-new')
  })

  it('失败路径只记错误码，**不记**上游 message（message 可能回显凭证）', async () => {
    __resetIdempotencyCounterForTests()
    const { sink, useCase } = setup({
      create: err({
        code: 'CONFLICT',
        message: '凭证错误：CASTGC=TGT-LEAKED 无效',
      }),
    })

    await useCase.bindEcard(CREDENTIAL)

    const dump = JSON.stringify(sink.records)
    expect(dump).not.toContain('TGT-LEAKED')
    expect(dump).not.toContain('无效')
    expect(dump).toContain('CONFLICT')
  })

  it('把整个请求体当字段传进来也不会泄漏（白名单剔除的兜底证明）', async () => {
    __resetIdempotencyCounterForTests()
    const sink = createMemorySink()
    const log = createLogPort({ sink, now: () => new Date(TEST_NOW_ISO) })

    // 模拟"后来者手滑"：把整个 input（含凭证）作为日志字段
    log.info('techpie.binding.create.started', {
      provider: 'ecard',
      phase: 'phase0',
      ...{ credential: CREDENTIAL, password: 'hunter2' },
    })

    const dump = JSON.stringify(sink.records)
    expect(dump).not.toContain('SECRET-123')
    expect(dump).not.toContain('hunter2')
    expect(dump).toContain('ecard')
  })
})
