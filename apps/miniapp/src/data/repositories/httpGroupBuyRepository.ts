import { DEFAULT_PAGE_SIZE, modulePath } from '@kedaya/contracts'
import type { Page } from '@kedaya/contracts'
import { err, ok, type Result } from '@kedaya/shared'

import type { GroupBuy, GroupBuyParticipant } from '../../domain/models/groupbuy'
import type { RepositoryError } from '../../domain/ports/errors'
import type {
  CreateGroupBuyInput,
  GroupBuyPage,
  GroupBuyRepository,
  JoinGroupBuyInput,
  ListGroupBuysQuery,
} from '../../domain/ports/groupbuyRepository'
import type { ApiClient } from '../api/request'
import { toRepositoryError } from './toRepositoryError'

/**
 * 真后端拼单仓储 —— 契约 §6.1 的 CRUD 形状：
 *
 * ```
 * GET    /api/v1/groupbuy/items            列表（游标分页；category / keyword / sort / mine+role）
 * POST   /api/v1/groupbuy/items            发起（归属来自 JWT）
 * GET    /api/v1/groupbuy/items/:id        详情
 * POST   /api/v1/groupbuy/items/:id/join   参团
 * ```
 *
 * 注意：这里**只**做「URL + 类型」的映射，信封解包、Bearer、trace、401 重试
 * 全部由 `ApiClient` 负责（契约 §7 硬规则 3）。
 *
 * 服务端返回的就是前端的 `GroupBuy` 形状（同名同义），因此不需要逐字段改名；
 * 但**可空字段仍要归一化**：服务端 `description` / `pickupPlace` 可以是 `null`，
 * 而前端的模型是 `string`。不归一化的话，详情页会渲染出 `null` 两个字。
 */

/** 服务端行的松散形状：只把"可能为 null / undefined"的字段标出来 */
type GroupBuyRow = Omit<GroupBuy, 'description' | 'pickupPlace' | 'participants'> & {
  description?: string | null
  pickupPlace?: string | null
  participants?: ReadonlyArray<Omit<GroupBuyParticipant, 'anonymous'> & { anonymous?: boolean }>
}

function toGroupBuy(row: GroupBuyRow): GroupBuy {
  return {
    ...row,
    description: row.description ?? '',
    pickupPlace: row.pickupPlace ?? '',
    participants: (row.participants ?? []).map((participant) => ({
      ...participant,
      anonymous: participant.anonymous ?? false,
    })),
  }
}

export function createHttpGroupBuyRepository(client: ApiClient): GroupBuyRepository {
  return {
    async list(query: ListGroupBuysQuery = {}): Promise<Result<GroupBuyPage, RepositoryError>> {
      const category = query.category
      const mine = query.mine === true

      const result = await client.get<Page<GroupBuyRow>>(modulePath('groupbuy', 'items'), {
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? DEFAULT_PAGE_SIZE,
        category: category === undefined || category === 'all' ? undefined : category,
        keyword: query.keyword,
        // 服务端只认 `1` / `true`；`mine=0` 表示"不要筛选"
        mine: mine ? 1 : undefined,
        // ⚠️ 服务端在 `mine=1` 且 role 非法时**默认按「我参与的」处理**，
        // 因此这里必须显式带上 role，不能让用户点了"我发起的"却看到"我参与的"。
        role: mine ? (query.role ?? 'member') : undefined,
        sort: query.sort,
      })

      if (!result.ok) return err(toRepositoryError(result.error))
      return ok({
        items: result.value.items.map(toGroupBuy),
        nextCursor: result.value.nextCursor,
        total: result.value.total,
      })
    },

    async detail(id: string): Promise<Result<GroupBuy, RepositoryError>> {
      const result = await client.get<GroupBuyRow>(
        modulePath('groupbuy', 'items', encodeURIComponent(id)),
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(toGroupBuy(result.value))
    },

    async create(input: CreateGroupBuyInput): Promise<Result<GroupBuy, RepositoryError>> {
      const result = await client.post<GroupBuyRow, Record<string, unknown>>(
        modulePath('groupbuy', 'items'),
        {
          title: input.title,
          description: input.description ?? null,
          category: input.category,
          targetCount: input.targetCount,
          // 服务端字段名是 `unitPriceFen`（与 domain 的 `priceFen` 不同名，这里显式映射）
          unitPriceFen: input.priceFen,
          deadline: input.deadline,
          pickupSpot: input.pickupPlace ?? null,
        },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(toGroupBuy(result.value))
    },

    async join(id: string, input: JoinGroupBuyInput): Promise<Result<GroupBuy, RepositoryError>> {
      const result = await client.post<GroupBuyRow, { quantity: number }>(
        modulePath('groupbuy', 'items', encodeURIComponent(id), 'join'),
        { quantity: input.quantity },
        input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey },
      )
      if (!result.ok) return err(toRepositoryError(result.error))
      return ok(toGroupBuy(result.value))
    },
  }
}
