import type { Result } from '@kedaya/shared'

import type { Page } from '@kedaya/contracts'

import type { CreateFaqEntryInput, FaqEntry, FaqEntryFilters } from '../models/faq'
import type { RepositoryError } from './errors'

/**
 * 常见问题仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `faq.controller.ts` 一一对应，
 * 控制器挂在 `modulePath('faq')` 下，资源段是 `items`）：
 * ```
 * GET    /faq/items                  列表（游标分页 + category 精确 + q 模糊，最新在前）
 * POST   /faq/items                  新增条目（公开可提交：本模块低敏感，允许匿名）
 * GET    /faq/items/:id              详情（公开可读）
 * POST   /faq/items/:id/helpful      领域动作：有帮助（**无脑 +1**，条目不存在时 404）
 * ```
 *
 * 端口刻意**不**包含 `update` / `remove`：客户端只做「检索 + 共建 + 点赞」三件事，
 * 条目的改写/下架由管理端负责（后端仍保留 `PATCH` / `DELETE`）。
 * 多一个用不到的方法，只会让 mock 实现里多一段没人跑过的代码。
 */

export interface ListFaqEntriesQuery {
  cursor: string | null
  limit?: number
  filters: FaqEntryFilters
}

export interface FaqRepository {
  list(query: ListFaqEntriesQuery): Promise<Result<Page<FaqEntry>, RepositoryError>>
  detail(id: string): Promise<Result<FaqEntry, RepositoryError>>
  create(input: CreateFaqEntryInput): Promise<Result<FaqEntry, RepositoryError>>
  /**
   * 标记「有帮助」。
   *
   * ⚠️ 服务端语义是**无脑 +1**（不是一人一票）：每调用一次就 +1。
   * 去重责任在用例层（本地记录已标记的 id），不要在仓储层假装它是幂等的。
   */
  markHelpful(id: string): Promise<Result<FaqEntry, RepositoryError>>
}
