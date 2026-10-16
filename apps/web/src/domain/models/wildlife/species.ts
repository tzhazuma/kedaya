/**
 * wildlife · 物种分类与投喂政策（规格 §2.5 / §5 / §8.1）
 *
 * ⚠️ **诚实标注**：本文件不内置任何"上科大真实物种清单"。
 * 规格 §2.5 的物种表是**基于"校园有猫、鸟、黑天鹅"这一前提的合理推测**，
 * **未做实地物种调查**（未决问题 U2）。真实清单必须由校园动物社团/生物教师确认后，
 * 由**服务端**下发（`GET /wildlife/species`）；Web 端只负责渲染与派生文案。
 */
import type { LatLng } from '@kedaya/shared';

/* ------------------------------------------------------------------ *
 * 投喂政策（规格 §8.1 E1/E2，UI 上必须是徽章 + 告示位）
 * ------------------------------------------------------------------ */

/** 与契约 / 领域模型逐字一致的三值枚举 */
export type FeedingPolicy = 'allowed' | 'discouraged' | 'forbidden';

export const FEEDING_POLICY_LABELS: Record<FeedingPolicy, string> = {
  allowed: '可以投喂',
  discouraged: '不建议投喂',
  forbidden: '禁止投喂',
};

/** 徽章色调（语义名，具体色值由 design-tokens 决定 —— 不手写色值） */
export type FeedingPolicyTone = 'success' | 'warning' | 'danger';

export const FEEDING_POLICY_TONES: Record<FeedingPolicy, FeedingPolicyTone> = {
  allowed: 'success',
  discouraged: 'warning',
  forbidden: 'danger',
};

/** 区域/物种详情页的投喂说明（E1：人类食物会损害动物健康） */
export const FEEDING_POLICY_COPY: Record<FeedingPolicy, string> = {
  allowed: '该区域允许投喂，但请只投喂适合该物种的食物，并保持距离。',
  discouraged:
    '不建议投喂。面包、零食等人类食物含盐含糖，会损害动物健康，也会让它们依赖人类。',
  forbidden:
    '该区域禁止投喂。请勿投喂面包、零食等人类食物，也请勿用食物引诱动物以获取照片。',
};

/** 区域选为 `forbidden` 时上报表单必须显示的红色警告条（规格 §8.3） */
export function forbiddenZoneWarning(zoneName: string, speciesName?: string): string {
  return speciesName
    ? `「${zoneName}」禁止投喂，请勿投喂${speciesName}。`
    : `「${zoneName}」禁止投喂，请勿投喂该区域的动物。`;
}

/* ------------------------------------------------------------------ *
 * 物种分类树（规格 §2.5）
 * ------------------------------------------------------------------ */

export type TaxonRank = 'species' | 'genus' | 'family' | 'order';

export const TAXON_RANK_LABELS: Record<TaxonRank, string> = {
  species: '种',
  genus: '属',
  family: '科',
  order: '目',
};

export interface SpeciesTaxonomy {
  id: string;
  /** 学名（唯一），如 `Cygnus atratus` */
  scientificName: string;
  commonNameZh: string;
  /** 英文名（可空：数据库列是 `String?`） */
  commonNameEn?: string | null;
  taxonRank: TaxonRank;
  parentId?: string | null;
  /** 国家/地方保护动物（影响审核严格度：**保护物种必须双人复核**，规格 §2.10） */
  isProtected: boolean;
  /** 繁殖期敏感 → 触发季节性加强模糊（规格 §9.4） */
  isNestingSensitive: boolean;
  /** 繁殖月份（1–12），仅 `isNestingSensitive` 时有意义 */
  nestingMonths: number[];
  defaultFeedingPolicy: FeedingPolicy;
  externalIds: Record<string, string | number>;
  iconUrl?: string | null;
  isActive: boolean;
}

/** 物种筛选器用的选项（含"全部"） */
export interface SpeciesOption {
  id: string;
  label: string;
  /** 保护物种角标 */
  protectedLabel?: string;
  feedingPolicy: FeedingPolicy;
}

export function toSpeciesOption(species: SpeciesTaxonomy): SpeciesOption {
  return {
    id: species.id,
    label: species.commonNameZh,
    ...(species.isProtected ? { protectedLabel: '保护动物' } : {}),
    feedingPolicy: species.defaultFeedingPolicy,
  };
}

