import { describe, expect, it } from 'vitest'

import {
  AI_PORTRAIT_CATALOG_ID,
  AI_PORTRAIT_CONSENT_CACHE_KEY,
  AI_PORTRAIT_CONSENT_REQUIRED_MESSAGE,
  AI_PORTRAIT_VIEW_ID,
  createAiPortraitUseCases,
} from '../../../application/aiPortrait/aiPortraitUseCases'
import {
  AI_PORTRAIT_CONSENT_VERSION,
  AI_PORTRAIT_MAX_TRAITS,
  AI_PORTRAIT_MODULE_ID,
  AI_PORTRAIT_TRAIT_DETAIL_MAX,
  AI_PORTRAIT_TRAIT_LABEL_MAX,
  FORBIDDEN_PORTRAIT_SOURCE_IDS,
  isAiPortraitConsentRecord,
  toPortraitView,
} from '../../../domain/models/aiPortrait'
import type {
  AiPortraitProfilePayload,
  AiPortraitSourcesPayload,
} from '../../../domain/models/aiPortrait'
import type { AiPortraitRepository } from '../../../domain/ports/aiPortraitRepository'
import { createMemoryStorage } from '../../storage/memoryStorage'
import { StorageKeys } from '../../storage/keys'
import { createMockAiPortraitRepository } from '../mockAiPortraitRepository'

/**
 * AI 校园画像「领域规则 + Mock 仓储 + 用例」的可执行规格。
 *
 * 这个模块的正确性**不是**「接口通不通」，而是三件事：
 *
 *   1. **同意门在读画像之前**（契约 §9）：没同意时连一次 `GET /me` 都不该发出去。
 *      所以这里用带计数的仓储包装来断言"仓储没被碰过"，而不是只看返回了错误码。
 *   2. **可解释性优先**：说不清来源 / 来源越界的标签宁可**不展示**，
 *      也绝不用整体来源冒充单条来源。
 *   3. **不截断结论**：超长的标签是**丢弃**而不是截断 —— 截断会改写结论的意思。
 */

const NOW = new Date('2026-05-01T12:00:00.000Z')
const SOURCES_CACHE_KEY = 'kedaya:v1:cache:ai-portrait:sources'

function makeMock(viewer: string | null = 'u-1') {
  let currentViewer = viewer
  const repository = createMockAiPortraitRepository({
    viewerId: () => currentViewer,
    latencyMs: 0,
    now: () => NOW,
  })
  return {
    repository,
    setViewer: (next: string | null): void => {
      currentViewer = next
    },
  }
}

/** 公开来源清单（`sources()` 不依赖登录与同意，任何主体都能读到） */
async function loadCatalog(): Promise<AiPortraitSourcesPayload> {
  const { repository } = makeMock()
  const result = await repository.sources()
  if (!result.ok) throw new Error('sources 必须公开可读')
  return result.value
}

/** 记录仓储被调用了几次：用来断言"同意门之前仓储没被碰过" */
function countingRepository(inner: AiPortraitRepository): {
  repository: AiPortraitRepository
  calls: { me: number; sources: number; grant: number; revoke: number; enabled: number }
} {
  const calls = { me: 0, sources: 0, grant: 0, revoke: 0, enabled: 0 }
  const repository: AiPortraitRepository = {
    me: () => {
      calls.me += 1
      return inner.me()
    },
    sources: () => {
      calls.sources += 1
      return inner.sources()
    },
    consents: () => inner.consents(),
    grantConsent: () => {
      calls.grant += 1
      return inner.grantConsent()
    },
    revokeConsent: () => {
      calls.revoke += 1
      return inner.revokeConsent()
    },
    setEnabled: (enabled) => {
      calls.enabled += 1
      return inner.setEnabled(enabled)
    },
  }
  return { repository, calls }
}

function profile(overrides: Partial<AiPortraitProfilePayload> = {}): AiPortraitProfilePayload {
  return {
    id: 'p-1',
    enabled: true,
    traits: [],
    explain: {},
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  }
}

