/**
 * TanStack Query key 工厂 —— 集中管理，避免各组件手写字符串数组导致缓存失效。
 */
import type { FaqTicketStatus } from '@/domain/models/faq';
import type { ForumPostStatus } from '@/domain/models/forum';
import type { GroupBuyStatus } from '@/domain/models/groupbuy';
import type { BuddySection } from '@/domain/models/buddy';

/** 找搭子列表筛选（板块 / 封闭标签 / 关键词 / 是否含非 OPEN 状态） */
export interface BuddyListFilters {
  section: BuddySection | 'all';
  tags: readonly string[];
  keyword: string;
  includeClosed: boolean;
}

export interface BuddyRecommendationFilters {
  section: BuddySection;
  userId: string;
}

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

/** wildlife 地图筛选（图层开关参与缓存键，避免图层状态互相污染） */
export interface WildlifeMapFilters {
  speciesId: string;
  showZones: boolean;
  showSpots: boolean;
  showTracks: boolean;
  showMarkers: boolean;
}

export interface WildlifeListFilters {
  speciesId: string;
  healthConcernOnly: boolean;
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
    wildlifeModeration: ['admin', 'wildlife', 'moderation'] as const,
  },
  /**
   * 营养管家 · 菜品库（Web 后台）。
   *
   * `root` 带 `dishes` 段：这是**管理后台的菜品目录**，与小程序端的
   * 「今日营养 / 当餐记录」不是一回事，缓存键分开才不会互相失效。
   */
  canteen: {
    root: ['canteen', 'dishes'] as const,
    list: (filters: { q: string; category: string }) =>
      ['canteen', 'dishes', 'list', filters.q, filters.category] as const,
    detail: (id: string) => ['canteen', 'dishes', 'detail', id] as const,
  },
  wildlife: {
    root: ['wildlife'] as const,
    map: (filters: WildlifeMapFilters) =>
      [
        'wildlife',
        'map',
        filters.speciesId,
        filters.showZones,
        filters.showSpots,
        filters.showTracks,
        filters.showMarkers,
      ] as const,
    list: (filters: WildlifeListFilters) =>
      ['wildlife', 'list', filters.speciesId, filters.healthConcernOnly] as const,
    detail: (id: string) => ['wildlife', 'detail', id] as const,
    zones: (speciesId: string) => ['wildlife', 'zones', speciesId] as const,
    tracks: (speciesId: string) => ['wildlife', 'tracks', speciesId] as const,
    catalog: ['wildlife', 'catalog'] as const,
  },
  buddy: {
    root: ['buddy'] as const,
    list: (filters: BuddyListFilters) =>
      [
        'buddy',
        'list',
        filters.section,
        filters.tags.join(','),
        filters.keyword,
        filters.includeClosed,
      ] as const,
    detail: (id: string) => ['buddy', 'detail', id] as const,
    recommendations: (filters: BuddyRecommendationFilters) =>
      ['buddy', 'recommendations', filters.section, filters.userId] as const,
    profile: (userId: string) => ['buddy', 'profile', userId] as const,
  },
  /**
   * TechPie 整合（Phase 0）。
   *
   * ⚠️ **这里刻意没有任何"票据"或"付款码"的 key。**
   *
   * 一次性 WebView 票据（规格 §8.4）与校园卡付款码（`02-domain-model.md:1040`）
   * 都是**凭证**，绝不能进 TanStack Query 的缓存 —— 缓存会被 devtools 展示、
   * 会被序列化进内存快照、会跨页面存活。它们由
   * `application/techpie/webviewTicket.ts` 的 `OneTimeTicketHolder` /
   * `PaymentCodeHolder` 在**内存里持有一次**，用完即弃。
   *
   * `query-keys.test.ts` 有一条断言守着这件事（key 里出现 ticket/paymentCode 即失败）。
   */
  techpie: {
    root: ['techpie'] as const,
    links: (cursor?: string) => ['techpie', 'links', cursor ?? 'first'] as const,
    link: (id: string) => ['techpie', 'link', id] as const,
    capabilities: ['techpie', 'capabilities'] as const,
  },
  campusCard: {
    root: ['campus-card'] as const,
    card: ['campus-card', 'card'] as const,
    transactions: (cursor?: string) =>
      ['campus-card', 'transactions', cursor ?? 'first'] as const,
  },
} as const;
