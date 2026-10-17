import { err, ok } from '@kedaya/shared'
import { describe, expect, it } from 'vitest'

import { createMemoryStorage } from '../../data/storage/memoryStorage'
import { StorageKeys } from '../../data/storage/keys'
import type { CardLostReport, CardOverview } from '../../domain/models/campusCard'
import type { CampusIdentityView, CampusOverview } from '../../domain/models/identity'
import type { ScheduleSyncResult, ScheduleTodayView, ScheduleWeekView } from '../../domain/models/schedule'
import type { RepositoryError } from '../../domain/ports/errors'
import type { CampusCardRepository } from '../../domain/ports/campusCardRepository'
import type { IdentityRepository } from '../../domain/ports/identityRepository'
import type { ScheduleRepository } from '../../domain/ports/scheduleRepository'
import { createAgentUseCase } from '../../application/agent/agentUseCases'
import { createCampusUseCases } from '../../application/campus/campusUseCases'
import type { AgentRepository } from '../../domain/ports/agentRepository'
import type { AgentReply } from '../../domain/models/agent'

/**
 * 校园三件套 + 可达鸭的**高可用回归**。
 *
 * 这些测试锁定的不是"功能能不能用"，而是四件"出事了会很难受"的事：
 *   · 断网时页面还有内容（缓存 hydrate）而不是白屏；
 *   · 后台刷新失败时，已有数据**不被清空**（最忌讳的失败方式是"刷没了"）；
 *   · 「没绑定校园系统」与「网络坏了」给出不同的下一步动作；
 *   · agent 请求失败也必须落一条带重试的消息，不能把用户晾在原地。
 */

const NOW = new Date('2026-10-17T09:20:00+08:00')
const clock = { now: () => NOW }

/** 与 container 里绑定的缓存 key 同源（用真实 key，测的才是真实落盘位置） */
const CACHE_KEYS = {
  identity: (owner: string) => `${StorageKeys.campusBindings}:${owner}`,
  scheduleToday: StorageKeys.scheduleTodayCache,
  scheduleWeek: StorageKeys.scheduleWeekCache,
  campusCard: StorageKeys.campusCardCache,
}

const TODAY: ScheduleTodayView = {
  term: '2026-2027-1',
  termLabel: '2026-2027 学年第一学期',
  date: '2026-10-17',
  weekday: 6,
  weekdayLabel: '周六',
  courses: [
    {
      id: 'c-1',
      courseName: '数据结构与算法',
      teacher: '陆明',
      location: '信息楼 305',
      weekday: 6,
      startSlot: 1,
      endSlot: 2,
      timeLabel: '08:15–10:05',
      slotLabel: '第 1-2 节',
    },
  ],
  ongoing: [],
  next: null,
  minutesUntilNext: null,
  nextStartsAt: null,
  finishedForToday: false,
  conflicts: [],
  simulated: true,
  empty: false,
}

const WEEK: ScheduleWeekView = {
  term: '2026-2027-1',
  termLabel: '2026-2027 学年第一学期',
  today: 6,
  days: [{ weekday: 6, label: '周六', relativeLabel: '今天', isToday: true, courses: TODAY.courses }],
  conflicts: [],
  totalCount: 1,
  terms: ['2026-2027-1'],
  simulated: true,
}

const CARD: CardOverview = {
  platform: 'CARD',
  balanceFen: 1234,
  thresholdFen: 2000,
  lowBalance: true,
  dataAsOf: NOW.toISOString(),
  syncedAt: NOW.toISOString(),
  stale: false,
  staleReason: null,
  simulated: true,
  transactions: [
    {
      id: 't-1',
      amountFen: -1500,
      direction: 'out',
      merchant: '第一食堂 · 二楼',
      happenedAt: NOW.toISOString(),
      balanceAfterFen: 1234,
      amountLabel: '−15.00',
    },
  ],
  insight: {
    todayOutFen: 1500,
    todayOutCount: 1,
    weekOutFen: 1500,
    weekOutCount: 1,
    avgDailyOutFen: 214,
    estimatedDaysLeft: 5,
    medianOutFen: 1200,
    anomalies: [],
    topMerchants: [{ merchant: '第一食堂 · 二楼', totalFen: 1500, count: 1 }],
  },
}

const OVERVIEW: CampusOverview = {
  dataMode: 'mock',
  platforms: [
    { platform: 'JWC', available: true, boundAt: NOW.toISOString(), expiresAt: null, expired: false, simulated: true },
    { platform: 'CARD', available: false, boundAt: null, expiresAt: null, expired: false, simulated: true },
  ],
}

const IDENTITY: CampusIdentityView = {
  platform: 'EGATE',
  masked: true,
  identity: { studentId: '2026**0321', realName: '张*', department: '信息科学与技术学院', email: null, campus: null },
  simulated: true,
  dataMode: 'mock',
  fetchedAt: NOW.toISOString(),
  audited: false,
}

