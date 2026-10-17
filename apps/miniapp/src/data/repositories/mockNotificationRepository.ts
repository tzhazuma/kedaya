import { err, ok, type Result } from '@kedaya/shared'

import type { NotificationItem } from '../../domain/models/notification'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  ListNotificationsQuery,
  NotificationPage,
  NotificationRepository,
} from '../../domain/ports/notificationRepository'

/**
 * Mock 站内信仓储 —— 契约 §7 硬规则 4：必须有 mock adapter。
 *
 * 为什么单独实现而不是复用拼单那个 `MemoryDatabase`：
 *   通知有自己的一套语义（未读、标已读、全部已读），塞进拼单的内存库
 *   只会让两边都变得难懂。这里用最朴素的一个数组 + 游标即可。
 *
 * 数据刻意覆盖四类来源（拼单/跑腿/跳蚤/系统），其中一条**没有 link**，
 * 用来验证"不可点的通知不能假装可点"这条规则在 UI 上真的成立。
 */

export interface MockNotificationRepository extends NotificationRepository {
  readonly kind: 'mock'
  reset(): void
  failNextRequests(times: number): void
  setLatency(ms: number): void
  /** 清空数据集（演示空态） */
  clearAll(): void
}

export interface MockNotificationRepositoryOptions {
  seed?: readonly NotificationItem[]
  latencyMs?: number
  now?: () => Date
}

const MINUTE = 60 * 1000

/** 相对「现在」的时间戳，保证演示数据不会因为时间流逝变成"3 年前" */
function seedNotifications(now: Date): NotificationItem[] {
  const at = (minutesAgo: number): string => new Date(now.getTime() - minutesAgo * MINUTE).toISOString()
  return [
    {
      id: 'mock-nt-1',
      title: '有人参团了你的拼单',
      body: '「咖啡豆拼单」已有 2/4 份，还差 2 份成团。',
      source: 'groupbuy',
      link: '/presentation/pages/groupbuy/detail/index?id=gb-1001',
      readAt: null,
      createdAt: at(8),
    },
    {
      id: 'mock-nt-2',
      title: '你的闲置被预定了',
      body: '「九成新机械键盘」被同学预定，请尽快联系确认交易方式。',
      source: 'flea-market',
      link: '/presentation/pages/fleaMarket/detail/index?id=flea-demo-1',
      readAt: null,
      createdAt: at(95),
    },
    {
      id: 'mock-nt-3',
      title: '你的主题收到新回复',
      body: '「第三食堂新窗口」有新回复，去看看。',
      source: 'forum',
      link: '/presentation/pages/forum/detail/index?id=forum-demo-1',
      readAt: null,
      createdAt: at(60 * 20),
    },
    {
      id: 'mock-nt-4',
      title: '校园卡余额偏低提醒',
      body: '当前余额低于 100 元，可在校园卡页查看流水或充值。',
      source: 'campus-card',
      link: '/presentation/pages/campusCard/index',
      readAt: at(60 * 30),
      createdAt: at(60 * 31),
    },
    {
      id: 'mock-nt-5',
      title: '欢迎使用可达鸭',
      body: '这里会收到拼单成团、跑腿接单、闲置被预定等提醒。',
      source: 'system',
      // 刻意没有 link：验证"只告知、无跳转目标"的通知在 UI 上行为正确
      link: null,
      readAt: at(60 * 50),
      createdAt: at(60 * 52),
    },
  ]
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createMockNotificationRepository(
  options: MockNotificationRepositoryOptions = {},
): MockNotificationRepository {
  const now = options.now ?? ((): Date => new Date())
  let rows: NotificationItem[] = [...(options.seed ?? seedNotifications(now()))]
  let latencyMs = options.latencyMs ?? 200
  let remainingFailures = 0

  async function guard<T>(work: () => Result<T, RepositoryError>): Promise<Result<T, RepositoryError>> {
    await delay(latencyMs)
    if (remainingFailures > 0) {
      remainingFailures -= 1
      return err({ code: 'UPSTREAM_UNAVAILABLE', message: '（演示）模拟服务端不可用' })
    }
    return work()
  }

  /** 手工分页：倒序（最新在最前），游标就是上一页最后一条的 id */
  function page(query: ListNotificationsQuery): NotificationPage {
    const limit = query.limit ?? 20
    const visible = query.unreadOnly === true ? rows.filter((row) => row.readAt === null) : rows
    const sorted = [...visible].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const startIndex = query.cursor == null ? 0 : sorted.findIndex((row) => row.id === query.cursor) + 1
    const slice = sorted.slice(startIndex, startIndex + limit)
    const last = slice.at(-1)
    const hasMore = startIndex + limit < sorted.length
    return { items: slice, nextCursor: hasMore && last !== undefined ? last.id : null }
  }

  return {
    kind: 'mock',

    list(query: ListNotificationsQuery = {}): Promise<Result<NotificationPage, RepositoryError>> {
      return guard(() => ok(page(query)))
    },

    unreadCount(): Promise<Result<number, RepositoryError>> {
      return guard(() => ok(rows.filter((row) => row.readAt === null).length))
    },

    markRead(id: string): Promise<Result<NotificationItem, RepositoryError>> {
      return guard(() => {
        const index = rows.findIndex((row) => row.id === id)
        const found = index === -1 ? undefined : rows[index]
        if (found === undefined) return err({ code: 'NOT_FOUND', message: '通知不存在' })
        // 幂等：已读的通知再次标记不会改时间，避免"时间往前跳"的怪异表现
        const updated: NotificationItem =
          found.readAt === null ? { ...found, readAt: now().toISOString() } : found
        rows = rows.map((row, i) => (i === index ? updated : row))
        return ok(updated)
      })
    },

    markAllRead(): Promise<Result<number, RepositoryError>> {
      return guard(() => {
        const unread = rows.filter((row) => row.readAt === null).length
        const stamp = now().toISOString()
        rows = rows.map((row) => (row.readAt === null ? { ...row, readAt: stamp } : row))
        return ok(unread)
      })
    },

    reset(): void {
      rows = [...seedNotifications(now())]
      remainingFailures = 0
    },

    failNextRequests(times: number): void {
      remainingFailures = Math.max(0, Math.floor(times))
    },

    setLatency(ms: number): void {
      latencyMs = Math.max(0, ms)
    },

    clearAll(): void {
      rows = []
    },
  }
}
