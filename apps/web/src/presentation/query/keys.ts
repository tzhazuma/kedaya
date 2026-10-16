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
} as const;
