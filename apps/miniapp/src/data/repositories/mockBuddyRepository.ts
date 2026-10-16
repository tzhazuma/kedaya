import { err, ok, type Result } from '@kedaya/shared'

import type { BuddyTag } from '../../domain/models/buddy'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  BuddyApplicationPage,
  BuddyFeedbackResult,
  BuddyItemPage,
  BuddyRecommendationPage,
  BuddyRepository,
  CreateBuddyPostInput,
  DecideBuddyApplicationInput,
  JoinBuddyInput,
  ListBuddyItemsQuery,
} from '../../domain/ports/buddyRepository'
import type { BuddyApplication, BuddyPost, BuddyProfile, BuddySection } from '../../domain/models/buddy'
import { createBuddyMemoryDatabase, type BuddyMemoryDatabase, type BuddyViewer } from '../mock/buddyMemoryDatabase'

/**
 * Mock 找搭子仓储 —— 契约 §7 硬规则 4：必须有 mock adapter，让 UI 在无后端时开发。
 *
 * 除了实现端口，还额外暴露一组**演示控制**（reset / failNextRequests / setLatency /
 * clearAll / addDemoApplication），让页面能真实演示「加载中 / 空 / 错误」三态
 * 与「发起人审批」流程，而不是靠硬编码假状态。
 */

export interface MockBuddyRepository extends BuddyRepository {
  readonly kind: 'mock'
  reset(): void
  /** 让接下来 N 次请求失败（演示错误态） */
  failNextRequests(times: number): void
  setLatency(ms: number): void
  /** 清空数据集（演示空态） */
  clearAll(): void
  /** 演示控制：给某帖塞一条待审批申请 */
  addDemoApplication(postId: string): Promise<Result<BuddyApplication, RepositoryError>>
  /** 只读：当前内存库的原始快照（测试断言用，页面不要用） */
  readonly database: BuddyMemoryDatabase
}

export interface MockBuddyRepositoryOptions {
  latencyMs?: number
  now?: () => Date
  currentUser: () => BuddyViewer | null
  database?: BuddyMemoryDatabase
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createMockBuddyRepository(
  options: MockBuddyRepositoryOptions,
): MockBuddyRepository {
  const db =
    options.database ??
    createBuddyMemoryDatabase({
      now: options.now,
      currentUser: options.currentUser,
    })
  let latencyMs = options.latencyMs ?? 220
  let remainingFailures = 0

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

    listTags(): Promise<Result<BuddyTag[], RepositoryError>> {
      return guard(() => ok(db.listTags()))
    },

    listItems(query: ListBuddyItemsQuery = {}): Promise<Result<BuddyItemPage, RepositoryError>> {
      return guard(() => ok(db.list(query)))
    },

    itemDetail(id: string): Promise<Result<BuddyPost, RepositoryError>> {
      return guard(() => {
        const found = db.find(id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '搭子不存在或已被下架' })
        return ok(found)
      })
    },

    createItem(
      body: CreateBuddyPostInput,
      idempotencyKey?: string,
    ): Promise<Result<BuddyPost, RepositoryError>> {
      return guard(() => db.create(body, idempotencyKey))
    },

    join(id: string, input: JoinBuddyInput): Promise<Result<BuddyApplication, RepositoryError>> {
      return guard(() => db.join(id, input))
    },

    leave(id: string, idempotencyKey?: string): Promise<Result<BuddyApplication, RepositoryError>> {
      return guard(() => db.leave(id, idempotencyKey))
    },

    close(id: string, idempotencyKey?: string): Promise<Result<BuddyPost, RepositoryError>> {
      return guard(() => db.close(id, idempotencyKey))
    },

    decide(
      id: string,
      input: DecideBuddyApplicationInput,
    ): Promise<Result<BuddyPost, RepositoryError>> {
      return guard(() => db.decide(id, input))
    },

    listApplications(postId: string): Promise<Result<BuddyApplicationPage, RepositoryError>> {
      return guard(() => db.listApplications(postId))
    },

    recommendations(
      section: BuddySection,
      limit?: number,
    ): Promise<Result<BuddyRecommendationPage, RepositoryError>> {
      return guard(() => ok(db.recommendations(section, limit)))
    },

    feedback(
      id: string,
      input: { section: BuddySection; action: 'like' | 'dislike' | 'skip' },
    ): Promise<Result<BuddyFeedbackResult, RepositoryError>> {
      return guard(() => db.feedback(id, input))
    },

    getProfile(): Promise<Result<BuddyProfile | null, RepositoryError>> {
      return guard(() => ok(db.getProfile()))
    },

    putProfile(
      profile: BuddyProfile,
      idempotencyKey?: string,
    ): Promise<Result<BuddyProfile, RepositoryError>> {
      return guard(() => db.putProfile(profile, idempotencyKey))
    },

    deleteProfile(): Promise<Result<true, RepositoryError>> {
      return guard(() => db.deleteProfile())
    },

    addDemoApplication(postId: string): Promise<Result<BuddyApplication, RepositoryError>> {
      return guard(() => db.addDemoApplication(postId))
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
