import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import { canJoin, deriveStatus } from '../../domain/models/groupbuy'
import type { GroupBuy, GroupBuyCategory, GroupBuyParticipant } from '../../domain/models/groupbuy'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  CreateGroupBuyInput,
  GroupBuyPage,
  JoinGroupBuyInput,
  ListGroupBuysQuery,
} from '../../domain/ports/groupbuyRepository'

/**
 * 内存数据库 —— mock repository 的存储内核。
 *
 * 游标分页语义与后端保持一致（契约 §6.1）：`cursor` 是**上一条记录的 id**，
 * 不是 offset。这样 UI 的分页逻辑在切到真后端时不需要改。
 *
 * 「我的拼单」需要知道当前用户是谁，而领域模型里没有"当前用户"这个概念
 * （它永远来自会话），因此由装配层把 `viewerId` 注入进来。
 */

export interface MemoryDatabaseOptions {
  /** 当前登录用户（未登录返回 null）—— 只用于「我的拼单」筛选 */
  viewerId?: () => string | null
}

export interface MemoryDatabase {
  list(query?: ListGroupBuysQuery): GroupBuyPage
  find(id: string): GroupBuy | null
  create(input: CreateGroupBuyInput & { initiatorId: string }, now: Date): GroupBuy
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

export function createMemoryDatabase(
  seed: readonly GroupBuy[] = [],
  options: MemoryDatabaseOptions = {},
): MemoryDatabase {
  const viewerId = options.viewerId ?? ((): string | null => null)
  let items: GroupBuy[] = seed.map(clone)
  /** 新建拼单的自增序号：与种子 id（`gb-1001`）区分开，避免撞号 */
  let createdCount = 0

  /** 「我参与的」排除自己发起的 —— 与后端行为一致，否则同一张单会出现两次 */
  function matchesMine(groupBuy: GroupBuy, query: ListGroupBuysQuery): boolean {
    if (query.mine !== true) return true
    const me = viewerId()
    // 未登录时服务端会返回 UNAUTHENTICATED；mock 里退化成"什么都看不到"，
    // 页面拿到空列表 + 未登录提示，效果等价。
    if (me === null) return false
    if (query.role === 'owner') return groupBuy.initiatorId === me
    return groupBuy.initiatorId !== me && groupBuy.participants.some((p) => p.id === me)
  }

  return {
    list(query: ListGroupBuysQuery = {}): GroupBuyPage {
      const limit = clampLimit(query.limit)
      const category = query.category

      const filtered = items
        .filter((item) => category === undefined || category === 'all' || item.category === category)
        .filter((item) => matchesKeyword(item, query.keyword))
        .filter((item) => matchesMine(item, query))
        .sort((a, b) =>
          query.sort === 'deadline'
            ? a.deadline.localeCompare(b.deadline)
            : b.createdAt.localeCompare(a.createdAt),
        )

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

    create(input, now): GroupBuy {
      createdCount += 1
      const initiator: GroupBuyParticipant = {
        id: input.initiatorId,
        displayName: input.initiatorName ?? '我',
        anonymous: false,
        // 发起人自己算 1 份 —— 真后端在建单时也会写入这条 owner 成员记录
        quantity: 1,
        joinedAt: now.toISOString(),
      }
      const created: GroupBuy = {
        id: `gb-new-${createdCount}`,
        title: input.title,
        description: input.description ?? '',
        category: input.category as GroupBuyCategory,
        initiatorId: input.initiatorId,
        initiatorName: input.initiatorName ?? '我',
        priceFen: input.priceFen,
        targetCount: input.targetCount,
        participants: [initiator],
        deadline: input.deadline,
        pickupPlace: input.pickupPlace ?? '',
        status: 'open',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }
      items = [created, ...items]
      return clone(created)
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
      createdCount = 0
    },
  }
}
