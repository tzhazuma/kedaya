import type { Result } from '@kedaya/shared'

import type { NotificationItem } from '../models/notification'
import type { RepositoryError } from './errors'

/** 游标分页查询（契约 §6.1：不用 offset 分页） */
export interface ListNotificationsQuery {
  cursor?: string | null
  limit?: number
  /** 只看未读 —— 「消息」页的未读筛选 */
  unreadOnly?: boolean
}

export interface NotificationPage {
  items: NotificationItem[]
  nextCursor: string | null
}

/**
 * 站内信仓储端口 —— 由 `data/repositories/*` 实现（http / mock 两套）。
 *
 * 刻意**没有** `userId` 参数：通知恒属于当前登录用户，服务端从 JWT 取主体。
 * 让客户端传 `userId` 只会给越权留口子（改个参数就能读别人的通知）。
 */
export interface NotificationRepository {
  list(query?: ListNotificationsQuery): Promise<Result<NotificationPage, RepositoryError>>
  /** 未读数（小程序 tabBar 红点用） */
  unreadCount(): Promise<Result<number, RepositoryError>>
  /** 标记单条已读（幂等） */
  markRead(id: string): Promise<Result<NotificationItem, RepositoryError>>
  /** 全部已读，返回本次实际标记的条数 */
  markAllRead(): Promise<Result<number, RepositoryError>>
}
