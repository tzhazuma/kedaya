/**
 * wildlife · 观测记录（规格 §2.6 / §2.7 / §9 / §10.3）
 *
 * ## 三个必须记住的语义（否则一定会实现错）
 *
 * 1. **`observedAt` ≠ `createdAt`**（规格 §2.6 / 契约 §11.10-A）：
 *    `observedAt` 是**发现时间**（同学填的），`createdAt` 是**上报时间**（服务端入库）。
 *    两者在补录、离线同步场景下会相差很久。
 * 2. **公开的 `geo` 是"模糊化后的可公开坐标"**（规格 §2.6）：
 *    它不是上报时的精确坐标。敏感区内**根本没有坐标**（`geo === null`），
 *    只有 `zoneId` —— 这是最强的隐私保证（规格 §9.3 ①）。
 * 3. **`observedAtFuzzed` 是公开时间**（规格 §9.5）：普通区粗化到小时，敏感区粗化到天。
 *    客户端渲染公开信息时**只能用** `observedAtFuzzed`。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type LatLng, type Result } from '@kedaya/shared';

import { assertInCampus, isInCampus } from './basemap';
import { speciesDisplayName, type SpeciesTaxonomy } from './species';

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** 契约冻结的状态机：`PENDING → PUBLISHED / REJECTED`，`PUBLISHED → REJECTED`（事后下架） */
export type SightingStatus = 'PENDING' | 'PUBLISHED' | 'REJECTED';

export const SIGHTING_STATUS_LABELS: Record<SightingStatus, string> = {
  PENDING: '待审核',
  PUBLISHED: '已发布',
  REJECTED: '未通过',
};

export type ClassificationSource = 'manual' | 'vision_api' | 'ondevice' | 'fallback';

export const CLASSIFICATION_SOURCE_LABELS: Record<ClassificationSource, string> = {
  manual: '手动选择',
  vision_api: '视觉 API 建议',
  ondevice: '端侧识别建议',
  fallback: '自动分类不可用（已降级为手动）',
};

/** 坐标被扣留的原因（规格 §9.3 ①②） */
export type GeoWithheldReason = 'sensitive-zone' | 'k-anonymity';

export const GEO_WITHHELD_LABELS: Record<GeoWithheldReason, string> = {
  'sensitive-zone': '该位置位于敏感区（宿舍/保育区），公开信息只显示所属区域，不显示坐标。',
  'k-anonymity': '该位置在同一网格内上报人数不足 3 人，为保护上报人只显示所属区域。',
};

export interface WildlifeSighting {
  id: string;
  zoneId?: string | null;
  /** `SpeciesTaxonomy.id`（契约冻结字段名 `species`） */
  species: string;
  speciesNameZh: string;
  status: SightingStatus;
  /**
   * **模糊化后的可公开坐标**；`null` = 坐标被扣留（敏感区 / k-匿名不足）。
   * 服务端返回精确坐标是**契约违规**，客户端不应存在任何"精确坐标"字段。
   */
  geo: LatLng | null;
  geoWithheld?: GeoWithheldReason | null;
  /** 发现时间（精确，**上报人自己可见**） */
  observedAt: string;
  /** 公开时间（粗化后，规格 §9.5） */
  observedAtFuzzed: string;
  individualId?: string | null;
  autoSpeciesId?: string | null;
  autoConfidence?: number | null;
  classifiedBy: ClassificationSource;
  correctedFromSpeciesId?: string | null;
  note?: string | null;
  isAnonymous: boolean;
  /** 展示用上报人标签（匿名时为「匿名同学」；**永远不含 reporterId**） */
  reporterLabel: string;
  photoUrls: string[];
  healthConcern: boolean;
  createdAt: string;
  moderatedBy?: string | null;
  moderatedAt?: string | null;
  /** ≤200 字，**仅审核端可见**（规格 §2.6） */
  rejectReason?: string | null;
}

