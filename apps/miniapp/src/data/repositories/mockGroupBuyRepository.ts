import { err, ok, type Result } from '@kedaya/shared'

import type { GroupBuy } from '../../domain/models/groupbuy'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  GroupBuyPage,
  GroupBuyRepository,
  JoinGroupBuyInput,
  ListGroupBuysQuery,
} from '../../domain/ports/groupbuyRepository'
import { createMemoryDatabase, type MemoryDatabase } from '../mock/memoryDatabase'
import { MOCK_GROUP_BUYS, mockNow } from '../mock/fixtures'

/**
 * Mock 拼单仓储 —— 契约 §7 硬规则 4：必须有 mock adapter，让 UI 在无后端时开发。
 *
 * 除了实现端口，还额外暴露一组**演示控制**（reset / failNextRequests / setLatency），
 * 让页面能真实演示「加载中 / 空 / 错误」三态，而不是靠硬编码假状态。
 */

export interface MockGroupBuyRepository extends GroupBuyRepository {
  readonly kind: 'mock'
  reset(): void
  /** 让接下来 N 次请求失败（演示错误态） */
  failNextRequests(times: number): void
  setLatency(ms: number): void
  /** 清空数据集（演示空态） */
  clearAll(): void
}

export interface MockGroupBuyRepositoryOptions {
  seed?: readonly GroupBuy[]
  latencyMs?: number
  now?: () => Date
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createMockGroupBuyRepository(
  options: MockGroupBuyRepositoryOptions = {},
): MockGroupBuyRepository {
  const db: MemoryDatabase = createMemoryDatabase(options.seed ?? MOCK_GROUP_BUYS)
  const now = options.now ?? mockNow
  let latencyMs = options.latencyMs ?? 220
  let remainingFailures = 0

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  return {
    kind: 'mock',

    list(query: ListGroupBuysQuery = {}): Promise<Result<GroupBuyPage, RepositoryError>> {
      return guard(() => ok(db.list(query)))
    },

    detail(id: string): Promise<Result<GroupBuy, RepositoryError>> {
      return guard(() => {
        const found = db.find(id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '拼单不存在或已被下架' })
        return ok(found)
      })
    },

    join(id: string, input: JoinGroupBuyInput): Promise<Result<GroupBuy, RepositoryError>> {
      return guard(() => db.join(id, input, now()))
    },

    reset(): void {
      db.reset()
      remainingFailures = 0
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    setLatency(ms: number): void {
      latencyMs = Math.max(0, ms)
    },

    clearAll(): void {
      // 模拟「后端没有任何数据」；reset() 之后仍能恢复种子
      db.clear()
    },
  }
}