const LOST: CardLostReport = {
  accepted: false,
  note: '可达鸭没有挂失权限，下面是可执行的做法。',
  steps: ['先在校园卡自助终端冻结账户'],
  channels: [{ name: '校园卡服务中心', detail: '工作日 8:30–17:00' }],
  audited: true,
}

const NETWORK: RepositoryError = { code: 'NETWORK', message: '网络不可用' }
const BINDING: RepositoryError = { code: 'CAMPUS_BINDING_REQUIRED', message: '需要先绑定教务系统' }

function identityRepository(overrides: Partial<IdentityRepository> = {}): IdentityRepository {
  return {
    overview: async () => ok(OVERVIEW),
    identity: async () => ok(IDENTITY),
    bind: async (platform) => ok({ platform }),
    unbind: async (platform) => ok({ platform }),
    ...overrides,
  }
}

function scheduleRepository(overrides: Partial<ScheduleRepository> = {}): ScheduleRepository {
  return {
    today: async () => ok(TODAY),
    week: async () => ok(WEEK),
    sync: async () => ok({} as ScheduleSyncResult),
    createCourse: async () => ok({ id: 'c-2' }),
    ...overrides,
  }
}

function campusCardRepository(overrides: Partial<CampusCardRepository> = {}): CampusCardRepository {
  return {
    overview: async () => ok(CARD),
    lostReport: async () => ok(LOST),
    ...overrides,
  }
}

function makeCampus(overrides: {
  identity?: Partial<IdentityRepository>
  schedule?: Partial<ScheduleRepository>
  campusCard?: Partial<CampusCardRepository>
  cache?: ReturnType<typeof createMemoryStorage>
}) {
  const cache = overrides.cache ?? createMemoryStorage()
  return {
    cache,
    useCases: createCampusUseCases({
      identityRepository: identityRepository(overrides.identity),
      scheduleRepository: scheduleRepository(overrides.schedule),
      campusCardRepository: campusCardRepository(overrides.campusCard),
      cache,
      clock,
      viewerId: () => 'user-1',
      cacheKeys: CACHE_KEYS,
    }),
  }
}

describe('课表（离线优先）', () => {
  it('hydrate 立刻用缓存出内容，刷新失败也不清空', async () => {
    const cache = createMemoryStorage()
    cache.write(StorageKeys.scheduleTodayCache, TODAY)
    cache.write(StorageKeys.scheduleWeekCache, WEEK)

    const { useCases } = makeCampus({ cache, schedule: { today: async () => err(NETWORK) } })

    const hydrated = useCases.schedule.hydrate()
    expect(hydrated.fromCache).toBe(true)
    expect(hydrated.status).toBe('ready')
    expect(hydrated.today?.courses).toHaveLength(1)

    const afterLoad = await useCases.schedule.load()
    // 关键断言：失败后数据仍在，只是标了错误
    expect(afterLoad.today?.courses).toHaveLength(1)
    expect(afterLoad.week).not.toBeNull()
    expect(afterLoad.error).toBe('网络不可用')
    expect(afterLoad.needsBinding).toBe(false)
  })

  it('未绑定教务系统时标成 needsBinding（页面据此给"去绑定"而不是"重试"）', async () => {
    const { useCases } = makeCampus({ schedule: { today: async () => err(BINDING) } })
    const state = await useCases.schedule.load()
    expect(state.needsBinding).toBe(true)
    expect(state.status).toBe('error')
  })

  it('刷新成功后写入缓存并清掉 fromCache', async () => {
    const { cache, useCases } = makeCampus({})
    useCases.schedule.hydrate()
    const state = await useCases.schedule.load()
    expect(state.fromCache).toBe(false)
    expect(state.today?.empty).toBe(false)
    expect(cache.read(StorageKeys.scheduleTodayCache)).not.toBeNull()
    expect(cache.read(StorageKeys.scheduleWeekCache)).not.toBeNull()
  })
})

describe('校园卡', () => {
  it('上游降级（stale）时如实透出，且余额照常展示', async () => {
    const stale: CardOverview = { ...CARD, stale: true, staleReason: '上游超时' }
    const { useCases } = makeCampus({ campusCard: { overview: async () => ok(stale) } })
    const state = await useCases.campusCard.load()
    expect(state.overview?.stale).toBe(true)
    expect(state.overview?.balanceFen).toBe(1234)
  })

  it('连后端都连不上时才退本地缓存（不显示 0 元）', async () => {
    const cache = createMemoryStorage()
    cache.write(StorageKeys.campusCardCache, CARD)
    const { useCases } = makeCampus({ cache, campusCard: { overview: async () => err(NETWORK) } })

    const hydrated = useCases.campusCard.hydrate()
    expect(hydrated.overview?.balanceFen).toBe(1234)
    expect(hydrated.fromCache).toBe(true)

    const afterLoad = await useCases.campusCard.load()
    expect(afterLoad.overview?.balanceFen).toBe(1234)
    expect(afterLoad.error).toBe('网络不可用')
  })

  it('挂失指引取不到时报错但不留在假的"已挂失"', async () => {
    const online = makeCampus({})
    const okState = await online.useCases.campusCard.reportLost()
    expect(okState.lostReport?.accepted).toBe(false)
    expect(okState.lostReport?.steps.length).toBeGreaterThan(0)

    const offline = makeCampus({ campusCard: { lostReport: async () => err(NETWORK) } })
    const state = await offline.useCases.campusCard.reportLost()
    expect(state.lostReport).toBeNull()
    expect(state.error).toBe('网络不可用')
  })
})