describe('公开来源清单（契约 §9 数据最小化）', () => {
  it('禁止来源就是心理支持与宿舍矛盾，且每条都写清排除理由', async () => {
    const payload = await loadCatalog()

    expect(payload.module).toBe(AI_PORTRAIT_MODULE_ID)
    expect(payload.forbidden).toEqual([...FORBIDDEN_PORTRAIT_SOURCE_IDS])
    expect(FORBIDDEN_PORTRAIT_SOURCE_IDS).toEqual(['wellbeing', 'dorm-harmony'])

    const forbidden = payload.catalog.filter((source) => !source.allowed)
    expect(forbidden.map((source) => source.id)).toEqual([...FORBIDDEN_PORTRAIT_SOURCE_IDS])
    for (const source of forbidden) {
      expect(source.exclusionReason ?? '').not.toBe('')
    }
  })

  it('清单与白名单同源同序：catalog === allowed + forbidden', async () => {
    const payload = await loadCatalog()
    expect(payload.catalog.map((source) => source.id)).toEqual([
      ...payload.allowed,
      ...payload.forbidden,
    ])
    // 白名单里的每一项在清单里都是 allowed
    for (const id of payload.allowed) {
      expect(payload.catalog.find((source) => source.id === id)?.allowed).toBe(true)
    }
  })

  it('接入现状如实为「尚未接入」：没有一类数据被标成已连接', async () => {
    const payload = await loadCatalog()
    expect(payload.generation.implemented).toBe(false)
    expect(payload.generation.connectedSources).toBe(0)
    expect(payload.catalog.every((source) => source.connected === false)).toBe(true)
  })
})

describe('Mock 仓储 · 归属与同意门', () => {
  it('未登录一律 UNAUTHENTICATED；只有 sources 是公开的', async () => {
    const { repository } = makeMock(null)

    expect((await repository.sources()).ok).toBe(true)
    expect((await repository.me()).ok).toBe(false)
    expect((await repository.consents()).ok).toBe(false)
    expect((await repository.grantConsent()).ok).toBe(false)
    expect((await repository.setEnabled(true)).ok).toBe(false)

    const me = await repository.me()
    if (!me.ok) expect(me.error.code).toBe('UNAUTHENTICATED')
  })

  it('没有有效同意时 me / setEnabled 一律 CONSENT_REQUIRED', async () => {
    const { repository } = makeMock('u-1')

    const me = await repository.me()
    expect(me.ok).toBe(false)
    if (!me.ok) expect(me.error.code).toBe('CONSENT_REQUIRED')

    const toggle = await repository.setEnabled(false)
    expect(toggle.ok).toBe(false)
    if (!toggle.ok) expect(toggle.error.code).toBe('CONSENT_REQUIRED')
  })

  it('同意 → 幂等刷新；撤回 → me 重新 CONSENT_REQUIRED，历史记录保留一条已撤回', async () => {
    const { repository } = makeMock('u-1')
    repository.seedConsent('u-1')

    expect((await repository.me()).ok).toBe(true)

    const again = await repository.grantConsent()
    expect(again.ok).toBe(true)
    if (again.ok) expect(again.value.revokedAt).toBeNull()

    const beforeRevoke = await repository.consents()
    if (beforeRevoke.ok) {
      expect(beforeRevoke.value).toHaveLength(1)
      expect(beforeRevoke.value[0]?.revokedAt).toBeNull()
    }

    const revoked = await repository.revokeConsent()
    expect(revoked.ok).toBe(true)
    if (revoked.ok) expect(revoked.value?.revokedAt).not.toBeNull()

    // 幂等：再撤一次返回 null 而不是报错
    const twice = await repository.revokeConsent()
    expect(twice.ok).toBe(true)
    if (twice.ok) expect(twice.value).toBeNull()

    const afterRevoke = await repository.me()
    expect(afterRevoke.ok).toBe(false)
    if (!afterRevoke.ok) expect(afterRevoke.error.code).toBe('CONSENT_REQUIRED')

    const history = await repository.consents()
    if (history.ok) {
      expect(history.value).toHaveLength(1)
      expect(history.value[0]?.revokedAt).not.toBeNull()
    }
  })
})

