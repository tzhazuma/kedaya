import type { Result } from '@kedaya/shared'

import { summarizeNotification } from '../../domain/models/notification'
import type { NotificationItem, NotificationSummary } from '../../domain/models/notification'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { NotificationRepository } from '../../domain/ports/notificationRepository'
import { createCachedPageGuard, createListUseCase } from '../common/listUseCase'
import type { ListUseCase } from '../common/listUseCase'

/**
 * 站内信用例 —— presentation 只调用这里，不直接碰仓储（契约 §7）。
 *
 * 三件事：
 *   1. `list`：复用通用列表骨架（hydrate → 后台刷新 → 失败静默降级 → 游标续页）；
 *   2. **未读数**：独立于列表的一个小状态，因为它同时驱动 tabBar 红点，
 *      而 tabBar 红点在「消息页没打开」时也必须正确 —— 不能让红点绑定到列表的加载状态；
 *   3. `markRead` / `markAllRead`：先落库，成功后再刷新列表与未读数。
 *
 * `knownPaths` 由装配层传 `Object.values(PAGE_PATHS)`：domain 不认识路由表，
 * 但**必须**能判断服务端给的 link 是不是已知页面 —— 否则用户会点进白屏页。
 */

const PAGE_SIZE = 20

export interface NotificationFilters extends Record<string, unknown> {
  unreadOnly?: boolean
}

export interface NotificationDeps {
  repository: NotificationRepository
  cache: CachePort
  clock: ClockPort
  /** 列表缓存 key 由装配层注入 */
  cacheKey: string
  /** 已知的小程序页面路径（来自 `app/routes.ts`） */
  knownPaths: readonly string[]
  /**
   * 未读数变化回调 —— 装配层用它更新 tabBar 红点。
   * application 层不 import `@tarojs/*`，因此这里只暴露一个纯回调。
   */
  onUnreadChange?: (count: number) => void
}

export interface NotificationUseCases {
  list: ListUseCase<NotificationFilters, NotificationSummary>
  /**
   * 未读数 store —— 直接喂给 `useStore`。
   *
   * 做成独立的 store 而不是塞进列表 state：tabBar 红点必须在「消息页没打开」
   * 时也正确，因此它不能依赖列表是否加载过。
   */
  unread: {
    getSnapshot(): number
    subscribe(listener: () => void): () => void
  }
  /** 拉取未读数：成功更新、失败保留旧值；未登录时归零（不显示红点） */
  refreshUnread(): Promise<number>
  markRead(id: string): Promise<Result<NotificationItem, RepositoryError>>
  markAllRead(): Promise<Result<number, RepositoryError>>
}

export function createNotificationUseCases(deps: NotificationDeps): NotificationUseCases {
  const { repository, cache, clock, cacheKey, knownPaths, onUnreadChange } = deps

  let unread = 0
  const unreadListeners = new Set<() => void>()
  /** 只有真正变化才通知：避免每次 `useDidShow` 都触发一次无意义的重渲染 */
  let notifiedUnread = -1

  function publishUnread(next: number): void {
    unread = next
    if (next === notifiedUnread) return
    notifiedUnread = next
    onUnreadChange?.(next)
    for (const listener of unreadListeners) listener()
  }

  const list: ListUseCase<NotificationFilters, NotificationSummary> = createListUseCase<
    NotificationFilters,
    NotificationItem,
    NotificationSummary
  >({
    cache,
    clock,
    cacheKey,
    defaultQuery: { unreadOnly: false },
    isCachedPage: createCachedPageGuard<NotificationItem>(),
    fetchPage: (filters, cursor) =>
      repository.list({ cursor, limit: PAGE_SIZE, unreadOnly: filters.unreadOnly === true }),
    mapItem: (item, now) => summarizeNotification(item, now, knownPaths),
  })

  async function refreshUnread(): Promise<number> {
    const result = await repository.unreadCount()
    if (result.ok) {
      publishUnread(result.value)
      return result.value
    }
    // 未登录不是"错误"：红点本来就该隐藏，不必打扰用户
    if (result.error.code === 'UNAUTHENTICATED') publishUnread(0)
    return unread
  }

  return {
    list,
    unread: {
      getSnapshot: () => unread,
      subscribe(listener: () => void): () => void {
        unreadListeners.add(listener)
        return () => {
          unreadListeners.delete(listener)
        }
      },
    },
    refreshUnread,

    async markRead(id: string): Promise<Result<NotificationItem, RepositoryError>> {
      const result = await repository.markRead(id)
      if (!result.ok) return result
      // 单条已读：**重新向服务端要未读数**，而不是本地 -1。
      // 本地扣减在「重复标同一条」时会多扣（无法从返回值判断它原本是否未读），
      // 而 markRead 本就幂等 —— 未读数必须同样幂等。
      await Promise.all([list.load(), refreshUnread()])
      return result
    },

    async markAllRead(): Promise<Result<number, RepositoryError>> {
      const result = await repository.markAllRead()
      if (!result.ok) return result
      // 服务端已确认全部已读：未读数必定为 0，不需要再问一次
      publishUnread(0)
      await list.load()
      return result
    },
  }
}
