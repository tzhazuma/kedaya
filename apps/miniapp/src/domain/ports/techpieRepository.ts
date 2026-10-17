import type { Page } from '@kedaya/contracts'
import type { Result } from '@kedaya/shared'

import type {
  CreateTechpieLinkInput,
  TechpieLink,
  TechpieLinkFilters,
} from '../models/techpie'
import type { RepositoryError } from './errors'

/**
 * TechPie 整合仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `techpie.controller.ts` 一一对应，
 * 控制器挂在 `modulePath('techpie')` 下，资源段是 `items`）：
 * ```
 * GET  /techpie/items            列表（游标分页 + 分类精确 / 关键词模糊筛选，最新在前）
 * POST /techpie/items            创建（匿名共建，不需要登录）
 * GET  /techpie/items/:id        详情（公开可读）
 * POST /techpie/items/:id/sync   领域动作：标记一次**人工核对**（不改任何外部状态）
 * ```
 *
 * ⚠️ `sync` 的语义必须在这里就说清楚，否则页面很容易把它写成"与系统同步"：
 * 它**不发起任何外部请求**，只是把 `status` 写成 `synced`，并靠 Prisma 的
 * `@updatedAt` 推进 `updatedAt`（客户端把 `updatedAt` 展示成「最后核对」）。
 * 重复调用幂等，不返回冲突。
 *
 * 刻意**不暴露** `PATCH` / `DELETE`：后端有，但客户端目前没有"改我这条 / 删我这条"
 * 的入口（本模块匿名共建，没有归属概念，乱写的条目走举报 + 人工复核）。
 * 端口只列页面真正用到的方法，免得留下没人调用也没人测的写接口。
 */

export interface ListTechpieLinksQuery {
  cursor: string | null
  limit?: number
  filters: TechpieLinkFilters
}

export interface TechpieRepository {
  list(query: ListTechpieLinksQuery): Promise<Result<Page<TechpieLink>, RepositoryError>>
  detail(id: string): Promise<Result<TechpieLink, RepositoryError>>
  create(input: CreateTechpieLinkInput): Promise<Result<TechpieLink, RepositoryError>>
  /**
   * 「我核对过了」。
   *
   * 注意语义：它是**把这条记录的状态改成已核对**（共建共享），不是给自己记一次打卡；
   * 重复调用是幂等的，不返回冲突。它**不会**去对端系统拉取任何数据。
   */
  sync(id: string): Promise<Result<TechpieLink, RepositoryError>>
}
