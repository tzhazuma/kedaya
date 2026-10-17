import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import { canJoin, deriveStatus } from '../../domain/models/groupbuy'
import type { GroupBuy, GroupBuyParticipant } from '../../domain/models/groupbuy'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  GroupBuyPage,
  JoinGroupBuyInput,
  ListGroupBuysQuery,
} from '../../domain/ports/groupbuyRepository'

/**
 * 内存数据库 —— mock repository 的存储内核。
 *
 * 游标分页语义与后端保持一致（契约 §6.1）：`cursor` 是**上一条记录的 id**，
 * 不是 offset。这样 UI 的分页逻辑在切到真后端时不需要改。
 */

export interface MemoryDatabase {
  list(query?: ListGroupBuysQuery): GroupBuyPage
  find(id: string): GroupBuy | null
  join(id: string, input: JoinGroupBuyInput, now: Date): Result<GroupBuy, RepositoryError>
  /** 清空全部数据（模拟「后端一条都没有」），`reset()` 仍可恢复种子 */
  clear(): void
  reset(): void
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE)
}

function matchesKeyword(groupBuy: GroupBuy, keyword: string | undefined): boolean {
  if (keyword === undefined || keyword.trim() === '') return true
  const needle = keyword.trim().toLowerCase()
  return (
    groupBuy.title.toLowerCase().includes(needle) ||
    groupBuy.description.toLowerCase().includes(needle) ||
    groupBuy.pickupPlace.toLowerCase().includes(needle)
  )
}

export function createMemoryDatabase(seed: readonly GroupBuy[] = []): MemoryDatabase {
  let items: GroupBuy[] = seed.map(clone)

  return {
    list(query: ListGroupBuysQuery = {}): GroupBuyPage {
      const limit = clampLimit(query.limit)
      const category = query.category

      const filtered = items
        .filter((item) => category === undefined || category === 'all' || item.category === category)
        .filter((item) => matchesKeyword(item, query.keyword))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

      const cursor = query.cursor ?? null
      const startIndex = cursor === null ? 0 : filtered.findIndex((item) => item.id === cursor) + 1
      const page = filtered.slice(startIndex, startIndex + limit)
      const hasMore = startIndex + limit < filtered.length
      const last = page.length > 0 ? page[page.length - 1] : undefined

      return {
        items: page.map(clone),
        nextCursor: hasMore && last !== undefined ? last.id : null,
        total: filtered.length,
      }
    },

    find(id: string): GroupBuy | null {
      const found = items.find((item) => item.id === id)
      return found === undefined ? null : clone(found)
    },

    join(id, input, now): Result<GroupBuy, RepositoryError> {
      const current = items.find((item) => item.id === id)
      if (current === undefined) {
        return err({ code: 'NOT_FOUND', message: '拼单不存在或已被下架' })
      }

      // 规则只在 domain 里写一次，mock 与真后端共用同一份判定
      const eligibility = canJoin(current, input.userId, now, input.quantity)
      if (!eligibility.allowed) {
        return err({
          code: 'CONFLICT',
          message: eligibility.message,
          details: { reason: eligibility.reason },
        })
      }

      const participant: GroupBuyParticipant = {
        id: input.userId,
        displayName: input.anonymous === true ? '匿名同学' : input.displayName,
        anonymous: input.anonymous === true,
        quantity: input.quantity,
        joinedAt: now.toISOString(),
      }

      const participants = [...current.participants, participant]
      const updated: GroupBuy = {
        ...current,
        participants,
        status: deriveStatus({ ...current, participants }, now),
        updatedAt: now.toISOString(),
      }

      items = items.map((item) => (item.id === id ? updated : item))
      return ok(clone(updated))
    },

    clear(): void {
      items = []
    },

    reset(): void {
      items = seed.map(clone)
    },
  }
}
