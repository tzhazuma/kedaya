import type { Result } from '@kedaya/shared'

import type { CardLostReport, CardOverview } from '../models/campusCard'
import type { RepositoryError } from './errors'

/**
 * 校园卡仓储端口。
 *
 * 端点（后端 `CampusCardController`）：
 * ```
 * GET /campus-card/overview?thresholdFen=   余额 + 流水 + 低余额 + 还能撑几天 + 异常扣款
 * GET /campus-card/lost-report?reason=      挂失指引（会写审计）
 * ```
 *
 * 约定：`overview` 成功后用例层会落本地缓存；
 * 上游不可用时后端会**自己**返回缓存并置 `stale: true`，
 * 客户端的缓存只用于"连后端都连不上"的极端情况。
 */
export interface CampusCardRepository {
  overview(thresholdFen?: number): Promise<Result<CardOverview, RepositoryError>>
  lostReport(reason?: string): Promise<Result<CardLostReport, RepositoryError>>
}
