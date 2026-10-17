/**
 * 菜品库 mock 仓储（Web 后台，ADR 0006）。
 *
 * 与 admin mock 同风格：内存态 + 延迟 + 可故障演练；
 * 所有出入数据都过 zod（契约 §6.1：绝不放行未校验的数据）。
 */
import type { ApiError, ApiErrorCode } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import type { CreateDishInput, CanteenDish, DishPage, DishQuery, UpdateDishInput } from '@/domain/models/canteen';
import type { DishRepository } from '@/domain/ports/canteen';

import { safeParseDish, safeParseDishPage } from '../schemas/canteen';
import { createDishSeed } from './fixtures/canteen';

export interface MockDishRepositoryOptions {
  now?: () => Date;
  latencyMs?: number;
  /** 故障演练：'error' 时返回 UPSTREAM_UNAVAILABLE */
  failureMode?: 'none' | 'error';
}

function apiError(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return details === undefined ? { code, message } : { code, message, details };
}

export function createMockDishRepository(options: MockDishRepositoryOptions = {}): DishRepository {
  const now = options.now ?? (() => new Date());
  const latencyMs = options.latencyMs ?? 160;
  const failureMode = options.failureMode ?? 'none';

  let dishes: CanteenDish[] = createDishSeed(now());
  let seq = dishes.length;

  const delay = async (): Promise<void> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
  };

  const failIfNeeded = (): ApiError | null =>
    failureMode === 'error'
      ? apiError('UPSTREAM_UNAVAILABLE', '菜品库服务暂时不可用（mock 故障演练）')
      : null;

  const parsePage = (): Result<DishPage, ApiError> => {
    const page: DishPage = { items: dishes, nextCursor: null };
    const parsed = safeParseDishPage(page);
    if (!parsed.ok) return err(apiError('INTERNAL', 'mock 菜品数据不符合契约', { issues: parsed.issues }));
    return ok(parsed.value);
  };

  const parseDish = (dish: CanteenDish): Result<CanteenDish, ApiError> => {
    const parsed = safeParseDish(dish);
    if (!parsed.ok) return err(apiError('INTERNAL', 'mock 菜品数据不符合契约', { issues: parsed.issues }));
    return ok(parsed.value);
  };

  return {
    async list(query: DishQuery = {}): Promise<Result<DishPage, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const keyword = query.q?.trim().toLowerCase() ?? '';
      const filtered = dishes
        .filter((item) => query.category === undefined || item.category === query.category)
        .filter((item) => query.canteen === undefined || item.canteen === query.canteen)
        .filter((item) => keyword === '' || item.name.toLowerCase().includes(keyword));

      const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 50)), 100);
      const cursor = query.cursor ?? null;
      const startIndex = cursor === null ? 0 : filtered.findIndex((item) => item.id === cursor) + 1;
      const page = filtered.slice(startIndex, startIndex + limit);
      const hasMore = startIndex + limit < filtered.length;
      const last = page.length > 0 ? page[page.length - 1] : undefined;

      const result: DishPage = {
        items: page,
        nextCursor: hasMore && last !== undefined ? last.id : null,
      };
      const parsed = safeParseDishPage(result);
      if (!parsed.ok) return err(apiError('INTERNAL', 'mock 菜品数据不符合契约', { issues: parsed.issues }));
      return ok(parsed.value);
    },

    async detail(id: string): Promise<Result<CanteenDish, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const found = dishes.find((item) => item.id === id);
      if (found === undefined) return err(apiError('NOT_FOUND', '菜品不存在或已被删除'));
      return parseDish(found);
    },

    async create(input: CreateDishInput): Promise<Result<CanteenDish, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      seq += 1;
      const stamp = now().toISOString();
      const created: CanteenDish = { ...input, id: `dish-mock-${seq}`, createdAt: stamp, updatedAt: stamp };
      dishes = [created, ...dishes];
      return parseDish(created);
    },

    async update(id: string, input: UpdateDishInput): Promise<Result<CanteenDish, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const index = dishes.findIndex((item) => item.id === id);
      // noUncheckedIndexedAccess：先取局部变量并守卫，避免把 undefined 摊进更新结果
      const current = index === -1 ? undefined : dishes[index];
      if (current === undefined) return err(apiError('NOT_FOUND', '菜品不存在或已被删除'));
      const updated: CanteenDish = { ...current, ...input, id, updatedAt: now().toISOString() };
      dishes = dishes.map((item, i) => (i === index ? updated : item));
      return parseDish(updated);
    },

    async remove(id: string): Promise<Result<{ id: string; deleted: true }, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);
      const index = dishes.findIndex((item) => item.id === id);
      if (index === -1) return err(apiError('NOT_FOUND', '菜品不存在或已被删除'));
      dishes = dishes.filter((item) => item.id !== id);
      return ok({ id, deleted: true });
    },
  };
}
