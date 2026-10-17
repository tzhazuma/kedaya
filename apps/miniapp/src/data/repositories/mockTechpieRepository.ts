import { err, ok, type Result } from '@kedaya/shared'

import type { CampusCardPaymentCode, CampusCardTransaction } from '../../domain/models/campusCard'
import { CREDENTIAL_FORBIDDEN_KEYS } from '../../domain/models/credentials'
import {
  normalizeCampusBindingSummary,
  type CampusBindingSummary,
  type CampusCapability,
} from '../../domain/models/techpie'
import type { RepositoryError } from '../../domain/ports/errors'
import type { LogPort } from '../../domain/ports/logPort'
import type {
  CampusBindingPage,
  CampusCardTransactionPage,
  CreateCampusBindingInput,
  ListBindingsQuery,
  TechpieRepository,
} from '../../domain/ports/techpieRepository'
import {
  createTechpieMemoryDatabase,
  type TechpieMemoryDatabase,
} from '../mock/techpieMemoryDatabase'

/**
 * 演示契约违规时用的禁用键。
 *
 * ⚠️ 刻意**从契约常量里取**，而不是在生产代码里手写这个键名 ——
 * 手写会让「静态扫描禁止生产代码出现凭证属性名」这条规则失效
 * （见 `src/__tests__/techpie-no-cookie-injection.test.ts`）。
 */
const DEMO_FORBIDDEN_KEY: string =
  CREDENTIAL_FORBIDDEN_KEYS[CREDENTIAL_FORBIDDEN_KEYS.indexOf('castgc')] ?? 'castgc'

/**
 * Mock TechPie 仓储 —— 契约 §7 硬规则 4：必须有 mock adapter，让 UI 在无后端时开发。
 *
 * 除了实现端口，还额外暴露一组**演示控制**，让页面能真实演示：
 * - 三态（loading / empty / error）；
 * - 「未绑定 → 绑定 → 已过期 → 重新绑定」的状态迁移；
 * - **契约违规**：服务端在响应里夹带了 `castgc` 时客户端会**拒绝**该条目
 *   （`injectForbiddenKeysOnce`）—— 这是 I1 镜像断言的运行期演示。
 */

export interface MockTechpieRepository extends TechpieRepository {
  readonly kind: 'mock'
  reset(): void
  /** 让接下来 N 次请求失败（演示错误态） */
  failNextRequests(times: number): void
  setLatency(ms: number): void
  /** 清空数据集（演示空态） */
  clearAll(): void
  /** 演示：注入一张已绑定的校园卡 */
  seedEcardBinding(): void
  /** 演示：注入一条已过期的 eGate 绑定 */
  seedExpiredEgateBinding(): void
  /** 演示：把所有绑定置为 EXPIRED（触发「需重新绑定」引导） */
  expireAll(): void
  /**
   * 演示契约违规：下一次 `listBindings` 的响应里会**多出一个 `castgc` 字段**。
   *
   * 客户端**必须拒绝**该条目（`normalizeCampusBindingSummary` 返回 null），
   * 而不是"看不见就继续用" —— 后者等于让后端有机会把凭证下发给客户端。
   */
  injectForbiddenKeysOnce(): void
  /** 只读：当前内存库快照（测试断言用，页面不要用） */
  readonly database: TechpieMemoryDatabase
}

export interface MockTechpieRepositoryOptions {
  latencyMs?: number
  now?: () => Date
  database?: TechpieMemoryDatabase
  /** 契约违规上报（响应里夹带凭证键时）—— 与真后端仓储走同一个事件名 */
  log?: LogPort
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createMockTechpieRepository(
  options: MockTechpieRepositoryOptions = {},
): MockTechpieRepository {
  const db = options.database ?? createTechpieMemoryDatabase({ now: options.now })
  const log = options.log
  let latencyMs = options.latencyMs ?? 220
  let remainingFailures = 0
  let injectForbidden = false

  async function guard<T>(
    work: () => Result<T, RepositoryError>,
  ): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  return {
    kind: 'mock',
    database: db,

    listBindings(query: ListBindingsQuery = {}): Promise<Result<CampusBindingPage, RepositoryError>> {
      return guard(() => {
        const page = db.listBindings(query)
        // ⚠️ 走**与真后端完全同一条**归一化路径：
        // 于是「mock 能过、真后端过不了」这类形状漂移会立刻暴露在测试里
        const items: CampusBindingSummary[] = []
        let rejected = 0
        for (const item of page.items) {
          const raw: unknown = injectForbidden
            ? Object.assign({}, item, { [DEMO_FORBIDDEN_KEY]: 'TGT-DEMO-VIOLATION' })
            : item
          const normalized = normalizeCampusBindingSummary(raw)
          if (normalized !== null) items.push(normalized)
          else rejected += 1
        }
        if (rejected > 0) {
          log?.warn('techpie.contract.violation', {
            where: 'techpie.links',
            droppedCount: rejected,
            reason: 'FORBIDDEN_KEYS_OR_SHAPE',
          })
        }
        injectForbidden = false
        return ok({ items, nextCursor: page.nextCursor, total: page.total })
      })
    },

    bindingDetail(id: string): Promise<Result<CampusBindingSummary, RepositoryError>> {
      return guard(() => {
        const found = db.findBinding(id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '绑定不存在或不属于你' })
        const normalized = normalizeCampusBindingSummary(found)
        if (normalized === null) {
          return err({ code: 'INTERNAL', message: '绑定数据形状不合法，已拒绝使用' })
        }
        return ok(normalized)
      })
    },

    createBinding(
      input: CreateCampusBindingInput,
      idempotencyKey?: string,
    ): Promise<Result<CampusBindingSummary, RepositoryError>> {
      return guard(() => db.createBinding(input, idempotencyKey))
    },

    unbind(id: string, _idempotencyKey?: string): Promise<Result<true, RepositoryError>> {
      return guard(() => db.unbind(id))
    },

    renew(id: string, _idempotencyKey?: string): Promise<Result<CampusBindingSummary, RepositoryError>> {
      return guard(() => db.renew(id))
    },

    capabilities(): Promise<Result<CampusCapability[], RepositoryError>> {
      return guard(() => ok(db.capabilities()))
    },

    cardTransactions(
      query: ListBindingsQuery = {},
    ): Promise<Result<CampusCardTransactionPage, RepositoryError>> {
      return guard(() => {
        const page = db.cardTransactions(query)
        const items: CampusCardTransaction[] = page.items
        return ok({ items, nextCursor: page.nextCursor, total: page.total })
      })
    },

    paymentCode(_idempotencyKey?: string): Promise<Result<CampusCardPaymentCode, RepositoryError>> {
      return guard(() => ok(db.issuePaymentCode()))
    },

    /* ---------------- 演示控制 ---------------- */

    reset(): void {
      injectForbidden = false
      remainingFailures = 0
      db.reset()
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, times)
    },

    setLatency(ms: number): void {
      latencyMs = Math.max(0, ms)
    },

    clearAll(): void {
      db.clearAll()
    },

    seedEcardBinding(): void {
      db.seedEcardBinding()
    },

    seedExpiredEgateBinding(): void {
      db.seedExpiredEgateBinding()
    },

    expireAll(): void {
      db.expireAll()
    },

    injectForbiddenKeysOnce(): void {
      injectForbidden = true
    },
  }
}
