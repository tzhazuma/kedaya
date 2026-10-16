import { err, ok, type Result } from '@kedaya/shared'

import type { ForumBoard, ForumPost, ForumReport, ForumReply } from '../../domain/models/forum'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  CreateForumPostInput,
  CreateForumReplyInput,
  ForumPostPage,
  ForumReplyPage,
  ForumRepository,
  ListForumPostsQuery,
  ListForumRepliesQuery,
  ReportForumContentInput,
} from '../../domain/ports/forumRepository'
import {
  createForumMemoryDatabase,
  type ForumMemoryDatabase,
} from '../mock/forumMemoryDatabase'
import { mockNow } from '../mock/fixtures'

/**
 * Mock 论坛仓储 —— 契约 §7 硬规则 4：必须有 mock adapter，让 UI 在无后端时开发。
 *
 * 除实现端口外，额外暴露一组**演示控制**（reset / failNextRequests / setLatency / clearAll），
 * 让页面能真实演示「加载中 / 空 / 错误」三态，而不是靠硬编码假状态。
 * 这与 `mockGroupBuyRepository` 的形状保持一致，页面代码可以照抄。
 */

export interface MockForumRepository extends ForumRepository {
  readonly kind: 'mock'
  reset(): void
  /** 让接下来 N 次请求失败（演示错误态） */
  failNextRequests(times: number): void
  setLatency(ms: number): void
  /** 清空数据集（演示空态） */
  clearAll(): void
}

export interface MockForumRepositoryOptions {
  latencyMs?: number
  now?: () => Date
  database?: ForumMemoryDatabase
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createMockForumRepository(
  options: MockForumRepositoryOptions = {},
): MockForumRepository {
  const db: ForumMemoryDatabase = options.database ?? createForumMemoryDatabase()
  const now = options.now ?? mockNow
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

    listBoards(): Promise<Result<ForumBoard[], RepositoryError>> {
      return guard(() => ok(db.listBoards()))
    },

    listPosts(query: ListForumPostsQuery = {}): Promise<Result<ForumPostPage, RepositoryError>> {
      return guard(() => ok(db.listPosts(query)))
    },

    postDetail(id: string): Promise<Result<ForumPost, RepositoryError>> {
      return guard(() => {
        const found = db.findPost(id)
        if (found === null) return err({ code: 'NOT_FOUND', message: '主题不存在或已被删除' })
        return ok(found)
      })
    },

    listReplies(
      postId: string,
      query: ListForumRepliesQuery = {},
    ): Promise<Result<ForumReplyPage, RepositoryError>> {
      return guard(() => ok(db.listReplies(postId, query)))
    },

    createPost(input: CreateForumPostInput): Promise<Result<ForumPost, RepositoryError>> {
      return guard(() => ok(db.createPost(input, now())))
    },

    createReply(input: CreateForumReplyInput): Promise<Result<ForumReply, RepositoryError>> {
      return guard(() => {
        const result = db.createReply(input, now())
        if (!result.ok) return result
        return ok(result.value.reply)
      })
    },

    report(input: ReportForumContentInput): Promise<Result<ForumReport, RepositoryError>> {
      return guard(() => db.report(input, now()))
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
      db.clear()
    },
  }
}