describe('身份', () => {
  it('解绑后立即清掉实名视图（不留明文在页面上）', async () => {
    const { useCases } = makeCampus({})
    await useCases.identity.load()
    await useCases.identity.reveal(false)
    expect(useCases.identity.getSnapshot().identity).not.toBeNull()

    const state = await useCases.identity.unbind('EGATE')
    expect(state.identity).toBeNull()
  })

  it('绑定状态进缓存，断网时仍能显示"已绑定"而不是"未绑定"', async () => {
    const cache = createMemoryStorage()
    const first = makeCampus({ cache })
    await first.useCases.identity.load()

    const offline = makeCampus({ cache, identity: { overview: async () => err(NETWORK) } })
    const hydrated = offline.useCases.identity.hydrate()
    expect(hydrated.overview?.platforms.find((item) => item.platform === 'JWC')?.available).toBe(true)
  })
})

describe('可达鸭 agent', () => {
  it('请求失败也落一条 agent 消息（带重试），不让用户悬着', async () => {
    const failing: AgentRepository = {
      chat: async () => err(NETWORK),
      suggestions: async () => ok(['今天有什么课？']),
      capabilities: async () => ok({
        persona: '可达鸭',
        model: null,
        mode: 'rules',
        tools: [],
        knowledgeSources: [],
        notIndexed: [],
      }),
    }
    const agent = createAgentUseCase({ repository: failing, clock })

    await agent.ask('今天有什么课？')
    const state = agent.getSnapshot()
    expect(state.pending).toBe(false)
    expect(state.messages).toHaveLength(2)
    expect(state.messages[1]?.role).toBe('agent')
    expect(state.messages[1]?.failed).toBe(true)
    expect(state.messages[1]?.text).toContain('重试')
  })

  it('重试成功后替换掉失败消息并可读地回答', async () => {
    const reply: AgentReply = {
      answer: '下一节 09:15 在信息楼 305。',
      sources: [],
      actions: [],
      facts: [],
      steps: [],
      usedModel: null,
      degraded: true,
      simulated: false,
      latencyMs: 1,
    }
    let calls = 0
    const flaky: AgentRepository = {
      chat: async () => {
        calls += 1
        if (calls === 1) return err(NETWORK)
        return ok(reply)
      },
      suggestions: async () => ok([]),
      capabilities: async () => ok({
        persona: '可达鸭',
        model: null,
        mode: 'rules',
        tools: [],
        knowledgeSources: [],
        notIndexed: [],
      }),
    }
    const agent = createAgentUseCase({ repository: flaky, clock })

    await agent.ask('下一节在哪？')
    const failedId = agent.getSnapshot().messages[1]?.id ?? ''
    await agent.retry(failedId)

    const state = agent.getSnapshot()
    // 用户提问 + 成功回答（失败的那条被移除）
    expect(state.messages).toHaveLength(2)
    expect(state.messages[1]?.failed).toBeUndefined()
    expect(state.messages[1]?.text).toContain('信息楼 305')
  })

  it('清空只清会话，不影响后续提问', async () => {
    const agent = createAgentUseCase({ repository: identityRepositoryAgentStub(), clock })
    await agent.ask('你好')
    agent.clear()
    expect(agent.getSnapshot().messages).toHaveLength(0)
    await agent.ask('你好')
    expect(agent.getSnapshot().messages).toHaveLength(2)
  })
})

/** 一个永远回同一句话的 agent 仓储，供"清空后还能继续问"这类用例使用 */
function identityRepositoryAgentStub(): AgentRepository {
  return {
    chat: async () => ok({
      answer: '在的。',
      sources: [],
      actions: [],
      facts: [],
      steps: [],
      usedModel: null,
      degraded: true,
      simulated: false,
      latencyMs: 1,
    }),
    suggestions: async () => ok([]),
    capabilities: async () => ok({
      persona: '可达鸭',
      model: null,
      mode: 'rules',
      tools: [],
      knowledgeSources: [],
      notIndexed: [],
    }),
  }
}