/** 只列上架物种（下架物种不删除，只是不再出现在筛选器里） */
export function activeSpecies(species: readonly SpeciesTaxonomy[]): SpeciesTaxonomy[] {
  return species.filter((s) => s.isActive);
}

export function findSpecies(
  species: readonly SpeciesTaxonomy[],
  id: string | null | undefined,
): SpeciesTaxonomy | undefined {
  if (!id) return undefined;
  return species.find((s) => s.id === id);
}

/** 展示名：优先中文名，缺失时退回学名（永远不要显示空字符串） */
export function speciesDisplayName(
  species: readonly SpeciesTaxonomy[],
  id: string | null | undefined,
  fallback = '未知物种',
): string {
  const found = findSpecies(species, id);
  // 注意：空串 / 纯空白也算"缺失" —— `??` 不会兜住 `''`，那会让界面上出现空白标题
  const zh = found?.commonNameZh?.trim();
  if (zh) return zh;
  const scientific = found?.scientificName?.trim();
  if (scientific) return scientific;
  return fallback;
}

/* ------------------------------------------------------------------ *
 * 季节性加强模糊（规格 §9.4 / 验收 T11）
 * ------------------------------------------------------------------ */

/** 上海本地月份（UTC+8）—— 繁殖期判定必须用本地月，不能用 UTC 月 */
export function monthInShanghai(at: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', month: 'numeric' }).format(at),
  );
}

/**
 * 该物种在该时刻的模糊半径倍数（规格 §9.4）：
 * - 保护物种 + 繁殖月 → ×4（50 m → 200 m）
 * - 仅繁殖敏感 + 繁殖月 → ×2
 * - 其余 → ×1
 */
export function seasonalFuzzMultiplier(
  species: Pick<SpeciesTaxonomy, 'isProtected' | 'isNestingSensitive' | 'nestingMonths'>,
  at: Date,
): number {
  if (!species.isNestingSensitive) return 1;
  if (!species.nestingMonths.includes(monthInShanghai(at))) return 1;
  return species.isProtected ? 4 : 2;
}

export function isNestingSeason(
  species: Pick<SpeciesTaxonomy, 'isNestingSensitive' | 'nestingMonths'>,
  at: Date,
): boolean {
  return species.isNestingSensitive && species.nestingMonths.includes(monthInShanghai(at));
}

/** 有效模糊半径（米）：区域半径 × 季节倍数 */
export function effectiveFuzzRadiusM(
  baseRadiusM: number,
  species: Pick<SpeciesTaxonomy, 'isProtected' | 'isNestingSensitive' | 'nestingMonths'> | null,
  at: Date,
): number {
  if (!species) return baseRadiusM;
  return baseRadiusM * seasonalFuzzMultiplier(species, at);
}

/* ------------------------------------------------------------------ *
 * 自动分类的置信度分档（规格 §5.5 / 验收 T44）
 * ------------------------------------------------------------------ */

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface ClassifierSuggestion {
  speciesId: string;
  confidence: number;
  /** 是否应当**预选**该物种（< 0.60 时禁止预选） */
  preselected: boolean;
  band: ConfidenceBand;
  label: string;
}

export const CLASSIFIER_MIN_CONFIDENCE = 0.6;

/**
 * 置信度 → 展示文案与"是否预选"（规格 §5.5 三档表）。
 *
 * | 区间 | 展示 | 预选 |
 * | --- | --- | --- |
 * | ≥ 0.85 | 识别为 X（很确定） | ✅ |
 * | 0.60–0.85 | 可能是 X | ✅（提示确认） |
 * | < 0.60 | 无法确定 | ❌ **不预选** |
 */
export function classifySuggestion(
  speciesId: string,
  confidence: number,
  displayName: string,
): ClassifierSuggestion {
  if (confidence >= 0.85) {
    return {
      speciesId,
      confidence,
      preselected: true,
      band: 'high',
      label: `识别为 ${displayName}（很确定）`,
    };
  }
  if (confidence >= CLASSIFIER_MIN_CONFIDENCE) {
    return {
      speciesId,
      confidence,
      preselected: true,
      band: 'medium',
      label: `可能是 ${displayName}，请确认`,
    };
  }
  return {
    speciesId,
    confidence,
    preselected: false,
    band: 'low',
    label: `无法确定，可能是 ${displayName}`,
  };
}

