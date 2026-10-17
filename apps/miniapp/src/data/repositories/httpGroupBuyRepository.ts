import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'
import type { GroupBuy } from '../../domain/models/groupbuy'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  CreateGroupBuyInput, GroupBuyPage, GroupBuyRepository, JoinGroupBuyInput, ListGroupBuysQuery,
} from '../../domain/ports/groupbuyRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

interface ApiOrder {
  id: string
  ownerId: string
  title: string
  description: string | null
  category: string
  itemSpec: string | null
  itemOptions: string[]
  targetCount: number
  unitPriceFen: number
  status: 'open' | 'grouped' | 'cancelled'
  deadline: string
  pickupSpot: string | null
  kind: 'ordinary' | 'membership'
  merchantName: string | null
  cancelReason: 'TIMEOUT_24H' | 'CREATOR_CANCELLED' | null
  pickupNotice: string | null
  createdAt: string
  updatedAt: string
  members: Array<{ userId: string; displayName: string; quantity: number; note: string | null; joinedAt: string; receivedAt: string | null; selections: Array<{ item: string; quantity: number }> }>
}

function toGroupBuy(order: ApiOrder): GroupBuy {
  return {
    id: order.id, title: order.title, description: order.description ?? '',
    category: order.category as GroupBuy['category'],
    initiatorId: order.ownerId, initiatorName: '发起同学',
    priceFen: order.unitPriceFen, targetCount: order.targetCount,
    participants: order.members.map((member) => ({
      id: member.userId, displayName: member.displayName, anonymous: false,
      quantity: member.quantity, joinedAt: member.joinedAt, note: member.note ?? undefined,
      receivedAt: member.receivedAt,
      selections: member.selections,
    })),
    deadline: order.deadline, pickupPlace: order.pickupSpot ?? '',
    status: order.status === 'grouped' ? 'full' : order.status,
    kind: order.kind, merchantName: order.merchantName ?? undefined,
    itemSpec: order.itemSpec ?? undefined,
    itemOptions: order.itemOptions,
    cancelReason: order.cancelReason ?? undefined,
    pickupNotice: order.pickupNotice ?? undefined,
    createdAt: order.createdAt, updatedAt: order.updatedAt,
  }
}

export function createHttpGroupBuyRepository(client: ApiClient): GroupBuyRepository {
  const base = modulePath('groupbuy', 'items')
  const itemPath = (id: string) => modulePath('groupbuy', 'items', encodeURIComponent(id))
  const convert = (result: Result<ApiOrder, { code: string; message: string }>): Result<GroupBuy, RepositoryError> =>
    result.ok ? ok(toGroupBuy(result.value)) : err(toRepositoryError(result.error as Parameters<typeof toRepositoryError>[0]))

  return {
    async list(query: ListGroupBuysQuery = {}): Promise<Result<GroupBuyPage, RepositoryError>> {
      const result = await client.get<Page<ApiOrder>>(base, {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        category: query.category === 'all' ? undefined : query.category,
        keyword: query.keyword,
      })
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({ items: result.value.items.map(toGroupBuy), nextCursor: result.value.nextCursor, total: result.value.total })
    },
    async detail(id) {
      return convert(await client.get<ApiOrder>(itemPath(id)))
    },
    async join(id, input: JoinGroupBuyInput) {
      return convert(await client.post<ApiOrder>(`${itemPath(id)}/join`, {
        quantity: input.quantity, displayName: input.displayName, note: input.note, selections: input.selections,
      }, { idempotencyKey: input.idempotencyKey }))
    },
    async create(input: CreateGroupBuyInput) {
      return convert(await client.post<ApiOrder>(base, {
        title: input.title, description: input.description, category: input.category,
        itemSpec: input.itemSpec, items: input.itemOptions, targetCount: input.targetCount,
        unitPriceFen: input.priceFen, pickupSpot: input.pickupPlace,
        kind: input.kind, merchantName: input.merchantName,
        membershipDeclaration: input.membershipDeclaration,
      }, { idempotencyKey: input.idempotencyKey ?? `groupbuy:create:${Date.now()}:${Math.random().toString(36).slice(2)}` }))
    },
    async withdraw(id) {
      return convert(await client.del<ApiOrder>(`${itemPath(id)}/join`))
    },
    async cancel(id) {
      return convert(await client.del<ApiOrder>(itemPath(id)))
    },
    async publishPickupNotice(id, _userId, notice) {
      return convert(await client.post<ApiOrder>(`${itemPath(id)}/pickup-notice`, { notice }))
    },
    async markReceived(id, _userId, memberId, received) {
      return convert(await client.patch<ApiOrder>(`${itemPath(id)}/members/${encodeURIComponent(memberId)}/received`, { received }))
    },
  }
}
