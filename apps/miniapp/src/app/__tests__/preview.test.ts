import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContainer } from '../container'
import { refreshInBackground } from '../bootstrap'
import { createMemoryStorage } from '../../data/storage/memoryStorage'
import { createMockSignIn } from '../../data/mock/mockAuth'

vi.mock('@tarojs/taro', () => ({ default: { request: vi.fn() } }))

afterEach(() => vi.useRealTimers())

describe('离线预览', () => {
  it('演示日期之后仍能登录并参团，页面与仓储使用相同的演示时钟', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    const container = createContainer({
      cache: createMemoryStorage(),
      env: { useMock: true, mockLatencyMs: 0 },
    })
    const login = createMockSignIn()()
    if (!login.ok) throw new Error(login.error)
    container.useCases.session.signIn(login.value.tokens, login.value.profile)
    expect(container.useCases.session.needsRefresh()).toBe(false)
    const joined = await container.useCases.joinGroupBuy.join('gb-1001')
    expect(joined.ok).toBe(true)
  })

  it('Mock 模式即使缓存的 token 已过期也不请求占位后端', async () => {
    const container = createContainer({
      cache: createMemoryStorage(),
      env: { useMock: true, mockLatencyMs: 0 },
    })
    const login = createMockSignIn(() => new Date('2020-01-01T00:00:00Z'))()
    if (!login.ok) throw new Error(login.error)
    container.useCases.session.signIn(login.value.tokens, login.value.profile)
    const refresh = vi.spyOn(container.refresher, 'refresh')
    const load = vi.spyOn(container.useCases.listGroupBuys, 'load')
    refreshInBackground(container)
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
    expect(refresh).not.toHaveBeenCalled()
    expect(container.useCases.session.isAuthenticated()).toBe(true)
  })
})
