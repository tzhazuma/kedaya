import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ok, type Result } from '@kedaya/shared'

import type { RepositoryError } from '../../domain/ports/errors'
import type { ClientEventPayload, TelemetryRepository } from '../../domain/ports/telemetryRepository'
import {
  TELEMETRY_LIMITS,
  TELEMETRY_MAX_DUPLICATES,
  TELEMETRY_MAX_PER_SESSION,
  createTelemetryReporter,
} from '../telemetry'

/**
 * 上报器的规格。
 *
 * 这里要守住的都是「出错时不会报错、只会静默坏事」的性质：
 *   · 去重（一个每次渲染都抛错的组件会瞬间刷出几千条相同记录）；
 *   · 会话总量上限（错误处理本身出错 → 自激振荡）；
 *   · 客户端截断（一条带巨大栈的崩溃在弱网上白烧用户流量）；
 *   · 上报失败绝不影响主流程。
 *
 * `@tarojs/taro` 在 node 环境里没有真实实现，这里 mock 掉 ——
 * 也正是因为依赖是可注入的（`currentRoute` / `describeRuntime`），
 * 绝大部分行为不需要 Taro 就能测。
 */

const taroMock = vi.hoisted(() => ({
  onError: vi.fn(),
  onUnhandledRejection: vi.fn(),
  onPageNotFound: vi.fn(),
  getCurrentPages: vi.fn(() => [] as unknown[]),
  getAccountInfoSync: vi.fn(() => ({ miniProgram: { version: '1.0.0' } })),
}))

vi.mock('@tarojs/taro', () => ({ default: taroMock }))

interface FakeRepo extends TelemetryRepository {
  sent: ClientEventPayload[]
}

function makeRepo(
  impl?: (payload: ClientEventPayload) => Promise<Result<{ accepted: boolean }, RepositoryError>>,
): FakeRepo {
  const sent: ClientEventPayload[] = []
  return {
    sent,
    async send(payload) {
      sent.push(payload)
      return impl === undefined ? ok({ accepted: true }) : impl(payload)
    },
  }
}

