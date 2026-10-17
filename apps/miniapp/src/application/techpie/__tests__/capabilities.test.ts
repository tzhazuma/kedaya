import { describe, expect, it } from 'vitest'
import { err, ok } from '@kedaya/shared'

import { campusViewerOf, createCapabilitiesUseCase, isCachedCapabilities } from '../capabilities'
import {
  TEST_NOW_ISO,
  TEST_PROFILE,
  TEST_TOKENS,
  campusBinding,
  campusCapability,
  createFakeCache,
  createFakeSessionStore,
  createFakeTechpieRepository,
  fixedClock,
} from '../../__tests__/testDoubles'
import { EMPTY_SESSION } from '../../../domain/models/session'

/** 已登录的会话快照（tokens + profile 同时存在才算登录，契约 §5） */
function signedInSession() {
  return createFakeSessionStore(TEST_PROFILE, TEST_TOKENS).getSnapshot()
}

/**
 * 能力清单用例 —— **契约不变式 I4 的客户端验收**。
 *
 * 本文件的核心断言：
 *
 * 1. 未绑定项渲染成**引导**（`GO_BIND` + `CAMPUS_BINDING_REQUIRED` + `isGuidance`），
 *    **不是**错误；
 * 2. 「未登录」与「已登录未绑定」被**区分开**（前者 `UNAUTHENTICATED`，后者 409）；
 * 3. Phase 1+ 能力如实 BLOCKED，不引导用户去绑一个没实现的路径；
 * 4. 三态齐全 + 契约 §8 静默降级。
 */

const CACHE_KEY = 'test:techpie:capabilities'

const CATALOG = [
  campusCapability('ecourse', { nameZh: 'E云课堂', requiredProvider: null }),
  campusCapability('campus_card', { nameZh: '校园卡', requiredProvider: 'ecard' }),
  campusCapability('schedule', {
    nameZh: '课表',
    available: false,
    requiredProvider: 'cpdaily',
    phase: 'phase1',
    blockedReason: '等待学校信息办书面回复',
  }),
]

function setup(options: Parameters<typeof createFakeTechpieRepository>[0] = {}) {
  const repository = createFakeTechpieRepository(options)
  const cache = createFakeCache()
  const useCase = createCapabilitiesUseCase({
    repository,
    cache,
    clock: fixedClock(TEST_NOW_ISO),
    cacheKey: CACHE_KEY,
  })
  return { repository, cache, useCase }
}

