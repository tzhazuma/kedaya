import { describe, expect, it } from 'vitest'

import type { CampusCardRepository } from '../../../domain/ports/campusCardRepository'
import type { IdentityRepository } from '../../../domain/ports/identityRepository'
import type { PrivacyRepository } from '../../../domain/ports/privacyRepository'
import type { ScheduleRepository } from '../../../domain/ports/scheduleRepository'
import { createMockAgentRepository, type MockAgentOptions } from '../mockAgentRepository'

/**
 * 可达鸭本地 Mock 的回归。
 *
 * 这里锁的是一条**很容易再次踩到**的坑：页面上的「建议问题」列表和
 * 回答引擎是两份东西，加一个建议问题却忘了加对应的回答，
 * 用户点下去就会看到"这个问题我还不太会答" —— 建议本身就变成了欺骗。
 * 第一版就踩了：「这个页面是干什么的？」摆在建议里，却答不出来。
 *
 * 所以下面的测试直接从 `suggestions()` 取建议再逐个 `chat()`，
 * 谁改坏了立刻红。
 */

const FALLBACK = '这个问题我还不太会答'

/** 这些 stub 只会被 `try/catch` 包着调用（工具失败要降级），空对象足够 */
function createRepo(overrides: Partial<MockAgentOptions> = {}) {
  return createMockAgentRepository({
    schedule: {} as ScheduleRepository,
    campusCard: {} as CampusCardRepository,
    identity: {} as IdentityRepository,
    privacy: {} as PrivacyRepository,
    viewerId: () => null,
    latencyMs: 0,
    now: () => new Date('2026-10-18T09:00:00+08:00'),
    ...overrides,
  })
}

async function ask(question: string, module?: string): Promise<string> {
  const repo = createRepo()
  const result = await repo.chat(module === undefined ? { question } : { question, module })
  if (!result.ok) throw new Error('mock agent 不应该失败')
  return result.value.answer
}

describe('可达鸭 mock：建议问题必须都能答', () => {
  it('无上下文（从可达鸭页自己打开）时，每一条建议问题都有答案', async () => {
    const repo = createRepo()
    const suggestions = await repo.suggestions(undefined, undefined)
    expect(suggestions.ok).toBe(true)
    if (!suggestions.ok) return

    expect(suggestions.value.length).toBeGreaterThan(0)
    for (const question of suggestions.value) {
      const answer = await ask(question)
      expect(answer, `建议问题没有答案：${question}`).not.toContain(FALLBACK)
    }
  })

  it('从模块页打开时，建议问题同样都能答（含"这个页面是干什么的"）', async () => {
    for (const module of ['schedule', 'campusCard', 'identity', 'profile']) {
      const repo = createRepo()
      const suggestions = await repo.suggestions(undefined, module)
      expect(suggestions.ok).toBe(true)
      if (!suggestions.ok) continue

      for (const question of suggestions.value) {
        const answer = await ask(question, module)
        expect(answer, `${module} 的建议问题没有答案：${question}`).not.toContain(FALLBACK)
      }
    }
  })
})

describe('可达鸭 mock：上下文回答', () => {
  it('问"这个页面是干什么的"时，用契约里的模块名与一句话定义回答', async () => {
    const answer = await ask('这个页面是干什么的？', 'campus-card')
    expect(answer).toContain('校园卡')
    expect(answer).toContain('余额')
  })

  it('在可达鸭页自己问时，答"我是谁"而不是模块名', async () => {
    const answer = await ask('这个页面是干什么的？')
    expect(answer).toContain('可达鸭')
    expect(answer).toContain('全局助手')
  })

  it('问"我还能用哪些功能"时，把契约里的模块清单念出来', async () => {
    const answer = await ask('我还能用哪些功能？')
    expect(answer).toContain('课表')
    expect(answer).toContain('校园卡')
  })

  it('答不上来时如实说答不上来，不编答案', async () => {
    const answer = await ask('帮我把明天的机票改签到后天')
    expect(answer).toContain(FALLBACK)
  })
})