/** 媒体上传回执（`POST /wildlife/media`） */
export interface UploadedMedia {
  mediaId: string;
  thumbUrl: string;
  widthPx: number;
  heightPx: number;
  sha256: string;
  /** 客户端幂等键（重试复用同一个 → 返回同一 mediaId） */
  clientPhotoId: string;
}

/* ------------------------------------------------------------------ *
 * 限额（规格 §10.3 / §4.2）
 * ------------------------------------------------------------------ */

export const SIGHTING_LIMITS = {
  /** 备注 ≤200 字 */
  noteMax: 200,
  /** 照片 ≤3 张（契约 `photoUrls` ≤3） */
  mediaMax: 3,
  /** 发现时间必须在过去 30 天内 */
  observedPastDays: 30,
  /** 且不晚于当前时间 +5 分钟（容忍客户端时钟漂移） */
  observedFutureMinutes: 5,
  /** 单张 ≤5 MB（服务端硬限，客户端先挡一次） */
  mediaByteMax: 5 * 1024 * 1024,
  /** 接受格式 */
  mediaMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
} as const;

/** 校验失败原因码（与规格 §10.3 的 `details.reason` 逐字一致） */
export type SightingValidationReason =
  | 'UNKNOWN_SPECIES'
  | 'OBSERVED_AT_OUT_OF_RANGE'
  | 'COORDINATE_OUT_OF_CAMPUS'
  | 'GEO_REQUIRED'
  | 'MEDIA_TOO_MANY'
  | 'MEDIA_UNSUPPORTED_TYPE'
  | 'MEDIA_TOO_LARGE'
  | 'NOTE_TOO_LONG'
  | 'ETHICS_NOT_ACKNOWLEDGED';

export interface SightingValidationProblem {
  reason: SightingValidationReason;
  message: string;
}

/* ------------------------------------------------------------------ *
 * 上报草稿与校验（规格 §10.3 字段校验表）
 * ------------------------------------------------------------------ */

export interface SightingDraft {
  speciesId: string;
  /** 发现时间（ISO）—— **不是**上报时间 */
  observedAt: string;
  /** 地图点选得到的坐标（WGS84）；未点选时为 null */
  geo: LatLng | null;
  zoneId: string | null;
  individualId: string | null;
  /** 新建命名个体（规格 §5.6(b)），空串 = 不给个体起名 */
  individualName: string;
  note: string;
  isAnonymous: boolean;
  healthConcern: boolean;
  /** 伦理确认（规格 §8.2：**表单校验，不是同意门**） */
  ethicsAcknowledged: boolean;
  mediaIds: string[];
  autoSpeciesId: string | null;
  autoConfidence: number | null;
  classifiedBy: ClassificationSource;
}

export function createEmptySightingDraft(now: Date = new Date()): SightingDraft {
  return {
    speciesId: '',
    observedAt: toLocalDateTimeInputValue(now),
    geo: null,
    zoneId: null,
    individualId: null,
    individualName: '',
    note: '',
    isAnonymous: false,
    healthConcern: false,
    ethicsAcknowledged: false,
    mediaIds: [],
    autoSpeciesId: null,
    autoConfidence: null,
    classifiedBy: 'manual',
  };
}

