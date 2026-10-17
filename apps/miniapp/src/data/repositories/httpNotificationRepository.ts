import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import { ok, type Result } from '@kedaya/shared'

import type { NotificationItem } from '../../domain/models/notification'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListNotificationsQuery,
  NotificationPage,
  NotificationRepository,
} from '../../domain/ports/notificationRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端站内信仓储 —— 契约 §6.1 的模块路由：
 *
 * ```
 * GET  /api/v1/notifications/items             列表（游标分页，倒序）
 * GET  /api/v1/notifications/items?unread=1    只看未读
 * GET  /api/v1/notifications/unread-count      未读数
 * POST /api/v1/notifications/items/:id/read    标记单条已读
 * POST /api/v1/notifications/read-all          全部已读
 * ```
 *
 * 这四个端点**全部需要登录**（服务端 `@UseGuards(AuthGuard)` 挂在整个控制器上）。
 * 未登录时服务端返回 UNAUTHENTICATED，`ApiClient` 会按契约 §6.1 尝试刷新 token，
 * 刷新也失败才把它当错误抛上来 —— 页面据此提示"登录后查看消息"。
 */
export function createHttpNotificationRepository(client: ApiClient): NotificationRepository {
  return {
    async list(query: ListNotificationsQuery = {}): Promise<Result<NotificationPage, RepositoryError>> {
      const result = await client.get<NotificationPage>(modulePath('notifications', 'items'), {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        // 服务端只认 `1` / `true`；这里显式传 1，避免 `false` 被当成真值
        unread: query.unreadOnly === true ? 1 : undefined,
      })
      if (!result.ok) return { ok: false, error: toRepositoryError(result.error) }
      return ok({ items: result.value.items, nextCursor: result.value.nextCursor })
    },

    async unreadCount(): Promise<Result<number, RepositoryError>> {
      const result = await client.get<{ count: number }>(
        modulePath('notifications', 'unread-count'),
      )
      if (!result.ok) return { ok: false, error: toRepositoryError(result.error) }
      return ok(result.value.count)
    },

    async markRead(id: string): Promise<Result<NotificationItem, RepositoryError>> {
      const result = await client.post<NotificationItem>(
        modulePath('notifications', 'items', encodeURIComponent(id), 'read'),
      )
      if (!result.ok) return { ok: false, error: toRepositoryError(result.error) }
      return ok(result.value)
    },

    async markAllRead(): Promise<Result<number, RepositoryError>> {
      const result = await client.post<{ updated: number }>(
        modulePath('notifications', 'read-all'),
      )
      if (!result.ok) return { ok: false, error: toRepositoryError(result.error) }
      return ok(result.value.updated)
    },
  }
}
