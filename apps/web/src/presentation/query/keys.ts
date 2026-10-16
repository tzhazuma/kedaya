/**
 * TanStack Query key 工厂 —— 集中管理，避免各组件手写字符串数组导致缓存失效。
 */
import type { FaqTicketStatus } from '@/domain/models/faq';
import type { ForumPostStatus } from '@/domain/models/forum';
import type { GroupBuyStatus } from '@/domain/models/groupbuy';

export interface GroupBuyListFilters {
  status: GroupBuyStatus | 'all';
  keyword: string;
}

export interface ForumListFilters {
  boardId: string;
  keyword: string;
  /** 是否把被治理（HIDDEN / LOCKED）的主题也拉进来；默认 true */
  includeGoverned: boolean;
}

export interface ForumPostFilters {
  status: ForumPostStatus | 'all';
}

export interface FaqArticleFilters {
  category: string;
  keyword: string;
}

export interface FaqTicketFilters {
  status: FaqTicketStatus | 'all';
}

export const queryKeys = {
  groupbuy: {
    root: ['groupbuy'] as const,
    list: (filters: GroupBuyListFilters) =>
      ['groupbuy', 'list', filters.status, filters.keyword] as const,
    detail: (id: string) => ['groupbuy', 'detail', id] as const,
  },
  forum: {
    root: ['forum'] as const,
    boards: ['forum', 'boards'] as const,
    list: (filters: ForumListFilters) =>
      ['forum', 'list', filters.boardId, filters.keyword, filters.includeGoverned] as const,
    detail: (id: string) => ['forum', 'detail', id] as const,
  },
  faq: {
    root: ['faq'] as const,
    articles: (filters: FaqArticleFilters) =>
      ['faq', 'articles', filters.category, filters.keyword] as const,
    tickets: (filters: FaqTicketFilters) => ['faq', 'tickets', filters.status] as const,
  },
  admin: {
    root: ['admin'] as const,
    dashboard: ['admin', 'dashboard'] as const,
  },
} as const;
