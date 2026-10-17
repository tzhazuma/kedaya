import type { Page } from '@kedaya/contracts'
import type { Result } from '@kedaya/shared'

import type {
  CanteenCalorieSummary,
  CanteenDish,
  CanteenDishFilters,
  CreateCanteenDishInput,
} from '../models/canteen'
import type { RepositoryError } from './errors'

/**
 * 食堂营养仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `canteen.controller.ts` 一一对应，
 * 控制器挂在 `modulePath('canteen')` 下，资源段是 `items`）：
 * ```
 * GET  /canteen/items                列表（游标分页 + 食堂精确 / 菜名模糊筛选，最新在前）
 * POST /canteen/items                创建（匿名，无归属字段）
 * GET  /canteen/items/:id            详情（公开可读）
 * GET  /canteen/calories?canteen=    按食堂汇总热量与均价（整数分）
 * ```
 *
 * 本模块**不提供**改 / 删：菜品数据匿名共建，客户端没有安全的编辑归属语义，
 * 需要治理时由后台处理；因此端口刻意只暴露 list / detail / create / calories 四个方法。
 */

export interface ListCanteenDishesQuery {
  cursor: string | null
  limit?: number
  filters: CanteenDishFilters
}

export interface CanteenRepository {
  list(query: ListCanteenDishesQuery): Promise<Result<Page<CanteenDish>, RepositoryError>>
  detail(id: string): Promise<Result<CanteenDish, RepositoryError>>
  create(input: CreateCanteenDishInput): Promise<Result<CanteenDish, RepositoryError>>
  /** 某食堂的营养汇总（`canteen` 为空时返回 VALIDATION_FAILED） */
  calories(canteen: string): Promise<Result<CanteenCalorieSummary, RepositoryError>>
}
