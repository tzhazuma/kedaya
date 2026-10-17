import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import { canJoin, deriveStatus } from '../../domain/models/groupbuy'
import type { GroupBuy, GroupBuyParticipant } from '../../domain/models/groupbuy'
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
 */

export interface MemoryDatabase {
  list(query?: ListGroupBuysQuery): GroupBuyPage
  find(id: string): GroupBuy | null
  join(id: string, input: JoinGroupBuyInput, now: Date): Result<GroupBuy, RepositoryError>
  create(input: CreateGroupBuyInput, now: Date): Result<GroupBuy, RepositoryError>
  withdraw(id: string, userId: string, now: Date): Result<GroupBuy, RepositoryError>
  cancel(id: string, userId: string, now: Date): Result<GroupBuy, RepositoryError>
  publishPickupNotice(id: string, userId: string, notice: string): Result<GroupBuy, RepositoryError>
  markReceived(id: string, userId: string, memberId: string, received: boolean, now: Date): Result<GroupBuy, RepositoryError>
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

      const options = current.itemOptions?.length ? current.itemOptions : [current.itemSpec || current.title]
      const selections = input.selections ?? [{ item: options[0]!, quantity: input.quantity }]
      if (selections.reduce((sum, line) => sum + line.quantity, 0) !== input.quantity ||
        selections.some((line) => !options.includes(line.item) || !Number.isInteger(line.quantity) || line.quantity < 1)) {
        return err({ code: 'VALIDATION_FAILED', message: '请按商品填写正确的份数' })
      }

      const participant: GroupBuyParticipant = {
        id: input.userId,
        displayName: input.anonymous === true ? '匿名同学' : input.displayName,
        anonymous: input.anonymous === true,
        quantity: input.quantity,
        joinedAt: now.toISOString(),
        note: input.note,
        selections,
      }

      const participants = [...current.participants.filter((p) => p.id !== input.userId), participant]
      const updated: GroupBuy = {
        ...current,
        participants,
        status: deriveStatus({ ...current, participants }, now),
        updatedAt: now.toISOString(),
      }

      items = items.map((item) => (item.id === id ? updated : item))
      return ok(clone(updated))
    },

    create(input, now): Result<GroupBuy, RepositoryError> {
      if (!Number.isInteger(input.targetCount) || input.targetCount < 1 || !input.title.trim() || !input.pickupPlace.trim()) {
        return err({ code: 'VALIDATION_FAILED', message: '请填写标题、目标份数和取货地点' })
      }
      if (input.kind === 'membership' && (!input.merchantName?.trim() || !input.membershipDeclaration)) {
        return err({ code: 'VALIDATION_FAILED', message: '请填写商家并确认本人持有会员资格' })
      }
      const options = input.itemOptions?.length ? input.itemOptions : [input.itemSpec.trim()]
      if (options.length === 0 || options.some((item) => !item.trim()) || new Set(options).size !== options.length) {
        return err({ code: 'VALIDATION_FAILED', message: '请填写不重复的商品与规格' })
      }
      const created: GroupBuy = {
        id: `gb-${now.getTime()}-${items.length + 1}`,
        title: input.title.trim(), description: input.description.trim(),
        category: input.category as GroupBuy['category'],
        initiatorId: input.initiatorId, initiatorName: input.initiatorName,
        priceFen: input.priceFen, targetCount: input.targetCount,
        participants: [], deadline: new Date(now.getTime() + 86_400_000).toISOString(),
        pickupPlace: input.pickupPlace.trim(), status: 'open',
        kind: input.kind, merchantName: input.merchantName?.trim(), itemSpec: options.join('、'), itemOptions: options,
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
      }
      items = [created, ...items]
      return ok(clone(created))
    },

    withdraw(id, userId, now): Result<GroupBuy, RepositoryError> {
      const current = items.find((item) => item.id === id)
      if (!current) return err({ code: 'NOT_FOUND', message: '拼单不存在' })
      if (deriveStatus(current, now) !== 'open') return err({ code: 'CONFLICT', message: '拼单已结束，不能退出' })
      if (!current.participants.some((p) => p.id === userId)) return err({ code: 'CONFLICT', message: '你尚未参团' })
      const updated = { ...current, participants: current.participants.filter((p) => p.id !== userId), updatedAt: now.toISOString() }
      items = items.map((item) => item.id === id ? updated : item)
      return ok(clone(updated))
    },

    cancel(id, userId, now): Result<GroupBuy, RepositoryError> {
      const current = items.find((item) => item.id === id)
      if (!current) return err({ code: 'NOT_FOUND', message: '拼单不存在' })
      if (current.initiatorId !== userId) return err({ code: 'FORBIDDEN', message: '只有发起人可以取消' })
      if (deriveStatus(current, now) !== 'open') return err({ code: 'CONFLICT', message: '拼单已结束' })
      const updated: GroupBuy = { ...current, status: 'cancelled', cancelReason: 'CREATOR_CANCELLED', updatedAt: now.toISOString() }
      items = items.map((item) => item.id === id ? updated : item)
      return ok(clone(updated))
    },

    publishPickupNotice(id, userId, notice): Result<GroupBuy, RepositoryError> {
      const current = items.find((item) => item.id === id)
      if (!current) return err({ code: 'NOT_FOUND', message: '拼单不存在' })
      if (current.initiatorId !== userId) return err({ code: 'FORBIDDEN', message: '只有发起人可以发布取货通知' })
      if (current.status !== 'full') return err({ code: 'CONFLICT', message: '成团后才能发布取货通知' })
      if (!notice.trim()) return err({ code: 'VALIDATION_FAILED', message: '通知不能为空' })
      const updated = { ...current, pickupNotice: notice.trim() }
      items = items.map((item) => item.id === id ? updated : item)
      return ok(clone(updated))
    },

    markReceived(id, userId, memberId, received, now): Result<GroupBuy, RepositoryError> {
      const current = items.find((item) => item.id === id)
      if (!current) return err({ code: 'NOT_FOUND', message: '拼单不存在' })
      if (current.initiatorId !== userId) return err({ code: 'FORBIDDEN', message: '只有发起人可以标记领取' })
      if (current.status !== 'full') return err({ code: 'CONFLICT', message: '成团后才能标记领取' })
      if (!current.participants.some((member) => member.id === memberId)) return err({ code: 'NOT_FOUND', message: '参团成员不存在' })
      const updated = { ...current, participants: current.participants.map((member) => member.id === memberId ? { ...member, receivedAt: received ? now.toISOString() : null } : member) }
      items = items.map((item) => item.id === id ? updated : item)
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
