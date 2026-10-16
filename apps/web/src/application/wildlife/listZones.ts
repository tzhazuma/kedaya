/**
 * 用例：加载区域列表 / 区域详情（规格 §2.2 / §8.3）。
 *
 * 区域是**人工定义**的管理边界（与算法聚类出的热点 `WildlifeSpot` 不是一回事），
 * 因此这里承载：投喂政策徽章、告示位文案、敏感区（只给区域不给坐标）的说明。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import { BASEMAP_PLACEHOLDER_NOTICE } from '@/domain/models/wildlife/basemap';
import { zoneToOverlay, type ZoneOverlay } from '@/domain/models/wildlife/geometry';
import { NOTICE_DRAFT_FLAG, PRIVACY_SENSITIVE_ZONE_NOTICE } from '@/domain/models/wildlife/ethics';
import {
  FEEDING_POLICY_COPY,
  FEEDING_POLICY_LABELS,
  FEEDING_POLICY_TONES,
  forbiddenZoneWarning,
  sortZones,
  speciesDisplayName,
  zoneNoticeSummary,
  type CircleGeo,
  type FeedingPolicy,
  type FeedingPolicyTone,
  type WildlifeZone,
} from '@/domain/models/wildlife/species';
import type { WildlifeRepository, ZoneListQuery } from '@/domain/ports/wildlife';

import type { WildlifeCatalog } from './listSightings';

export interface ZoneVM {
  id: string;
  name: string;
  /** 该区域主要物种的中文名 */
  speciesLabels: string[];
  speciesLabelText: string;
  /** 原始圆形几何（供"上报点落在哪个区域"的本地预判使用） */
  geo: CircleGeo;
  center: ZoneOverlay['center'];
  radiusPx: number;
  radiusM: number;
  radiusLabel: string;
  feedingPolicy: FeedingPolicy;
  feedingPolicyLabel: string;
  feedingPolicyTone: FeedingPolicyTone;
  feedingCopy: string;
  /** 禁投喂区域必须显著提示（规格 §8.1 E2） */
  forbiddenWarning: string | null;
  isSensitive: boolean;
  /** 敏感区说明：**只给区域不给坐标**（规格 §9.3 ①） */
  sensitiveNotice: string | null;
  fuzzRadiusM: number;
  fuzzLabel: string;
  noticeText: string | null;
  noticeSummary: string | null;
  /** 告示文案是草案，未经校方审核（未决问题 U7） */
  noticeDraftFlag: string | null;
  note: string | null;
  overlay: ZoneOverlay;
}

export interface ZoneListVM {
  items: ZoneVM[];
  nextCursor: string | null;
  total: number;
  isEmpty: boolean;
  emptyHint: string;
  forbiddenCount: number;
  sensitiveCount: number;
  /** 底图占位声明（区域列表页也要能看到"底图是占位的"） */
  basemapNotice: string;
}

export function toZoneVM(zone: WildlifeZone, catalog: WildlifeCatalog): ZoneVM {
  const speciesLabels = zone.speciesIds.map((id) => speciesDisplayName(catalog.species, id));
  const overlay = zoneToOverlay(zone);
  return {
    id: zone.id,
    name: zone.name,
    speciesLabels,
    speciesLabelText: speciesLabels.length > 0 ? speciesLabels.join('、') : '未标注物种',
    geo: { lat: zone.geo.lat, lng: zone.geo.lng, radiusM: zone.geo.radiusM },
    center: overlay.center,
    radiusPx: overlay.radiusPx,
    radiusM: zone.geo.radiusM,
    radiusLabel: `半径约 ${zone.geo.radiusM} m`,
    feedingPolicy: zone.feedingPolicy,
    feedingPolicyLabel: FEEDING_POLICY_LABELS[zone.feedingPolicy],
    feedingPolicyTone: FEEDING_POLICY_TONES[zone.feedingPolicy],
    feedingCopy: FEEDING_POLICY_COPY[zone.feedingPolicy],
    forbiddenWarning:
      zone.feedingPolicy === 'forbidden'
        ? forbiddenZoneWarning(zone.name, speciesLabels[0])
        : null,
    isSensitive: zone.isSensitive,
    sensitiveNotice: zone.isSensitive ? PRIVACY_SENSITIVE_ZONE_NOTICE : null,
    fuzzRadiusM: zone.fuzzRadiusM,
    fuzzLabel: `位置模糊化半径 ${zone.fuzzRadiusM} m（敏感区更大）`,
    noticeText: zone.noticeText ?? null,
    noticeSummary: zoneNoticeSummary(zone),
    noticeDraftFlag: zone.noticeText ? NOTICE_DRAFT_FLAG : null,
    note: zone.note ?? null,
    overlay,
  };
}

export function toZoneListVM(
  zones: readonly WildlifeZone[],
  catalog: WildlifeCatalog,
  nextCursor: string | null,
  total: number,
): ZoneListVM {
  const items = sortZones(zones).map((zone) => toZoneVM(zone, catalog));
  return {
    items,
    nextCursor,
    total,
    isEmpty: items.length === 0,
    emptyHint:
      '还没有人工定义的动物活动区域。区域由管理端录入（投喂政策、告示位、敏感区标记都在那里维护）。',
    forbiddenCount: items.filter((item) => item.feedingPolicy === 'forbidden').length,
    sensitiveCount: items.filter((item) => item.isSensitive).length,
    basemapNotice: BASEMAP_PLACEHOLDER_NOTICE,
  };
}

export async function loadZoneList(
  repository: WildlifeRepository,
  query: ZoneListQuery,
  catalog: WildlifeCatalog,
): Promise<Result<ZoneListVM, ApiError>> {
  const result = await repository.zones(query);
  if (!result.ok) return err(result.error);
  const { items, nextCursor, total } = result.value;
  return ok(toZoneListVM(items, catalog, nextCursor, total ?? items.length));
}

export async function loadZoneDetail(
  repository: WildlifeRepository,
  id: string,
  catalog: WildlifeCatalog,
): Promise<Result<ZoneVM, ApiError>> {
  const result = await repository.zoneDetail(id);
  if (!result.ok) return err(result.error);
  return ok(toZoneVM(result.value, catalog));
}