/** `datetime-local` 输入框的值（本地时间，不带时区），仅用于表单默认值 */
export function toLocalDateTimeInputValue(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export interface SightingDraftValidation {
  ok: boolean;
  problems: SightingValidationProblem[];
  /** 非阻塞提醒（例如"保护物种需双人审核"） */
  hints: string[];
}

/**
 * 草稿校验（纯函数，规格 §10.3）。
 *
 * 服务端仍会**独立**复核全部规则 —— 客户端校验只是减少无效提交，不是安全边界。
 */
export function validateSightingDraft(
  draft: SightingDraft,
  now: Date = new Date(),
  options: { knownSpeciesIds?: readonly string[] } = {},
): SightingDraftValidation {
  const problems: SightingValidationProblem[] = [];
  const hints: string[] = [];

  if (!draft.speciesId.trim()) {
    problems.push({ reason: 'UNKNOWN_SPECIES', message: '请选择物种（分类是必需的，识别建议只是参考）。' });
  } else if (options.knownSpeciesIds && !options.knownSpeciesIds.includes(draft.speciesId)) {
    problems.push({ reason: 'UNKNOWN_SPECIES', message: '所选物种不在当前物种表中，请重新选择。' });
  }

  const observed = new Date(draft.observedAt);
  if (Number.isNaN(observed.getTime())) {
    problems.push({ reason: 'OBSERVED_AT_OUT_OF_RANGE', message: '发现时间格式不正确。' });
  } else {
    const earliest = now.getTime() - SIGHTING_LIMITS.observedPastDays * 24 * 60 * 60 * 1000;
    const latest = now.getTime() + SIGHTING_LIMITS.observedFutureMinutes * 60 * 1000;
    if (observed.getTime() < earliest) {
      problems.push({
        reason: 'OBSERVED_AT_OUT_OF_RANGE',
        message: `发现时间不能早于 ${SIGHTING_LIMITS.observedPastDays} 天前。`,
      });
    } else if (observed.getTime() > latest) {
      problems.push({
        reason: 'OBSERVED_AT_OUT_OF_RANGE',
        message: '发现时间不能晚于当前时间（容忍 5 分钟时钟误差）。',
      });
    }
  }

  if (!draft.geo) {
    problems.push({ reason: 'GEO_REQUIRED', message: '请在地图上点选发现地点。' });
  } else if (!isInCampus(draft.geo)) {
    problems.push({
      reason: 'COORDINATE_OUT_OF_CAMPUS',
      message: '所选地点不在校园范围内，请重新点选。',
    });
  }

  if (draft.mediaIds.length > SIGHTING_LIMITS.mediaMax) {
    problems.push({
      reason: 'MEDIA_TOO_MANY',
      message: `最多上传 ${SIGHTING_LIMITS.mediaMax} 张照片。`,
    });
  }

  if (draft.note.length > SIGHTING_LIMITS.noteMax) {
    problems.push({
      reason: 'NOTE_TOO_LONG',
      message: `备注不超过 ${SIGHTING_LIMITS.noteMax} 字。`,
    });
  }

  if (!draft.ethicsAcknowledged) {
    problems.push({
      reason: 'ETHICS_NOT_ACKNOWLEDGED',
      message: '请先阅读并勾选伦理守则（这是本次提交的操作确认，不是授权同意门）。',
    });
  }

  if (draft.healthConcern) {
    hints.push('疑似受伤：请勿自行处理，也请勿依赖自动识别结果。提交后会立即通知校园动物社团。');
  }
  if (draft.classifiedBy !== 'manual') {
    hints.push('物种来自自动识别建议，仅供参考，请确认。');
  }

  return { ok: problems.length === 0, problems, hints };
}

/** 草稿 → `POST /wildlife/items` 请求体（规格 §10.3） */
export interface CreateSightingInput {
  species: string;
  observedAt: string;
  geo: LatLng;
  zoneId: string | null;
  mediaIds: string[];
  healthConcern: boolean;
  individualId: string | null;
  /** 新建个体的名字（可选） */
  individualName: string | null;
  note: string | null;
  isAnonymous: boolean;
  autoSpeciesId: string | null;
  autoConfidence: number | null;
  classifiedBy: ClassificationSource;
  ethicsAcknowledged: true;
}

/**
 * 把已通过校验的草稿转成请求体。
 * 未通过校验时返回 `err(VALIDATION_FAILED)` —— **不在 data 层之外构造请求体**。
 */
export function toCreateSightingInput(
  draft: SightingDraft,
  now: Date = new Date(),
  options: { knownSpeciesIds?: readonly string[] } = {},
): Result<CreateSightingInput, ApiError> {
  const validation = validateSightingDraft(draft, now, options);
  if (!validation.ok || !draft.geo) {
    return err({
      code: 'VALIDATION_FAILED',
      message: validation.problems[0]?.message ?? '上报内容不合法',
      details: { reasons: validation.problems.map((p) => p.reason) },
    });
  }
  assertInCampus(draft.geo);
  return ok({
    species: draft.speciesId,
    observedAt: new Date(draft.observedAt).toISOString(),
    geo: draft.geo,
    zoneId: draft.zoneId,
    mediaIds: [...draft.mediaIds],
    healthConcern: draft.healthConcern,
    individualId: draft.individualId,
    individualName: draft.individualName.trim() === '' ? null : draft.individualName.trim(),
    note: draft.note.trim() === '' ? null : draft.note.trim(),
    isAnonymous: draft.isAnonymous,
    autoSpeciesId: draft.autoSpeciesId,
    autoConfidence: draft.autoConfidence,
    classifiedBy: draft.classifiedBy,
    ethicsAcknowledged: true,
  });
}

/* ------------------------------------------------------------------ *
 * 审核（规格 §2.10 / §10.2：action 名 `moderate` 已冻结）
 * ------------------------------------------------------------------ */

export type ModerationDecision = 'PUBLISHED' | 'REJECTED';

export const MODERATION_DECISION_LABELS: Record<ModerationDecision, string> = {
  PUBLISHED: '通过并发布',
  REJECTED: '拒绝',
};

export interface ModerateSightingInput {
  decision: ModerationDecision;
  /** 下架/拒绝**必须**填理由（规格 §2.10：`PUBLISHED → REJECTED` 必须填 `rejectReason`） */
  reason?: string;
  moderatorId: string;
}

/** 审核前置条件（客户端提前告知，服务端仍会独立判定） */
export interface ModerationPrecondition {
  allowed: boolean;
  reason?: string;
  /** 保护物种需要**两名**审核员（规格 §2.10），单人通过返回 FORBIDDEN */
  requiresSecondModerator: boolean;
}

export function moderationPrecondition(
  sighting: Pick<WildlifeSighting, 'species' | 'status' | 'moderatedBy'>,
  species: Pick<SpeciesTaxonomy, 'isProtected'> | undefined,
  moderatorId: string,
): ModerationPrecondition {
  if (sighting.status !== 'PENDING' && sighting.status !== 'PUBLISHED') {
    return { allowed: false, reason: '该记录已不在可审核状态。', requiresSecondModerator: false };
  }
  if (sighting.status === 'PUBLISHED' && sighting.moderatedBy === moderatorId) {
    return {
      allowed: false,
      reason: '不能由同一位审核员重复审核同一条记录。',
      requiresSecondModerator: false,
    };
  }
  const requiresSecondModerator = Boolean(species?.isProtected);
  return {
    allowed: true,
    ...(requiresSecondModerator
      ? { reason: '保护物种需要两名审核员复核，你的操作会记录为第一票。' }
      : {}),
    requiresSecondModerator,
  };
}

/* ------------------------------------------------------------------ *
 * 派生展示（纯函数，UI 不自己算）
 * ------------------------------------------------------------------ */

export function sightingStatusLabel(status: SightingStatus): string {
  return SIGHTING_STATUS_LABELS[status];
}

/** 公开坐标是否被扣留 */
export function isGeoWithheld(sighting: Pick<WildlifeSighting, 'geo' | 'geoWithheld'>): boolean {
  return sighting.geo === null;
}

/** 坐标被扣留时给用户看的说明（规格 §9：必须说明"位置已模糊化/已扣留"） */
export function geoDisplayNotice(
  sighting: Pick<WildlifeSighting, 'geo' | 'geoWithheld'>,
  zoneName?: string | null,
): string {
  if (sighting.geo !== null) {
    return '位置已模糊化：公开坐标经过网格吸附与确定性加噪，只能定位到片区，无法定位到具体楼栋。';
  }
  const base =
    GEO_WITHHELD_LABELS[sighting.geoWithheld ?? 'sensitive-zone'] ??
    '该记录不公开坐标，只公开所属区域。';
  return zoneName ? `${base}（所属区域：${zoneName}）` : base;
}

/** 时间粗化说明（规格 §9.5） */
export function observedTimeNotice(sighting: Pick<WildlifeSighting, 'observedAt' | 'observedAtFuzzed'>): string {
  return sighting.observedAt === sighting.observedAtFuzzed
    ? '发现时间已按公开粒度粗化。'
    : '公开时间是粗化后的时间（敏感区粗化到天，普通区粗化到小时），精确时间仅上报人自己可见。';
}

/** 展示用上报人（匿名时**不能**出现 reporterId / 学号 / 姓名） */
export function reporterDisplayLabel(sighting: Pick<WildlifeSighting, 'isAnonymous' | 'reporterLabel'>): string {
  return sighting.isAnonymous ? '匿名同学' : sighting.reporterLabel || '同学';
}

/** 物种展示名（优先用服务端下发的 `speciesNameZh`，退回物种表） */
export function sightingSpeciesName(
  sighting: Pick<WildlifeSighting, 'species' | 'speciesNameZh'>,
  species: readonly SpeciesTaxonomy[] = [],
): string {
  return sighting.speciesNameZh || speciesDisplayName(species, sighting.species);
}

/* ------------------------------------------------------------------ *
 * 过滤 / 排序（纯函数，可单测）
 * ------------------------------------------------------------------ */

export interface SightingListQuery {
  cursor?: string;
  limit?: number;
  /** 物种筛选（`SpeciesTaxonomy.id`） */
  species?: string;
  zoneId?: string;
  status?: SightingStatus;
  /** 只看疑似受伤 */
  healthConcernOnly?: boolean;
}

export interface SightingFilterInput {
  species?: string;
  zoneId?: string;
  status?: SightingStatus;
  healthConcernOnly?: boolean;
}

export function filterSightings<T extends Pick<WildlifeSighting, 'species' | 'zoneId' | 'status' | 'healthConcern'>>(
  sightings: readonly T[],
  filter: SightingFilterInput,
): T[] {
  return sightings.filter((s) => {
    if (filter.species && s.species !== filter.species) return false;
    if (filter.zoneId && s.zoneId !== filter.zoneId) return false;
    if (filter.status && s.status !== filter.status) return false;
    if (filter.healthConcernOnly && !s.healthConcern) return false;
    return true;
  });
}

/** 按发现时间倒序（最近的在前）；非法时间排最后 */
export function sortSightingsByObservedDesc<T extends { observedAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = new Date(a.observedAt).getTime();
    const tb = new Date(b.observedAt).getTime();
    const va = Number.isNaN(ta) ? Number.NEGATIVE_INFINITY : ta;
    const vb = Number.isNaN(tb) ? Number.NEGATIVE_INFINITY : tb;
    return vb - va;
  });
}

/** 审核队列排序：疑似受伤优先，其次按上报时间倒序（规格 §2.10） */
export function sortModerationQueue<T extends Pick<WildlifeSighting, 'healthConcern' | 'createdAt'>>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    if (a.healthConcern !== b.healthConcern) return a.healthConcern ? -1 : 1;
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
  });
}

export function countByStatus(
  items: readonly Pick<WildlifeSighting, 'status'>[],
): Record<SightingStatus, number> {
  const acc: Record<SightingStatus, number> = { PENDING: 0, PUBLISHED: 0, REJECTED: 0 };
  for (const item of items) acc[item.status] += 1;
  return acc;
}
