import type { ApiError } from '@kedaya/contracts';
import type { Result } from '@kedaya/shared';

import type { CreateDishInput, CanteenDish, DishPage, DishQuery, UpdateDishInput } from '../models/canteen';

/**
 * 菜品库仓储端口（营养管家园后台，ADR 0006）。
 *
 * 依赖方向（契约 §7）：presentation → application → domain ← data。
 * mock / http 两套实现都由装配层（data/repositories）注入。
 */
export interface DishRepository {
  list(query?: DishQuery): Promise<Result<DishPage, ApiError>>;
  detail(id: string): Promise<Result<CanteenDish, ApiError>>;
  create(input: CreateDishInput): Promise<Result<CanteenDish, ApiError>>;
  update(id: string, input: UpdateDishInput): Promise<Result<CanteenDish, ApiError>>;
  remove(id: string): Promise<Result<{ id: string; deleted: true }, ApiError>>;
}