/** 置信度百分比文案 */
export function confidencePercentLabel(confidence: number): string {
  const clamped = Math.min(1, Math.max(0, confidence));
  return `${Math.round(clamped * 100)}%`;
}

/**
 * 分类结果只是**建议**（规格 §5.7）：`classifiedBy !== 'manual'` 时 UI **必须**显示免责声明。
 * 返回 `null` 表示无需显示（用户自己选的物种）。
 */
export function classifierDisclaimer(classifiedBy: ClassificationSourceLike): string | null {
  if (classifiedBy === 'manual') return null;
  return '识别结果仅供参考，请确认物种。平台不保证识别准确率。';
}

/** 与 `sightings.ts` 的 `ClassificationSource` 同构（避免循环依赖，此处只取所需形状） */
export type ClassificationSourceLike = 'manual' | 'vision_api' | 'ondevice' | 'fallback';

/** 物种图标位（无 iconUrl 时用首字，避免空白方块） */
export function speciesMonogram(species: SpeciesTaxonomy | undefined): string {
  if (!species) return '?';
  return species.commonNameZh.slice(0, 1);
}

/* ------------------------------------------------------------------ *
 * 区域（规格 §2.2，契约 §2.10 冻结 + 本规格新增可选字段）
 * ------------------------------------------------------------------ */

export interface WildlifeZone {
  id: string;
  name: string;
  /** 主要物种标签（`SpeciesTaxonomy.id`） */
  speciesIds: string[];
  /** **圆形**区域（契约冻结为 circle） */
  geo: LatLng & { radiusM: number };
  feedingPolicy: FeedingPolicy;
  note?: string | null;
  /** 位置模糊化半径（默认 50 m，规格 §9.3 ②） */
  fuzzRadiusM: number;
  /** 敏感区（宿舍/保育区）→ 公开展示时**只给区域不给坐标**（规格 §9.3 ①） */
  isSensitive: boolean;
  /** 告示位文案（规格 §8.3） */
  noticeText?: string | null;
  sortOrder: number;
}

export function sortZones(zones: readonly WildlifeZone[]): WildlifeZone[] {
  return [...zones].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh'));
}

/** 地图气泡里的告示摘要（规格 §8.3：前 40 字） */
export function zoneNoticeSummary(zone: WildlifeZone, maxChars = 40): string | null {
  const text = zone.noticeText?.trim();
  if (!text) return null;
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

/** 该区域是否禁投喂（上报表单据此显示红色警告条） */
export function isFeedingForbidden(zone: WildlifeZone | null | undefined): boolean {
  return zone?.feedingPolicy === 'forbidden';
}

/** 区域最严格的投喂政策 = 物种默认政策与该区域政策的**较严者**（E1 + E2 同时生效） */
export function strictestFeedingPolicy(
  a: FeedingPolicy,
  b: FeedingPolicy,
): FeedingPolicy {
  const order: Record<FeedingPolicy, number> = { allowed: 0, discouraged: 1, forbidden: 2 };
  return order[a] >= order[b] ? a : b;
}

/** 圆形区域几何（契约把 `WildlifeZone.geo` 冻结为圆形） */
export interface CircleGeo {
  lat: number;
  lng: number;
  radiusM: number;
}

/**
 * 圆形区域是否包含某点。
 *
 * 用局部米制平面近似（校园尺度下与 haversine 差异 < 1 cm），
 * 与 `@kedaya/shared` 的 ENU 近似保持同一套数学。
 */
export function circleContainsPoint(circle: CircleGeo, point: LatLng): boolean {
  const metersPerDegLng = 111_320 * Math.cos((point.lat * Math.PI) / 180);
  const dx = (point.lng - circle.lng) * metersPerDegLng;
  const dy = (point.lat - circle.lat) * 111_320;
  return Math.hypot(dx, dy) <= circle.radiusM;
}

/** 区域是否包含某个坐标（用于"上报点落在哪个区域"的本地预判，服务端仍会复核） */
export function zoneContainsPoint(zone: WildlifeZone, point: LatLng): boolean {
  return circleContainsPoint(zone.geo, point);
}