/** 同步等待已排入微任务队列的 fire-and-forget 上报 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('createTelemetryReporter', () => {
  let repo: FakeRepo

  beforeEach(() => {
    repo = makeRepo()
    vi.clearAllMocks()
  })

  function makeReporter(overrides: Partial<Parameters<typeof createTelemetryReporter>[0]> = {}) {
    return createTelemetryReporter({
      repository: repo,
      currentRoute: () => 'presentation/pages/home/index',
      describeRuntime: () => ({ platform: 'weapp', appVersion: '1.2.3' }),
      ...overrides,
    })
  }

  it('补齐 route / platform / appVersion（调用方只需要给 kind + message）', async () => {
    makeReporter().report({ kind: 'error', message: 'boom' })
    await flush()
    expect(repo.sent[0]).toMatchObject({
      kind: 'error',
      message: 'boom',
      route: 'presentation/pages/home/index',
      platform: 'weapp',
      appVersion: '1.2.3',
    })
  })

  it('显式给的 route 优先（API 失败场景要记的是那个接口所在页）', async () => {
    makeReporter().report({
      kind: 'api-failure',
      message: 'x',
      route: 'presentation/pages/messages/index',
    })
    await flush()
    expect(repo.sent[0]?.route).toBe('presentation/pages/messages/index')
  })

  it('丢弃 undefined 字段（避免线上出现一堆 null 键）', async () => {
    makeReporter().report({ kind: 'error', message: 'boom' })
    await flush()
    expect(repo.sent[0]).not.toHaveProperty('stack')
    expect(repo.sent[0]).not.toHaveProperty('traceId')
    expect(repo.sent[0]).not.toHaveProperty('context')
  })

  it('同一条（kind + message）最多上报 maxDuplicates 次', async () => {
    const reporter = makeReporter()
    for (let index = 0; index < 10; index += 1) reporter.report({ kind: 'error', message: 'same' })
    await flush()
    expect(repo.sent).toHaveLength(TELEMETRY_MAX_DUPLICATES)
  })

  it('内容不同则分别计数（去重不能把不同故障合并掉）', async () => {
    const reporter = makeReporter()
    reporter.report({ kind: 'error', message: 'a' })
    reporter.report({ kind: 'error', message: 'b' })
    reporter.report({ kind: 'unhandled-rejection', message: 'a' })
    await flush()
    expect(repo.sent).toHaveLength(3)
  })

  it('会话总量有硬上限（错误处理本身出错时不会无限刷）', async () => {
    const reporter = makeReporter({ maxDuplicates: 999, maxPerSession: 3 })
    for (let index = 0; index < 50; index += 1) {
      reporter.report({ kind: 'error', message: `msg-${String(index)}` })
    }
    await flush()
    expect(repo.sent).toHaveLength(3)
  })

  it('客户端先截断：省用户流量（服务端还有一层兜底）', async () => {
    makeReporter().report({ kind: 'error', message: 'x'.repeat(5000), stack: 'y'.repeat(9000) })
    await flush()
    expect([...(repo.sent[0]?.message ?? '')].length).toBeLessThanOrEqual(
      TELEMETRY_LIMITS.message + 1,
    )
    expect([...(repo.sent[0]?.stack ?? '')].length).toBeLessThanOrEqual(
      TELEMETRY_LIMITS.stack + 1,
    )
  })

  it('栈只留前 20 行（后面都是框架噪声，传上去也是浪费）', async () => {
    const stack = Array.from({ length: 100 }, (_, index) => `at frame${String(index)}`).join('\n')
    makeReporter().report({ kind: 'error', message: 'x', stack })
    await flush()
    expect(repo.sent[0]?.stack?.split('\n')).toHaveLength(20)
  })

  it('report 是同步的 void —— 调用方不需要 await（类型与实现都要守住）', () => {
    const reporter = makeReporter()
    const result: void = reporter.report({ kind: 'error', message: 'x' })
    expect(result).toBeUndefined()
  })

  it('上报失败**不抛错**（遥测不得成为新的故障源）', async () => {
    const failing = makeRepo(() => Promise.reject(new Error('network down')))
    const reporter = createTelemetryReporter({ repository: failing })

    expect(() => {
      reporter.report({ kind: 'error', message: 'boom' })
    }).not.toThrow()
    await flush()
  })

  it('reset 后可重新计数（供测试与「重开会话」场景）', async () => {
    const reporter = makeReporter({ maxDuplicates: 1 })
    reporter.report({ kind: 'error', message: 'same' })
    reporter.report({ kind: 'error', message: 'same' })
    await flush()
    expect(repo.sent).toHaveLength(1)

    reporter.reset()
    reporter.report({ kind: 'error', message: 'same' })
    await flush()
    expect(repo.sent).toHaveLength(2)
  })

  it('总量上限与去重的默认值是「够用但不至于刷爆」的量级', () => {
    expect(TELEMETRY_MAX_PER_SESSION).toBe(40)
    expect(TELEMETRY_MAX_DUPLICATES).toBe(3)
  })
})

describe('installGlobalHandlers', () => {
  let repo: FakeRepo

  beforeEach(() => {
    repo = makeRepo()
    vi.clearAllMocks()
    taroMock.getCurrentPages.mockReturnValue([{ route: 'presentation/pages/forum/list/index' }])
    taroMock.getAccountInfoSync.mockReturnValue({ miniProgram: { version: '2.0.0' } })
  })

  function install() {
    const reporter = createTelemetryReporter({ repository: repo })
    reporter.installGlobalHandlers()
    return reporter
  }

  it('挂上三个钩子', () => {
    install()
    expect(taroMock.onError).toHaveBeenCalledTimes(1)
    expect(taroMock.onUnhandledRejection).toHaveBeenCalledTimes(1)
    expect(taroMock.onPageNotFound).toHaveBeenCalledTimes(1)
  })

  it('幂等：多次调用只挂一次（否则热重载后每条错误报两遍）', () => {
    const reporter = install()
    reporter.installGlobalHandlers()
    reporter.installGlobalHandlers()
    expect(taroMock.onError).toHaveBeenCalledTimes(1)
  })

  it('onError 的多行文本拆成 message + stack', async () => {
    install()
    const handler = taroMock.onError.mock.calls[0]?.[0] as (error: string) => void
    handler('TypeError: x is undefined\n  at foo (a.js:1)\n  at bar (b.js:2)')
    await flush()

    expect(repo.sent[0]?.kind).toBe('error')
    expect(repo.sent[0]?.message).toBe('TypeError: x is undefined')
    expect(repo.sent[0]?.stack).toContain('at foo')
  })

  it('未处理拒绝：Error 取 message + stack，字符串原样用', async () => {
    install()
    const handler = taroMock.onUnhandledRejection.mock.calls[0]?.[0] as (res: {
      reason: unknown
    }) => void

    handler({ reason: new Error('拒绝原因') })
    handler({ reason: '字符串原因' })
    await flush()

    expect(repo.sent[0]).toMatchObject({ kind: 'unhandled-rejection', message: '拒绝原因' })
    expect(repo.sent[0]?.stack).toContain('Error')
    expect(repo.sent[1]).toMatchObject({ kind: 'unhandled-rejection', message: '字符串原因' })
  })

  it('页面不存在：把要去的路径记成 route（便于判断是哪个旧链接失效）', async () => {
    install()
    const handler = taroMock.onPageNotFound.mock.calls[0]?.[0] as (res: { path: string }) => void
    handler({ path: 'presentation/pages/legacy/index' })
    await flush()

    expect(repo.sent[0]).toMatchObject({
      kind: 'page-not-found',
      route: 'presentation/pages/legacy/index',
    })
  })

  it('宿主不支持某个钩子（H5 / 低版本）时不影响其它钩子', () => {
    taroMock.onError.mockImplementation(() => {
      throw new Error('not supported')
    })
    const reporter = createTelemetryReporter({ repository: repo })
    expect(() => {
      reporter.installGlobalHandlers()
    }).not.toThrow()
    expect(taroMock.onUnhandledRejection).toHaveBeenCalledTimes(1)
    expect(taroMock.onPageNotFound).toHaveBeenCalledTimes(1)
  })

  it('取不到页面路径时回退 unknown（不抛错）', async () => {
    taroMock.getCurrentPages.mockImplementation(() => {
      throw new Error('no runtime')
    })
    const reporter = createTelemetryReporter({ repository: repo })
    reporter.report({ kind: 'error', message: 'boom' })
    await flush()
    expect(repo.sent[0]?.route).toBe('unknown')
  })
})
