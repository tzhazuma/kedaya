/**
 * 用例：加载观测列表（契约 §7：application 层编排，不含 IO）。
 *
 * 依赖方向 `presentation → application → domain ← data`：
 * 本文件只依赖 domain 的模型与端口，仓储实例由调用方注入。
 * 输出是**视图模型**（已本地化的文案 / 已判定的隐私状态），UI 不再做任何计算。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  CLASSIFICATION_SOURCE_LABELS,
  geoDisplayNotice,
  observedTimeNotice,
  reporterDisplayLabel,
  SIGHTING_STATUS_LABELS,
  sightingSpeciesName,
  sortSightingsByObservedDesc,
  type SightingListQuery,
  type WildlifeSighting,
} from '@/domain/models/wildlife/sightings';
import {
  FEEDING_POLICY_COPY,
  FEEDING_POLICY_LABELS,
  FEEDING_POLICY_TONES,
  strictestFeedingPolicy,
  zoneContainsPoint,
  type FeedingPolicy,
  type FeedingPolicyTone,
  type SpeciesTaxonomy,
  type WildlifeZone,
} from '@/domain/models/wildlife/species';
import { individualsForSpecies, type WildlifeIndividual } from '@/domain/models/wildlife/tracks';
import type { WildlifeRepository } from '@/domain/ports/wildlife';

/** 用例所需的"字典"数据（物种 / 区域 / 个体）—— 由调用方一次拉取后复用 */
export interface WildlifeCatalog {
  species: readonly SpeciesTaxonomy[];
  zones: readonly WildlifeZone[];
  individuals: readonly WildlifeIndividual[];
}

export const EMPTY_CATALOG: WildlifeCatalog = { species: [], zones: [], individuals: [] };

export interface SightingListItemVM {
  id: string;
  href: string;
  speciesId: string;
  speciesLabel: string;
  status: WildlifeSighting['status'];
  statusLabel: string;
  /** 公开时间（粗化后）的展示文案 —— 永远不用精确时间渲染公开列表 */
  observedLabel: string;
  /** 精确发现时间（仅详情页给上报人自己看；列表不展示） */
  observedAt: string;
  createdLabel: string;
  reporterLabel: string;
  isAnonymous: boolean;
  photoCount: number;
  photoUrls: string[];
  note?: string;
  healthConcern: boolean;
  /** 位置是否被扣留（敏感区 / k-匿名不足） */
  geoWithheld: boolean;
  /** 位置说明（"位置已模糊化…" / "该位置位于敏感区…"） */
  geoNotice: string;
  /** 时间说明 */
  timeNotice: string;
  zoneId: string | null;
  zoneName: string | null;
  feedingPolicy: FeedingPolicy;
  feedingPolicyLabel: string;
  feedingPolicyTone: FeedingPolicyTone;
  feedingCopy: string;
  /** 该记录落在禁投喂区域时的红色警告条文案（规格 §8.3） */
  forbiddenWarning: string | null;
  classifiedBy: WildlifeSighting['classifiedBy'];
  classifiedByLabel: string;
  /** 分类来源不是 manual 时必须显示的免责声明（规格 §5.7） */
  classifierDisclaimer: string | null;
  autoSpeciesLabel: string | null;
  autoConfidenceLabel: string | null;
  individualName: string | null;
}

export interface SightingListVM {
  items: SightingListItemVM[];
  nextCursor: string | null;
  total: number;
  isEmpty: boolean;
  healthConcernCount: number;
  /** 空态引导文案（UI 直接渲染，不需要自己编） */
  emptyHint: string;
}

/** 找出坐标落在哪个区域（服务端也会判定；这里用于展示区域名与投喂政策） */
export function resolveZoneForSighting(
  sighting: Pick<WildlifeSighting, 'zoneId' | 'geo'>,
  zones: readonly WildlifeZone[],
): WildlifeZone | null {
  if (sighting.zoneId) {
    const byId = zones.find((zone) => zone.id === sighting.zoneId);
    if (byId) return byId;
  }
  if (sighting.geo) {
    return zones.find((zone) => zoneContainsPoint(zone, sighting.geo as { lat: number; lng: number })) ?? null;
  }
  return null;
}