describe('Mock 仓储 · 种子画像', () => {
  it('4 条行为统计标签，每条都有自己的来源，且不涉及禁止来源', async () => {
    const { repository } = makeMock('u-1')
    repository.seedConsent('u-1')

    const me = await repository.me()
    expect(me.ok).toBe(true)
    if (!me.ok) return
    expect(me.value).not.toBeNull()
    if (me.value === null) return

    const traits = me.value.traits as Array<{ id: string; sources?: string[] }>
    expect(traits).toHaveLength(4)
    for (const trait of traits) {
      expect(trait.sources ?? []).not.toHaveLength(0)
      for (const source of trait.sources ?? []) {
        expect(FORBIDDEN_PORTRAIT_SOURCE_IDS).not.toContain(source)
      }
    }

    // 视图层不丢任何一条（每条都说得清来源），并且来源能解析成中文名
    const catalog = await loadCatalog()
    const view = toPortraitView(me.value, catalog.catalog, catalog.allowed, NOW)
    expect(view.enabled).toBe(true)
    expect(view.droppedTraits).toBe(0)
    expect(view.traits).toHaveLength(4)
    for (const trait of view.traits) {
      expect(trait.sources.length).toBeGreaterThan(0)
      for (const source of trait.sources) {
        expect(source.nameZh).not.toBe(source.id)
      }
    }
  })

  it('同一时刻构建的两个 Mock 产出完全一致的种子（可复现）', async () => {
    const first = makeMock('u-1')
    first.repository.seedConsent('u-1')
    const second = makeMock('u-1')
    second.repository.seedConsent('u-1')

    const a = await first.repository.me()
    const b = await second.repository.me()
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.value).toEqual(b.value)
  })

  it('clearPortrait → me 返回 null（空态），reset 后种子恢复', async () => {
    const { repository } = makeMock('u-1')
    repository.seedConsent('u-1')

    repository.clearPortrait()
    const empty = await repository.me()
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.value).toBeNull()

    repository.reset()
    // reset 会清掉同意记录（回到「第一次进来」），因此要重新同意
    repository.seedConsent('u-1')
    const restored = await repository.me()
    expect(restored.ok).toBe(true)
    if (restored.ok) expect(restored.value).not.toBeNull()
  })

  it('failNextRequests 只影响接下来 N 次请求', async () => {
    const { repository } = makeMock('u-1')
    repository.seedConsent('u-1')

    repository.failNextRequests(1)
    const failed = await repository.me()
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error.code).toBe('UPSTREAM_UNAVAILABLE')

    expect((await repository.me()).ok).toBe(true)
  })
})

describe('载荷 → 视图（可解释性优先）', () => {
  it('来源越界（含禁止来源）的标签被丢弃并计数，并给出说明', async () => {
    const catalog = await loadCatalog()
    const view = toPortraitView(
      profile({
        traits: [{ id: 't1', label: '常在图书馆自习', sources: ['wellbeing'] }],
        explain: { sources: ['library-nope'] },
      }),
      catalog.catalog,
      catalog.allowed,
      NOW,
    )

    expect(view.traits).toHaveLength(0)
    expect(view.droppedTraits).toBeGreaterThanOrEqual(1)
    expect(view.note).not.toBeNull()
  })

  it('没有自己的来源时不展示 —— 整体 explain.sources 只是总览，不能冒充单条来源', async () => {
    const catalog = await loadCatalog()
    const view = toPortraitView(
      profile({
        traits: [{ id: 't1', label: '常在第二食堂吃早餐' }],
        explain: { sources: ['canteen'] },
      }),
      catalog.catalog,
      catalog.allowed,
      NOW,
    )

    expect(view.traits).toHaveLength(0)
    expect(view.droppedTraits).toBe(1)
    // 总览仍如实给出，但没有被挂到那条标签上
    expect(view.roundSources.map((source) => source.id)).toEqual(['canteen'])
  })

  it('explain[traitId].sources 是合法的"自己的来源"，可展示并解析中文名', async () => {
    const catalog = await loadCatalog()
    const view = toPortraitView(
      profile({
        traits: [{ id: 't1', label: '常在第二食堂吃早餐' }],
        explain: { t1: { sources: ['canteen'] }, sources: [] },
      }),
      catalog.catalog,
      catalog.allowed,
      NOW,
    )

    expect(view.droppedTraits).toBe(0)
    expect(view.traits).toHaveLength(1)
    expect(view.traits[0]?.sources.map((source) => source.nameZh)).toEqual(['食堂营养'])
  })

  it('超长标签被丢弃而不是截断（截断会改写结论的意思）', async () => {
    const catalog = await loadCatalog()
    const longLabel = '常'.repeat(AI_PORTRAIT_TRAIT_LABEL_MAX + 1)
    const longDetail = '细'.repeat(AI_PORTRAIT_TRAIT_DETAIL_MAX + 1)

    const byLabel = toPortraitView(
      profile({ traits: [{ id: 't1', label: longLabel, sources: ['canteen'] }] }),
      catalog.catalog,
      catalog.allowed,
      NOW,
    )
    expect(byLabel.traits).toHaveLength(0)
    expect(byLabel.droppedTraits).toBe(1)

    const byDetail = toPortraitView(
      profile({
        traits: [{ id: 't1', label: '常在第二食堂吃早餐', detail: longDetail, sources: ['canteen'] }],
      }),
      catalog.catalog,
      catalog.allowed,
      NOW,
    )
    expect(byDetail.traits).toHaveLength(0)
    expect(byDetail.droppedTraits).toBe(1)
  })

  it('超出条数上限的标签被丢弃并计数', async () => {
    const catalog = await loadCatalog()
    const traits = Array.from({ length: AI_PORTRAIT_MAX_TRAITS + 3 }, (_, index) => ({
      id: `t${String(index)}`,
      label: `标签 ${String(index)}`,
      sources: ['canteen'],
    }))

    const view = toPortraitView(profile({ traits }), catalog.catalog, catalog.allowed, NOW)
    expect(view.traits).toHaveLength(AI_PORTRAIT_MAX_TRAITS)
    expect(view.droppedTraits).toBe(3)
  })

  it('enabled=false 时一条标签都不展示（关闭 = 不再展示，数据保留）', async () => {
    const catalog = await loadCatalog()
    const view = toPortraitView(
      profile({
        enabled: false,
        traits: [{ id: 't1', label: '常在第二食堂吃早餐', sources: ['canteen'] }],
      }),
      catalog.catalog,
      catalog.allowed,
      NOW,
    )

    expect(view.enabled).toBe(false)
    expect(view.traits).toHaveLength(0)
    expect(view.droppedTraits).toBe(0)
  })
})