describe('application · techpie · capabilities（⚠️ 契约 I4：引导而非错误）', () => {
  it('未登录 → 每一条都是 SIGN_IN / UNAUTHENTICATED，**没有**任何 isGuidance', async () => {
    const { useCase } = setup({ capabilities: [ok(CATALOG)] })
    await useCase.load()

    const viewer = campusViewerOf(EMPTY_SESSION, [])
    expect(viewer.authenticated).toBe(false)

    const entries = useCase.entries(viewer)
    expect(entries.every((entry) => entry.decision.action === 'SIGN_IN')).toBe(true)
    expect(entries.every((entry) => entry.decision.code === 'UNAUTHENTICATED')).toBe(true)
    expect(entries.some((entry) => entry.decision.isGuidance)).toBe(false)
  })

  it('⚠️ 已登录但未绑定 → 需要绑定的那一项是 GO_BIND 引导，**不是错误**', async () => {
    const { useCase } = setup({ capabilities: [ok(CATALOG)] })
    await useCase.load()

    const viewer = campusViewerOf(signedInSession(), [])
    const entries = useCase.entries(viewer)

    const card = entries.find((entry) => entry.capability.key === 'campus_card')
    expect(card?.decision.action).toBe('GO_BIND')
    expect(card?.decision.code).toBe('CAMPUS_BINDING_REQUIRED')
    expect(card?.decision.isGuidance).toBe(true)
    // 引导文案里不能出现"错误 / 失败"
    expect(`${card?.decision.title}${card?.decision.detail}`).not.toMatch(/错误|失败|异常/)

    // 不需要绑定的 Phase 0 能力仍然直接可用（W4：用户自登录）
    const ecourse = entries.find((entry) => entry.capability.key === 'ecourse')
    expect(ecourse?.decision.action).toBe('OPEN_WEBVIEW')

    // Phase 1 能力如实阻塞，**不**变成"去绑定"
    const schedule = entries.find((entry) => entry.capability.key === 'schedule')
    expect(schedule?.decision.action).toBe('BLOCKED')
    expect(schedule?.decision.detail).toBe('等待学校信息办书面回复')
  })

  it('⚠️ 未登录 vs 未绑定必须可区分（契约 §11.18-H 的 I4 原意）', async () => {
    const { useCase } = setup({ capabilities: [ok([campusCapability('campus_card', { requiredProvider: 'ecard' })])] })
    await useCase.load()

    const unauth = useCase.entries(campusViewerOf(EMPTY_SESSION, []))[0]
    const unbound = useCase.entries(campusViewerOf(signedInSession(), []))[0]

    expect(unauth?.decision.code).toBe('UNAUTHENTICATED')
    expect(unbound?.decision.code).toBe('CAMPUS_BINDING_REQUIRED')
    expect(unauth?.decision.action).not.toBe(unbound?.decision.action)
  })

  it('已绑定 → GO_BIND 消失，变成可用入口', async () => {
    const { useCase } = setup({ capabilities: [ok([campusCapability('campus_card', { requiredProvider: 'ecard' })])] })
    await useCase.load()

    const viewer = campusViewerOf(signedInSession(), [
      campusBinding('tpl-1', { provider: 'ecard', status: 'ACTIVE' }),
    ])
    const entry = useCase.entries(viewer)[0]
    expect(entry?.decision.action).toBe('OPEN_NATIVE')
    expect(entry?.decision.isGuidance).toBe(false)
    expect(useCase.unboundCount(viewer)).toBe(0)
  })

  it('unboundCount 反映"还差几项"，供引导条展示', async () => {
    const { useCase } = setup({ capabilities: [ok(CATALOG)] })
    await useCase.load()
    const viewer = campusViewerOf(signedInSession(), [])
    expect(useCase.unboundCount(viewer)).toBe(1)
  })
})

describe('application · techpie · capabilities（三态 + §8 静默降级）', () => {
  it('load 成功 → ready，并写缓存', async () => {
    const { cache, useCase } = setup({ capabilities: [ok(CATALOG)] })
    const state = await useCase.load()
    expect(state.status).toBe('ready')
    expect(state.items).toHaveLength(3)
    expect(cache.read(CACHE_KEY)).not.toBeNull()
  })

  it('空清单 → empty（不编造本地兜底清单）', async () => {
    const { useCase } = setup({ capabilities: [ok([])] })
    expect((await useCase.load()).status).toBe('empty')
  })

  it('失败且无缓存 → error；失败但有缓存 → ready + fromCache', async () => {
    const failure = err({ code: 'UPSTREAM_UNAVAILABLE' as const, message: '网络不可用' })

    const first = setup({ capabilities: [failure] })
    expect((await first.useCase.load()).status).toBe('error')

    const second = setup({ capabilities: [failure] })
    second.cache.write(CACHE_KEY, { items: CATALOG, updatedAt: TEST_NOW_ISO })
    second.useCase.hydrate()
    const state = await second.useCase.load()
    expect(state.status).toBe('ready')
    expect(state.fromCache).toBe(true)
    expect(state.error).toBe('网络不可用')
  })

  it('缓存含凭证键时 hydrate 拒绝使用它', () => {
    const { cache, useCase } = setup()
    cache.write(CACHE_KEY, {
      items: [{ key: 'x', nameZh: 'x', available: true, requiredProvider: null, phase: 'phase0', blockedReason: null, ticket: 'wvt_1' }],
      updatedAt: TEST_NOW_ISO,
    })
    expect(useCase.hydrate().status).toBe('idle')
    expect(isCachedCapabilities({ items: [], updatedAt: 'x', castgc: 'T' })).toBe(false)
  })
})
