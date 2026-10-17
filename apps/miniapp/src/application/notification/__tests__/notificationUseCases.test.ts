import { describe, expect, it } from 'vitest'

import { createNotificationUseCases } from '../notificationUseCases'
import type { NotificationItem } from '../../../domain/models/notification'
import type { CachePort } from '../../../domain/ports/cachePort'
import type { RepositoryError } from '../../../domain/ports/errors'
import type {
  ListNotificationsQuery,
  NotificationPage,
  NotificationRepository,
} from '../../../domain/ports/notificationRepository'
import type { Result } from '@kedaya/shared'

/**
 * 站内信用例测试。
 *
 * 重点不是"能不能拉列表"（那是通用列表骨架的测试），而是站内信**特有**的三条：
 *   1. link 白名单：服务端给了未知路径时必须变成 `null`（否则用户点进白屏页）；
 *   2. 未读数是独立状态，且只在**真正变化**时通知订阅者（tabBar 红点不让页面抖）；
 *   3. `markRead` / `markAllRead` 成功后未读数与列表都要跟着变，失败则**不动**。
 */

function createFakeCache(): CachePort & { dump(): Record<string, unknown> } {
  const store = new Map<string, unknown>()
  return {
    read: <T>(key: string): T | null => (store.has(key) ? (store.get(key) as T) : null),
    write: (key: string, value: unknown): void => {
      store.set(key, JSON.parse(JSON.stringify(value)) as unknown)
    },
    remove: (key: string): void => {
      store.delete(key)
    },
    dump: (): Record<string, unknown> => Object.fromEntries(store.entries()),
  }
}

const KNOWN_PATHS: readonly string[] = [
  '/presentation/pages/messages/index',
  '/presentation/pages/groupbuy/detail/index',
]

function item(overrides: Partial<NotificationItem> & { id: string }): NotificationItem {
  return {
    title: '有人参团了',
    body: '你的拼单有新成员',
    source: 'groupbuy',
    link: null,
    readAt: null,
    createdAt: '2026-10-17T04:00:00.000Z',
    ...overrides,
  }
}

interface FakeRepo extends NotificationRepository {
  queries: ListNotificationsQuery[]
  unread: number
  readonly data: NotificationItem[]
  failNextUnreadCount: boolean
}

function createFakeRepository(seed: NotificationItem[]): FakeRepo {
  const data = seed.map((entry) => ({ ...entry }))
  const repo: FakeRepo = {
    queries: [],
    unread: data.filter((entry) => entry.readAt === null).length,
    data,
    failNextUnreadCount: false,

    async list(query: ListNotificationsQuery = {}): Promise<Result<NotificationPage, RepositoryError>> {
      repo.queries.push(query)
      const filtered = query.unreadOnly === true ? data.filter((e) => e.readAt === null) : data
      return { ok: true, value: { items: filtered.map((e) => ({ ...e })), nextCursor: null } }
    },

    async unreadCount(): Promise<Result<number, RepositoryError>> {
      if (repo.failNextUnreadCount) {
        repo.failNextUnreadCount = false
        return { ok: false, error: { code: 'INTERNAL', message: '网络炸了' } }
      }
      return { ok: true, value: repo.unread }
    },

    async markRead(id: string): Promise<Result<NotificationItem, RepositoryError>> {
      const found = data.find((e) => e.id === id)
      if (found === undefined) return { ok: false, error: { code: 'NOT_FOUND', message: '不存在' } }
      if (found.readAt === null) {
        found.readAt = '2026-10-17T05:00:00.000Z'
        repo.unread = Math.max(0, repo.unread - 1)
      }
      return { ok: true, value: { ...found } }
    },

    async markAllRead(): Promise<Result<number, RepositoryError>> {
      let updated = 0
      for (const entry of data) {
        if (entry.readAt === null) {
          entry.readAt = '2026-10-17T05:00:00.000Z'
          updated += 1
        }
      }
      repo.unread = 0
      return { ok: true, value: updated }
    },
  }
  return repo
}

const NOW = new Date('2026-10-17T06:00:00.000Z')

