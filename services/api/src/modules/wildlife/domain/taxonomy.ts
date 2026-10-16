/**
 * wildlife · 物种分类学与分类建议整形（规格 §2.5 / §5.5 / §5.7 / §9.4）
 *
 * 这里放的都是**纯函数**：投喂政策归一化、分类建议的展示整形、
 * 第三方标签映射、敏感区多边形的提取。没有任何 IO，也不 import Prisma。
 */
import type { SensitivePolygon } from '@kedaya/shared';
import { ValidationError } from '../../../common/errors/app-error';
import {
  CLASSIFIER_HIGH_CONFIDENCE,
  CLASSIFIER_MIN_CONFIDENCE,
  type SpeciesPrediction,
} from './ports/species-classifier.port';

/* ------------------------------------------------------------------ *
 * 枚举（规格 §2.5）
 * ------------------------------------------------------------------ */

export const TAXON_RANKS = ['species', 'genus', 'family', 'order'] as const;
export type TaxonRank = (typeof TAXON_RANKS)[number];

export const FEEDING_POLICIES = ['allowed', 'discouraged', 'forbidden'] as const;
export type FeedingPolicy = (typeof FEEDING_POLICIES)[number];

export const CLASSIFIED_BY_VALUES = ['manual', 'vision_api', 'ondevice', 'fallback'] as const;
export type ClassifiedBy = (typeof CLASSIFIED_BY_VALUES)[number];

export function normalizeFeedingPolicy(raw: unknown): FeedingPolicy {
  return typeof raw === 'string' && (FEEDING_POLICIES as readonly string[]).includes(raw)
    ? (raw as FeedingPolicy)
    : 'discouraged';
}

export function normalizeTaxonRank(raw: unknown): TaxonRank {
  return typeof raw === 'string' && (TAXON_RANKS as readonly string[]).includes(raw)
    ? (raw as TaxonRank)
    : 'species';
}

export function normalizeClassifiedBy(raw: unknown): ClassifiedBy {
  return typeof raw === 'string' && (CLASSIFIED_BY_VALUES as readonly string[]).includes(raw)
    ? (raw as ClassifiedBy)
    : 'manual';
}

/* ------------------------------------------------------------------ *
 * 分类建议整形（规格 §5.5 / T44）
 * ------------------------------------------------------------------ */

/** 一条面向客户端的分类建议（OpenAPI `WildlifeClassification`） */
export interface ClassificationSuggestion {
  speciesId: string;
  confidence: number;
  provider: string;
  /** 恒为 true：**分类只是建议，不是事实**（规格 §5.7） */
  isSuggestion: true;
}

export interface ClassificationResponse {
  suggestions: ClassificationSuggestion[];
  /** `false` 表示置信度不足，客户端**不得预选**（T44） */
  preselected: boolean;
  /** `true` 表示分类能力不可用，请用户手动选择 */
  degraded: boolean;
  /** 必须展示的免责文案（规格 §5.7） */
  notice: string;
}

/**
 * 误分类的责任边界（规格 §5.7）：分类结果是**建议**，不是事实。
 * 最终公开的物种是**用户确认后**的 `species`；平台不保证识别准确率。
 */
export const CLASSIFICATION_NOTICE = '识别结果仅供参考，请确认。平台不对自动识别结果的准确性作承诺。';

/**
 * 整形分类建议。
 *
 * | 置信度区间 | 展示 | 预选 |
 * | --- | --- | --- |
 * | ≥ 0.85 | "识别为 X（很确定）" | ✅ |
 * | 0.60–0.85 | "可能是 X" | ✅ |
 * | < 0.60 | "无法确定" | ❌ **不预选** |
 */
export function shapeClassification(
  predictions: readonly SpeciesPrediction[],
  options: { topK?: number; minConfidence?: number; provider?: string; degraded?: boolean } = {},
): ClassificationResponse {
  const topK = options.topK ?? 3;
  const minConfidence = options.minConfidence ?? CLASSIFIER_MIN_CONFIDENCE;
  const usable = predictions
    .filter((p) => Number.isFinite(p.confidence) && p.confidence > 0 && p.speciesId)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, topK);

  const suggestions: ClassificationSuggestion[] = usable.map((p) => ({
    speciesId: p.speciesId,
    confidence: Math.round(Math.min(1, p.confidence) * 1000) / 1000,
    provider: p.provider ?? options.provider ?? 'none',
    isSuggestion: true,
  }));

  const top = suggestions[0];
  return {
    suggestions,
    // 低于阈值**不预选**：必须用户自己选（T44）
    preselected: top !== undefined && top.confidence >= minConfidence,
    degraded: options.degraded ?? suggestions.length === 0,
    notice: CLASSIFICATION_NOTICE,
  };
}

/** 是否属于"很确定"档（UI 用） */
export function isHighConfidence(confidence: number): boolean {
  return confidence >= CLASSIFIER_HIGH_CONFIDENCE;
}

/* ------------------------------------------------------------------ *
 * 第三方标签映射（规格 §5.3）
 * ------------------------------------------------------------------ */

export interface SpeciesExternalRef {
  id: string;
  externalIds: Record<string, unknown>;
}

/**
 * 把第三方 API 的标签映射到我们的 `speciesId`。
 *
 * **映射不上的标签直接丢弃**（返回空），不要猜 ——
 * 猜错物种比不分类更糟（规格 §5.3）。
 */
