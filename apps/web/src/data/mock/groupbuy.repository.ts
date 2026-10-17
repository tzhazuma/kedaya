/**
 * 拼单 mock 适配器（契约 §7 硬规则 4：必须有 mock，UI 才能脱离后端开发）。
 *
 * 行为对齐真实后端的**契约形状**：返回 `Result<Page<...>, ApiError>`，
 * 错误码用冻结的 `ApiErrorCode`（NOT_FOUND / CONFLICT / VALIDATION_FAILED / UPSTREAM_UNAVAILABLE）。
 * 所有出站数据都过一遍 zod schema —— mock 也不能绕过契约校验。
 */
import type { ApiError, ApiErrorCode, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import { isJoinable, remainingSlots, validateGroupBuyItem } from '@/domain/models/groupbuy';
import type { GroupBuyDetail, GroupBuyItem } from '@/domain/models/groupbuy';
import type {
  GroupBuyListQuery,
  GroupBuyRepository,
  MockFailureMode,
} from '@/domain/ports/groupbuy';

import { safeParseGroupBuyDetail, safeParseGroupBuyPage } from '../schemas/groupbuy';
import { createGroupBuySeed, toGroupBuyItem } from './fixtures/groupbuy';

export interface MockGroupBuyOptions {
  /** 注入时钟（测试用固定时间） */
  now?: () => Date;
  /** 模拟网络延迟，用于演示骨架屏 */
  latencyMs?: number;
  /** 故障演练：'error' 时所有请求返回 UPSTREAM_UNAVAILABLE */
  failureMode?: MockFailureMode;
  /** 覆盖数据集 */
  seed?: readonly GroupBuyDetail[];
  /** 默认页大小 */
  pageSize?: number;
}

export interface MockGroupBuyRepository extends GroupBuyRepository {
  setFailureMode(mode: MockFailureMode): void;
  getFailureMode(): MockFailureMode;
  /** 恢复到初始数据集 */
  reset(): void;
}

function apiError(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return details === undefined ? { code, message } : { code, message, details };
}

function clone(detail: GroupBuyDetail): GroupBuyDetail {
  return structuredClone(detail);
}

/** 游标编码：真实后端是不透明字符串，mock 用 offset 模拟（契约 §6.1 只要求 cursor 语义） */
export function encodeCursor(offset: number): string {
  return `c_${offset}`;
}

export function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  const match = /^c_(\d+)$/.exec(cursor);
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function clampLimit(limit: number | undefined, fallback = 20): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(100, Math.max(1, Math.trunc(limit)));
}

/** 关键词 + 状态过滤（纯函数，可单测） */
export function filterGroupBuyItems(
  items: readonly GroupBuyItem[],
  query: GroupBuyListQuery,
): GroupBuyItem[] {
  const keyword = query.keyword?.trim().toLowerCase();
  return items.filter((item) => {
    if (query.status && item.status !== query.status) return false;
    if (!keyword) return true;
    return (
      item.title.toLowerCase().includes(keyword) ||
      item.merchant.toLowerCase().includes(keyword) ||
      item.pickupSpot.toLowerCase().includes(keyword)
    );
  });
}

export function createMockGroupBuyRepository(
  options: MockGroupBuyOptions = {},
): MockGroupBuyRepository {
  const now = options.now ?? (() => new Date());
  const latencyMs = options.latencyMs ?? 260;
  const pageSize = options.pageSize ?? 20;
  let failureMode: MockFailureMode = options.failureMode ?? 'none';

  const initial = (): GroupBuyDetail[] =>
    (options.seed ? [...options.seed] : createGroupBuySeed(now())).map(clone);
  let store: GroupBuyDetail[] = initial();

  const delay = async (): Promise<void> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
  };

  const failIfNeeded = (): ApiError | null =>
    failureMode === 'error'
      ? apiError('UPSTREAM_UNAVAILABLE', '拼单服务暂时不可用（mock 故障演练）')
      : null;

  return {
    async list(query: GroupBuyListQuery): Promise<Result<Page<GroupBuyItem>, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const filtered = filterGroupBuyItems(store.map(toGroupBuyItem), query);
      const offset = decodeCursor(query.cursor);
      const limit = clampLimit(query.limit, pageSize);
      const items = filtered.slice(offset, offset + limit);
      const nextOffset = offset + items.length;

      const page = {
        items,
        nextCursor: nextOffset < filtered.length ? encodeCursor(nextOffset) : null,
        total: filtered.length,
      };

      const parsed = safeParseGroupBuyPage(page);
      if (!parsed.ok) {
        return err(
          apiError('INTERNAL', 'mock 数据不符合冻结契约', { issues: parsed.issues }),
        );
      }
      return ok(parsed.value);
    },

    async detail(id: string): Promise<Result<GroupBuyDetail, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const found = store.find((d) => d.id === id);
      if (!found) return err(apiError('NOT_FOUND', `拼单不存在：${id}`));

      const parsed = safeParseGroupBuyDetail(found);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 数据不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(parsed.value);
    },

    async join(id: string, quantity: number): Promise<Result<GroupBuyDetail, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const index = store.findIndex((d) => d.id === id);
      const current = index >= 0 ? store[index] : undefined;
      if (!current) return err(apiError('NOT_FOUND', `拼单不存在：${id}`));

      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        return err(apiError('VALIDATION_FAILED', '参团份数必须是正整数'));
      }
      if (current.status !== 'recruiting') {
        return err(apiError('CONFLICT', '该拼单已不在拼单中'));
      }
      if (!isJoinable(current, now())) {
        return err(
          apiError(
            'CONFLICT',
            remainingSlots(current) <= 0 ? '名额已满' : '已过截止时间',
          ),
        );
      }
      if (quantity > remainingSlots(current)) {
        return err(apiError('CONFLICT', `最多只能参团 ${remainingSlots(current)} 份`));
      }

      const joinedCount = current.joinedCount + quantity;
      const next: GroupBuyDetail = {
        ...current,
        joinedCount,
        status: joinedCount >= current.targetCount ? 'locked' : 'recruiting',
        participants: [
          ...current.participants,
          {
            id: `p-mock-${joinedCount}`,
            nickname: '匿名同学',
            quantity,
            paidFen: current.priceFen * quantity,
            joinedAt: now().toISOString(),
            anonymous: true,
          },
        ],
      };

      const problems = validateGroupBuyItem(next);
      if (problems.length > 0) {
        return err(apiError('INTERNAL', 'mock 参团产生了非法数据', { problems }));
      }

      store = store.map((d, i) => (i === index ? next : d));
      return ok(clone(next));
    },

    setFailureMode(mode: MockFailureMode): void {
      failureMode = mode;
    },

    getFailureMode(): MockFailureMode {
      return failureMode;
    },

    reset(): void {
      store = initial();
      failureMode = 'none';
    },
  };
}
