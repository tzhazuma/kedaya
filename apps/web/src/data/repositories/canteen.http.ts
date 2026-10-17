/**
 * 菜品库 HTTP 仓储（Web 后台，契约 §6.1 的 CRUD 形状）。
 *
 * ```
 * GET    /canteen/dishes      检索（q/category/cursor/limit）
 * GET    /canteen/items/:id   详情
 * POST   /canteen/items       新建
 * PATCH  /canteen/items/:id    更新
 * DELETE /canteen/items/:id    删除/下架
 * ```
 *
 * 信封解包由 ApiClient 负责；这里只做 URL + zod 校验。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import type { CreateDishInput, CanteenDish, DishPage, DishQuery, UpdateDishInput } from '@/domain/models/canteen';
import type { DishRepository } from '@/domain/ports/canteen';

import type { ApiClient } from '../api/client';
import { safeParseDish, safeParseDishPage } from '../schemas/canteen';
import { toApiError } from './groupbuy.http';

const DISHES_PATH = '/canteen/dishes';
const ITEMS_PATH = '/canteen/items';

/**
 * 管理员的写权限头。
 *
 * 菜品库是营养管家的数据地基，后端写接口已改为 `AdminGuard`（fail-closed）：
 * 要么带 `x-admin-key`（`ADMIN_API_KEY`），要么是 `ADMIN_USER_IDS` 里的登录用户。
 *
 * ⚠️ 这里用 `NEXT_PUBLIC_` 前缀是为了让后台在**开发/演示**环境能直接写入；
 * 它会把 key 暴露给浏览器，生产必须换成「管理员登录 + 服务端代理」，
 * 见 README「营养管家 · 权限」。
 */
function adminHeaders(): Record<string, string> {
  const key = process.env.NEXT_PUBLIC_ADMIN_API_KEY;
  return typeof key === 'string' && key !== '' ? { 'x-admin-key': key } : {};
}

export function createDishHttpRepository(client: ApiClient): DishRepository {
  return {
    async list(query: DishQuery = {}): Promise<Result<DishPage, ApiError>> {
      const result = await client.get<unknown>(DISHES_PATH, {
        q: query.q,
        category: query.category,
        cursor: query.cursor ?? undefined,
        limit: query.limit ?? 50,
      });
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseDishPage(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的菜品数据不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async detail(id: string): Promise<Result<CanteenDish, ApiError>> {
      const result = await client.get<unknown>(`${ITEMS_PATH}/${encodeURIComponent(id)}`);
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseDish(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的菜品数据不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async create(input: CreateDishInput): Promise<Result<CanteenDish, ApiError>> {
      const result = await client.post<unknown>(ITEMS_PATH, input, { headers: adminHeaders() });
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseDish(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的菜品数据不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async update(id: string, input: UpdateDishInput): Promise<Result<CanteenDish, ApiError>> {
      const result = await client.patch<unknown>(`${ITEMS_PATH}/${encodeURIComponent(id)}`, input, {
        headers: adminHeaders(),
      });
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseDish(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的菜品数据不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async remove(id: string): Promise<Result<{ id: string; deleted: true }, ApiError>> {
      const result = await client.del<unknown>(`${ITEMS_PATH}/${encodeURIComponent(id)}`, {
        headers: adminHeaders(),
      });
      if (!result.ok) return err(toApiError(result.error));
      return ok({ id, deleted: true });
    },
  };
}
