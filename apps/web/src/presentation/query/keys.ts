/**
 * TanStack Query key 工厂 —— 集中管理，避免各组件手写字符串数组导致缓存失效。
 */
import type { GroupBuyStatus } from '@/domain/models/groupbuy';

export interface GroupBuyListFilters {
  status: GroupBuyStatus | 'all';
  keyword: string;
}

export const queryKeys = {
  groupbuy: {
    root: ['groupbuy'] as const,
    list: (filters: GroupBuyListFilters) =>
      ['groupbuy', 'list', filters.status, filters.keyword] as const,
    detail: (id: string) => ['groupbuy', 'detail', id] as const,
  },
  admin: {
    root: ['admin'] as const,
    dashboard: ['admin', 'dashboard'] as const,
  },
} as const;