describe('用例 · 同意门与仓储调用顺序', () => {
  /** `viewerId` 必须可变（要模拟切换账号），所以放在 describe 作用域里 */
  let currentViewer: string | null = 'u-1'

  it('未同意时连一次仓储调用都没有（同意门在读画像之前）', async () => {
    const mock = makeMock('u-1')
    currentViewer = 'u-1'
    const counted = countingRepository(mock.repository)
    const useCases = createAiPortraitUseCases({
      repository: counted.repository,
      cache: createMemoryStorage(),
      clock: { now: () => NOW },
      cacheKey: SOURCES_CACHE_KEY,
      viewerId: () => currentViewer,
    })

    const state = await useCases.portrait.load(AI_PORTRAIT_VIEW_ID)
    expect(state.status).toBe('error')
    expect(state.error).toBe(AI_PORTRAIT_CONSENT_REQUIRED_MESSAGE)
    expect(counted.calls.me).toBe(0)
    expect(counted.calls.sources).toBe(0)
  })

  it('同意后能读到画像；同意是「先服务端、再本地」', async () => {
    const mock = makeMock('u-1')
    currentViewer = 'u-1'
    const counted = countingRepository(mock.repository)
    const useCases = createAiPortraitUseCases({
      repository: counted.repository,
      cache: createMemoryStorage(),
      clock: { now: () => NOW },
      cacheKey: SOURCES_CACHE_KEY,
      viewerId: () => currentViewer,
    })

    const granted = await useCases.acceptConsent()
    expect(granted.ok).toBe(true)
    expect(counted.calls.grant).toBe(1)
    expect(useCases.hasConsented()).toBe(true)
    expect(mock.repository.hasConsent()).toBe(true)

    const state = await useCases.portrait.load(AI_PORTRAIT_VIEW_ID)
    expect(state.status).toBe('ready')
    expect(counted.calls.me).toBe(1)
    expect(state.data?.hasProfile).toBe(true)
    expect(state.data?.view.traits).toHaveLength(4)
  })

  it('服务端留痕失败时本地不写同意（不做乐观更新）', async () => {
    const mock = makeMock('u-1')
    currentViewer = 'u-1'
    mock.repository.failNextRequests(1)
    const useCases = createAiPortraitUseCases({
      repository: mock.repository,
      cache: createMemoryStorage(),
      clock: { now: () => NOW },
      cacheKey: SOURCES_CACHE_KEY,
      viewerId: () => currentViewer,
    })

    const granted = await useCases.acceptConsent()
    expect(granted.ok).toBe(false)
    expect(useCases.hasConsented()).toBe(false)
  })

  it('服务端回 CONSENT_REQUIRED 时清掉本地留痕，同意门重新出现（自愈）', async () => {
    const mock = makeMock('u-1')
    currentViewer = 'u-1'
    const useCases = createAiPortraitUseCases({
      repository: mock.repository,
      cache: createMemoryStorage(),
      clock: { now: () => NOW },
      cacheKey: SOURCES_CACHE_KEY,
      viewerId: () => currentViewer,
    })

    await useCases.acceptConsent()
    expect(useCases.hasConsented()).toBe(true)

    // 本地有、服务端没有（例如换设备 / 别处撤回了）
    await mock.repository.revokeConsent()
    const state = await useCases.portrait.load(AI_PORTRAIT_VIEW_ID)

    expect(state.status).toBe('error')
    expect(useCases.hasConsented()).toBe(false)
    expect(useCases.consentRecord()).toBeNull()
  })

  it('撤回同意会清空画像状态：不留下"已撤回但还看得到"的中间态', async () => {
    const mock = makeMock('u-1')
    currentViewer = 'u-1'
    const useCases = createAiPortraitUseCases({
      repository: mock.repository,
      cache: createMemoryStorage(),
      clock: { now: () => NOW },
      cacheKey: SOURCES_CACHE_KEY,
      viewerId: () => currentViewer,
    })

    await useCases.acceptConsent()
    await useCases.portrait.load(AI_PORTRAIT_VIEW_ID)
    expect(useCases.portrait.getSnapshot().data).not.toBeNull()

    const revoked = await useCases.revokeConsent()
    expect(revoked.ok).toBe(true)
    expect(useCases.hasConsented()).toBe(false)
    expect(useCases.portrait.getSnapshot().data).toBeNull()
    expect(useCases.portrait.getSnapshot().status).toBe('idle')
  })

  it('切换登录主体会清空画像状态（绝不把上一个账号的画像留在屏幕上）', async () => {
    const mock = makeMock('u-1')
    currentViewer = 'u-1'
    const useCases = createAiPortraitUseCases({
      repository: mock.repository,
      cache: createMemoryStorage(),
      clock: { now: () => NOW },
      cacheKey: SOURCES_CACHE_KEY,
      viewerId: () => currentViewer,
    })

    await useCases.acceptConsent()
    await useCases.portrait.load(AI_PORTRAIT_VIEW_ID)
    expect(useCases.portrait.getSnapshot().data).not.toBeNull()

    currentViewer = 'u-2'
    useCases.syncViewer()
    expect(useCases.portrait.getSnapshot().data).toBeNull()
    expect(useCases.portrait.getSnapshot().status).toBe('idle')
  })

  it('来源清单缓存可离线兜底：断网时仍拿得到那份清单', async () => {
    const mock = makeMock('u-1')
    currentViewer = 'u-1'
    const cache = createMemoryStorage()
    const useCases = createAiPortraitUseCases({
      repository: mock.repository,
      cache,
      clock: { now: () => NOW },
      cacheKey: SOURCES_CACHE_KEY,
      viewerId: () => currentViewer,
    })

    const online = await useCases.sources.load(AI_PORTRAIT_CATALOG_ID)
    expect(online.status).toBe('ready')
    expect(cache.read(SOURCES_CACHE_KEY)).not.toBeNull()

    mock.repository.failNextRequests(1)
    const offline = await useCases.sources.load(AI_PORTRAIT_CATALOG_ID)
    expect(offline.status).toBe('ready')
    expect(offline.data?.forbidden).toEqual([...FORBIDDEN_PORTRAIT_SOURCE_IDS])
  })

  it('本地同意 key 与 StorageKeys.consent 是同一条（防止两边悄悄漂移）', () => {
    expect(AI_PORTRAIT_CONSENT_CACHE_KEY).toBe(StorageKeys.consent)
    expect(AI_PORTRAIT_CONSENT_VERSION).toBe('v1')
    expect(isAiPortraitConsentRecord({ acceptedAt: NOW.toISOString(), version: 'v1' })).toBe(true)
    expect(isAiPortraitConsentRecord({ acceptedAt: '', version: 'v1' })).toBe(false)
    expect(isAiPortraitConsentRecord(null)).toBe(false)
  })
})