export function toSightingListItemVM(
  sighting: WildlifeSighting,
  catalog: WildlifeCatalog,
  now: Date,
): SightingListItemVM {
  const zone = resolveZoneForSighting(sighting, catalog.zones);
  const speciesRef = catalog.species.find((s) => s.id === sighting.species);
  const speciesLabel = sightingSpeciesName(sighting, catalog.species);

  // 区域政策与物种默认政策取**较严者**（规格 §8.1 E1 + E2 同时生效）
  const feedingPolicy = strictestFeedingPolicy(
    zone?.feedingPolicy ?? 'allowed',
    speciesRef?.defaultFeedingPolicy ?? 'allowed',
  );

  const individual = sighting.individualId
    ? catalog.individuals.find((i) => i.id === sighting.individualId)
    : undefined;

  const autoSpeciesLabel = sighting.autoSpeciesId
    ? sightingSpeciesName(
        { species: sighting.autoSpeciesId, speciesNameZh: '' },
        catalog.species,
      )
    : null;

  return {
    id: sighting.id,
    href: `/wildlife/sightings/${sighting.id}`,
    speciesId: sighting.species,
    speciesLabel,
    status: sighting.status,
    statusLabel: SIGHTING_STATUS_LABELS[sighting.status],
    observedLabel: formatRelativeTime(sighting.observedAtFuzzed, now) || '时间未知',
    observedAt: sighting.observedAt,
    createdLabel: formatRelativeTime(sighting.createdAt, now) || '时间未知',
    reporterLabel: reporterDisplayLabel(sighting),
    isAnonymous: sighting.isAnonymous,
    photoCount: sighting.photoUrls.length,
    photoUrls: [...sighting.photoUrls],
    ...(sighting.note ? { note: sighting.note } : {}),
    healthConcern: sighting.healthConcern,
    geoWithheld: sighting.geo === null,
    geoNotice: geoDisplayNotice(sighting, zone?.name ?? null),
    timeNotice: observedTimeNotice(sighting),
    zoneId: sighting.zoneId ?? null,
    zoneName: zone?.name ?? null,
    feedingPolicy,
    feedingPolicyLabel: FEEDING_POLICY_LABELS[feedingPolicy],
    feedingPolicyTone: FEEDING_POLICY_TONES[feedingPolicy],
    feedingCopy: FEEDING_POLICY_COPY[feedingPolicy],
    forbiddenWarning:
      feedingPolicy === 'forbidden' && zone
        ? `「${zone.name}」禁止投喂，请勿投喂${speciesLabel}。`
        : feedingPolicy === 'forbidden'
          ? `该物种（${speciesLabel}）禁止投喂。`
          : null,
    classifiedBy: sighting.classifiedBy,
    classifiedByLabel: CLASSIFICATION_SOURCE_LABELS[sighting.classifiedBy],
    classifierDisclaimer:
      sighting.classifiedBy === 'manual'
        ? null
        : '识别结果仅供参考，请确认物种。平台不保证识别准确率。',
    autoSpeciesLabel,
    autoConfidenceLabel:
      sighting.autoConfidence === null || sighting.autoConfidence === undefined
        ? null
        : `${Math.round(sighting.autoConfidence * 100)}%`,
    individualName: individual?.name ?? null,
  };
}

export function toSightingListVM(
  sightings: readonly WildlifeSighting[],
  catalog: WildlifeCatalog,
  nextCursor: string | null,
  total: number,
  now: Date,
): SightingListVM {
  const items = sortSightingsByObservedDesc(sightings).map((sighting) =>
    toSightingListItemVM(sighting, catalog, now),
  );
  return {
    items,
    nextCursor,
    total,
    isEmpty: items.length === 0,
    healthConcernCount: items.filter((item) => item.healthConcern).length,
    emptyHint:
      '当前筛选下还没有观测记录。可以换个物种，或自己上报一条 —— 上报会经过审核后公开。',
  };
}

export async function loadSightingList(
  repository: WildlifeRepository,
  query: SightingListQuery,
  catalog: WildlifeCatalog,
  now: Date = new Date(),
): Promise<Result<SightingListVM, ApiError>> {
  const result = await repository.sightings(query);
  if (!result.ok) return err(result.error);
  const { items, nextCursor, total } = result.value;
  return ok(toSightingListVM(items, catalog, nextCursor, total ?? items.length, now));
}

/** 详情页 VM：在列表 VM 基础上补充审核信息（仅审核端可见的 rejectReason 需显式传入） */
export interface SightingDetailVM extends SightingListItemVM {
  moderatedLabel: string | null;
  /** ⚠️ 仅审核端可展示（规格 §2.6：`rejectReason` 仅审核端可见） */
  rejectReason: string | null;
  individualOptions: { id: string; label: string }[];
}

export async function loadSightingDetail(
  repository: WildlifeRepository,
  id: string,
  catalog: WildlifeCatalog,
  now: Date = new Date(),
): Promise<Result<SightingDetailVM, ApiError>> {
  const result = await repository.sightingDetail(id);
  if (!result.ok) return err(result.error);
  const sighting = result.value;
  const base = toSightingListItemVM(sighting, catalog, now);
  return ok({
    ...base,
    moderatedLabel:
      sighting.moderatedAt === null || sighting.moderatedAt === undefined
        ? null
        : `审核于 ${formatRelativeTime(sighting.moderatedAt, now) || '时间未知'}`,
    rejectReason: sighting.rejectReason ?? null,
    individualOptions: individualsForSpecies(catalog.individuals, sighting.species).map((i) => ({
      id: i.id,
      label: `${i.name}（${i.speciesNameZh}）`,
    })),
  });
}
