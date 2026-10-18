import type { Page } from '@kedaya/contracts'
import type { Result } from '@kedaya/shared'

import type {
  CreateFacilityBookingInput,
  FacilityBooking,
} from '../models/facility'
import type { RepositoryError } from './errors'

/**
 * 场馆预约仓储端口 —— http / mock 两套实现（契约 §7 硬规则 3、4）。
 *
 * 端点形状（与后端 `facility.controller.ts` 一一对应，
 * 控制器挂在 `modulePath('facility')` 下，资源段是 `items`）：
 * ```
 * GET    /facility/items               列表（游标分页）
 * POST   /facility/items               创建（需登录 + Idempotency-Key）
 * GET    /facility/items/:id           详情
 * PATCH  /facility/items/:id           修改（Merge Patch）
 * DELETE /facility/items/:id           删除
 * POST   /facility/items/:id/cancel    取消（仅发起人，booked → cancelled）
 * ```
 *
 * ⚠️ **时段冲突由服务端判定**（`findOverlapping`），客户端拿到的是一次 409。
 * 端口里没有「查可用时段」的方法 —— 因为那需要完整的占用视图，
 * 而后端目前只提供分页列表。真要做"选时段时实时置灰"，
 * 需要后端新增一个 `GET /facility/availability?from=&to=`，那是独立的一件事。
 */
export interface FacilityRepository {
  list(input: { cursor: string | null; limit: number }): Promise<Result<Page<FacilityBooking>, RepositoryError>>;
  detail(id: string): Promise<Result<FacilityBooking, RepositoryError>>;
  create(input: CreateFacilityBookingInput): Promise<Result<FacilityBooking, RepositoryError>>;
  cancel(id: string): Promise<Result<FacilityBooking, RepositoryError>>;
}