export function mapExternalLabels(
  labels: readonly { label: string; confidence: number }[],
  species: readonly SpeciesExternalRef[],
  key = 'inaturalist',
): SpeciesPrediction[] {
  const byLabel = new Map<string, string>();
  for (const s of species) {
    const value = s.externalIds?.[key];
    if (value === undefined || value === null) continue;
    byLabel.set(String(value).toLowerCase(), s.id);
  }

  const out: SpeciesPrediction[] = [];
  for (const item of labels) {
    const speciesId = byLabel.get(item.label.toLowerCase());
    if (!speciesId) continue; // 映射不上 → 丢弃
    out.push({ speciesId, confidence: item.confidence });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

/* ------------------------------------------------------------------ *
 * 敏感区多边形（规格 §9.3 ①）
 * ------------------------------------------------------------------ */

/** 区域行里与敏感区判定相关的字段 */
export interface SensitiveZoneRow {
  id: string;
  isSensitive: boolean;
  sensitiveRing: unknown;
}

/**
 * 从区域行提取敏感区多边形。
 *
 * 只有 `isSensitive = true` 且 `sensitiveRing` 是**至少 3 个顶点**的合法环时才产出。
 * 环的顶点必须是 `{lat,lng}` 数字对 —— 非法顶点直接跳过该顶点，
 * 顶点不足 3 个则整块丢弃（**不能**用一个残缺的环去做"命中即不给坐标"的判定，
 * 那会让本应命中的点漏出去）。
 */
export function toSensitivePolygons(zones: readonly SensitiveZoneRow[]): SensitivePolygon[] {
  const out: SensitivePolygon[] = [];
  for (const zone of zones) {
    if (!zone.isSensitive) continue;
    const ring = parseRing(zone.sensitiveRing);
    if (ring.length < 3) continue;
    out.push({ id: zone.id, ring, reason: 'sensitive-zone' });
  }
  return out;
}

function parseRing(raw: unknown): Array<{ lat: number; lng: number }> {
  if (!Array.isArray(raw)) return [];
  const ring: Array<{ lat: number; lng: number }> = [];
  for (const vertex of raw) {
    if (typeof vertex !== 'object' || vertex === null) continue;
    const { lat, lng } = vertex as { lat?: unknown; lng?: unknown };
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    ring.push({ lat, lng });
  }
  return ring;
}

/* ------------------------------------------------------------------ *
 * 分类模式解析（规格 §5.4 / T42）
 * ------------------------------------------------------------------ */

export type ClassifierMode = 'manual' | 'server' | 'off';

export interface ClassifierModeResolution {
  /** 实际生效的模式（可能与请求的不同 —— 降级后的结果） */
  mode: ClassifierMode;
  /** 是否发生了降级 */
  degraded: boolean;
  /** 降级原因（用于启动 WARN 日志） */
  reason: string | null;
}

/**
 * 启动自检：`WILDLIFE_CLASSIFIER=server` 但 provider 不可用
 * （模型文件缺失 / key 为空）→ **降级到 manual 并 WARN，不崩溃**。
 */
export function resolveClassifierMode(input: {
  configured: ClassifierMode;
  provider: 'local-onnx' | 'third-party' | 'none';
  hasApiKey: boolean;
  hasModelPath: boolean;
}): ClassifierModeResolution {
  if (input.configured === 'off') return { mode: 'off', degraded: false, reason: null };
  if (input.configured === 'manual') return { mode: 'manual', degraded: false, reason: null };

  // configured === 'server'
  if (input.provider === 'local-onnx' && !input.hasModelPath) {
    return {
      mode: 'manual',
      degraded: true,
      reason: 'WILDLIFE_CLASSIFIER=server 但 WILDLIFE_ONNX_MODEL_PATH 为空 → 降级到 manual',
    };
  }
  if (input.provider === 'third-party' && !input.hasApiKey) {
    return {
      mode: 'manual',
      degraded: true,
      reason: 'WILDLIFE_CLASSIFIER=server 但 WILDLIFE_VISION_API_KEY 为空 → 降级到 manual',
    };
  }
  if (input.provider === 'none') {
    return {
      mode: 'manual',
      degraded: true,
      reason: 'WILDLIFE_CLASSIFIER=server 但 provider=none → 降级到 manual',
    };
  }
  return { mode: 'server', degraded: false, reason: null };
}

/* ------------------------------------------------------------------ *
 * 上报字段校验（规格 §10.3 的 details.reason 取值）
 * ------------------------------------------------------------------ */

/** `observedAt` 允许的最早时间（过去 30 天） */
export const OBSERVED_AT_MAX_AGE_DAYS = 30;
/** `observedAt` 允许的最晚时间（未来 5 分钟，容忍客户端时钟偏差） */
export const OBSERVED_AT_MAX_FUTURE_MINUTES = 5;

/**
 * 校验发现时间：必须在**过去 30 天**内，且不晚于当前时间 +5 分钟。
 *
 * 为什么要限制"未来"：`observedAt` 是用户手选的，允许未来时间会让
 * "发现时间"变成可以任意伪造的字段，进而污染热点的时间直方图与轨迹时序。
 */
export function assertObservedAtInRange(observedAt: Date, now: Date = new Date()): void {
  if (Number.isNaN(observedAt.getTime())) {
    throw new ValidationError('发现时间不是合法时间', { reason: 'OBSERVED_AT_OUT_OF_RANGE' });
  }
  const earliest = now.getTime() - OBSERVED_AT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const latest = now.getTime() + OBSERVED_AT_MAX_FUTURE_MINUTES * 60 * 1000;
  if (observedAt.getTime() < earliest || observedAt.getTime() > latest) {
    throw new ValidationError(
      `发现时间必须在过去 ${OBSERVED_AT_MAX_AGE_DAYS} 天内，且不能晚于当前时间 ${OBSERVED_AT_MAX_FUTURE_MINUTES} 分钟`,
      { reason: 'OBSERVED_AT_OUT_OF_RANGE' },
    );
  }
}
