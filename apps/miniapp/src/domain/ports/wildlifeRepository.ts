import type { Result } from '@kedaya/shared'

import type { Page } from '@kedaya/contracts'

import type {
  CreateWildlifeSpotInput,
  WildlifeSpot,
  WildlifeSpotFilters,
} from '../models/wildlife'
import type { RepositoryError } from './errors'

/**
 * 校园动物观察点仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `wildlife.controller.ts` 一一对应，
 * 控制器挂在 `modulePath('wildlife')` 下，资源段是 `items`）：
 * ```
 * GET    /wildlife/items            列表（游标分页 + `species` 模糊筛选，最新在前）
 * POST   /wildlife/items            上报（本模块匿名，不需要登录）
 * GET    /wildlife/items/:id        详情（公开可读）
 * POST   /wildlife/items/:id/confirm 领域动作：确认为有效活动点（把 status 改成 confirmed）
 * ```
 *
 * 刻意**不暴露** `PATCH` / `DELETE`：后端有，但客户端目前没有"改我这条 / 删我这条"
 * 的入口（本模块匿名，没有归属概念）。端口只列页面真正用到的方法，
 * 免得留下一个没人调用、也没人测的写接口。
 */

export interface ListWildlifeSpotsQuery {
  cursor: string | null
  limit?: number
  filters: WildlifeSpotFilters
}

export interface WildlifeRepository {
  list(query: ListWildlifeSpotsQuery): Promise<Result<Page<WildlifeSpot>, RepositoryError>>
  detail(id: string): Promise<Result<WildlifeSpot, RepositoryError>>
  create(input: CreateWildlifeSpotInput): Promise<Result<WildlifeSpot, RepositoryError>>
  /**
   * 「我也看到了」。
   *
   * 注意语义：它是**把这条观察点的状态改成已确认**（全校共享），
   * 不是给自己加一个"我看到过"的计数；重复调用是幂等的，不返回冲突。
   */
  confirm(id: string): Promise<Result<WildlifeSpot, RepositoryError>>
}