function createDeps(repository: NotificationRepository, onChange?: (n: number) => void) {
  return createNotificationUseCases({
    repository,
    cache: createFakeCache(),
    clock: { now: () => NOW },
    cacheKey: 'test:notifications',
    knownPaths: KNOWN_PATHS,
    ...(onChange === undefined ? {} : { onUnreadChange: onChange }),
  })
}

describe('站内信用例', () => {
  it('link 必须是已知页面才可点：未知路径降级为 null', async () => {
    const repository = createFakeRepository([
      item({ id: 'n1', link: '/presentation/pages/groupbuy/detail/index?id=gb-1' }),
      item({ id: 'n2', link: '/presentation/pages/groupbuy/detail/index' }),
      // 服务端版本升级后下发的"未来页面"—— 小程序还不认识它
      item({ id: 'n3', link: '/presentation/pages/unknown/index' }),
      item({ id: 'n4', link: null }),
    ])
    const useCases = createDeps(repository)

    const state = await useCases.list.load()
    const byId = new Map(state.items.map((entry) => [entry.id, entry]))

    expect(byId.get('n1')?.link).toBe('/presentation/pages/groupbuy/detail/index?id=gb-1')
    expect(byId.get('n2')?.link).toBe('/presentation/pages/groupbuy/detail/index')
    // 未知页面：可点性必须关掉，而不是把字符串透传给 navigateTo
    expect(byId.get('n3')?.link).toBeNull()
    expect(byId.get('n4')?.link).toBeNull()
  })

  it('未读数是独立状态：只在数值真正变化时通知订阅者', async () => {
    const repository = createFakeRepository([item({ id: 'n1' }), item({ id: 'n2' })])
    const seen: number[] = []
    const useCases = createDeps(repository, (count) => seen.push(count))

    await useCases.refreshUnread()
    expect(useCases.unread.getSnapshot()).toBe(2)

    // 第二次拉取结果相同：不应该再通知（否则每次 useDidShow 都让 tabBar 重绘）
    await useCases.refreshUnread()
    expect(seen).toEqual([2])

    await useCases.markRead('n1')
    expect(useCases.unread.getSnapshot()).toBe(1)
    expect(seen).toEqual([2, 1])

    // 幂等：再标一次同一条，未读数不会再减
    await useCases.markRead('n1')
    expect(useCases.unread.getSnapshot()).toBe(1)
    expect(seen).toEqual([2, 1])
  })

  it('未读数拉取失败时保留旧值，不把红点清零（避免误报「没有新消息」）', async () => {
    const repository = createFakeRepository([item({ id: 'n1' })])
    const useCases = createDeps(repository)

    await useCases.refreshUnread()
    expect(useCases.unread.getSnapshot()).toBe(1)

    repository.failNextUnreadCount = true
    await useCases.refreshUnread()
    expect(useCases.unread.getSnapshot()).toBe(1)
  })

  it('未登录（UNAUTHENTICATED）视为「没有未读」，红点归零而不是报错', async () => {
    const repository = createFakeRepository([])
    repository.unreadCount = async () => ({
      ok: false,
      error: { code: 'UNAUTHENTICATED', message: '请先登录' },
    })
    const useCases = createDeps(repository)

    await useCases.refreshUnread()
    expect(useCases.unread.getSnapshot()).toBe(0)
  })

  it('markAllRead 成功后未读归零，且列表重新拉取', async () => {
    const repository = createFakeRepository([item({ id: 'n1' }), item({ id: 'n2' })])
    const useCases = createDeps(repository)

    await useCases.refreshUnread()
    await useCases.list.load()
    expect(useCases.unread.getSnapshot()).toBe(2)

    const result = await useCases.markAllRead()
    expect(result.ok).toBe(true)
    expect(result.ok ? result.value : -1).toBe(2)
    expect(useCases.unread.getSnapshot()).toBe(0)
    // 列表被刷新过：第二次 load 的 items 全部是已读
    expect(useCases.list.getSnapshot().items.every((entry) => !entry.unread)).toBe(true)
  })

  it('未读筛选会把条件传给仓储，而不是在小程序本地过滤', async () => {
    const repository = createFakeRepository([item({ id: 'n1' })])
    const useCases = createDeps(repository)

    await useCases.list.load({ unreadOnly: true })
    expect(repository.queries.at(-1)?.unreadOnly).toBe(true)
  })
})
