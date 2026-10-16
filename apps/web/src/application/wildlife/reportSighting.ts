/**
 * 用例：上报观测（规格 §4 / §5 / §8 / §10.3）。
 *
 * 完整链路（每一步都能被单测覆盖，不需要 jsdom）：
 * ```
 * 选照片 → validateMediaFile（客户端先挡一次）
 *        → uploadSightingMedia（POST /media，服务端强制剥离 EXIF）
 *        → suggestSpeciesForMedia（POST /classify；**无能力时返回空 → 静默降级为手动**）
 *        → 地图点选地点 + 填发现时间 + 选物种（+ 可选给个体起名）
 *        → validateSightingDraft（伦理勾选是**表单校验**，不是同意门）
 *        → submitSighting（POST /items，带 Idempotency-Key）
 * ```
 *
 * 设计原则（规格 §5.2）：**分类是增强，不是前置条件。没有分类，上报依然完整有效。**
 */
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import {
  SIGHTING_LIMITS,
  toCreateSightingInput,
  validateSightingDraft,
  type CreateSightingInput,
  type SightingDraft,
  type UploadedMedia,
  type WildlifeSighting,
} from '@/domain/models/wildlife/sightings';
import {
  classifySuggestion,
  speciesDisplayName,
  type ClassifierSuggestion,
  type SpeciesTaxonomy,
} from '@/domain/models/wildlife/species';
import { validateIndividualName } from '@/domain/models/wildlife/tracks';
import type { WildlifeRepository } from '@/domain/ports/wildlife';

import { toSightingListItemVM, type SightingListItemVM, type WildlifeCatalog } from './listSightings';

/** 上报人会话（占位：真实实现必须来自契约 §5 第一级身份层） */
export interface WildlifeReporterSession {
  userId: string;
  nickname: string;
}

export const DEMO_WILDLIFE_SESSION: WildlifeReporterSession = {
  userId: 'u_1024',
  nickname: '鸭鸭先冲',
};

/** 客户端幂等键（规格 §4.5）：重试时**必须复用**同一个，否则会产生重复媒体 */
export function createClientPhotoId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ *
 * ① 客户端预校验（服务端仍会独立复核）
 * ------------------------------------------------------------------ */

export function validateMediaFile(file: Pick<File, 'type' | 'size' | 'name'>): string[] {
  const problems: string[] = [];
  if (!(SIGHTING_LIMITS.mediaMimeTypes as readonly string[]).includes(file.type)) {
    problems.push('只接受 JPEG / PNG / WebP 图片（服务端会读文件头校验，改扩展名无效）。');
  }
  if (file.size > SIGHTING_LIMITS.mediaByteMax) {
    problems.push(`单张照片不能超过 ${SIGHTING_LIMITS.mediaByteMax / 1024 / 1024} MB。`);
  }
  if (file.size === 0) problems.push('这个文件是空的。');
  return problems;
}

/* ------------------------------------------------------------------ *
 * ② 上传
 * ------------------------------------------------------------------ */

export async function uploadSightingMedia(
  repository: WildlifeRepository,
  input: { file: File; clientPhotoId: string },
): Promise<Result<UploadedMedia, ApiError>> {
  const problems = validateMediaFile(input.file);
  if (problems.length > 0) {
    return err({
      code: 'VALIDATION_FAILED',
      message: problems[0] as string,
      details: { problems },
    });
  }
  return repository.uploadMedia(input);
}

/* ------------------------------------------------------------------ *
 * ③ 自动分类建议（可选增强，可离线降级）
 * ------------------------------------------------------------------ */

export interface ClassifierOutcome {
  /** 服务端是否具备分类能力 */
  available: boolean;
  suggestions: ClassifierSuggestion[];
  /** 分类来源（用于写入 `classifiedBy`） */
  classifiedBy: 'vision_api' | 'fallback';
  /** 无能力时的说明文案（UI 显示"自动分类不可用，请手动选择"） */
  notice: string;
}

/**
 * 请求分类建议。
 *
 * **无能力时返回 `available: false` + 空建议 + `classifiedBy: 'fallback'`，绝不抛错**
 * （规格 §5.2 流程图：`ok --否--> fallback 静默降级到手动`；验收 T43）。
 */
export async function suggestSpeciesForMedia(
  repository: WildlifeRepository,
  mediaId: string,
  catalog: Pick<WildlifeCatalog, 'species'>,
  topK = 3,
): Promise<Result<ClassifierOutcome, ApiError>> {
  const result = await repository.classify(mediaId, topK);
  if (!result.ok) return err(result.error);

  if (result.value.length === 0) {
    return ok({
      available: false,
      suggestions: [],
      classifiedBy: 'fallback',
      notice: '当前没有启用自动分类（或识别服务不可用），请手动选择物种 —— 这不影响上报。',
    });
  }

  const suggestions = result.value
    .filter((prediction) => catalog.species.some((s) => s.id === prediction.speciesId))
    .map((prediction) =>
      classifySuggestion(
        prediction.speciesId,
        prediction.confidence,
        speciesDisplayName(catalog.species, prediction.speciesId),
      ),
    );

  return ok({
    available: true,
    suggestions,
    classifiedBy: 'vision_api',
    notice: '识别结果仅供参考，请确认物种。平台不保证识别准确率。',
  });
}

/** 采纳某个建议（置信度 < 0.60 的建议**不得**被自动预选，规格 §5.5 / T44） */
export function applySuggestion(
  draft: SightingDraft,
  suggestion: ClassifierSuggestion | null,
): SightingDraft {
  if (!suggestion) return draft;
  return {
    ...draft,
    speciesId: suggestion.speciesId,
    autoSpeciesId: suggestion.speciesId,
    autoConfidence: suggestion.confidence,
    classifiedBy: suggestion.preselected ? 'vision_api' : 'manual',
  };
}

/** 用户手动改了物种 → 记录纠正（规格 §5.5 纠正闭环） */
export function correctSpecies(draft: SightingDraft, speciesId: string): SightingDraft {
  // `autoSpeciesId` / `classifiedBy` **保留原值**（规格 §5.5 第 1 条）：
  // 服务端据此派生 `correctedFromSpeciesId`，并把它变成一条标注样本 —— 客户端不自造该字段。
  return { ...draft, speciesId };
}

/** 是否发生了"纠正自动识别结果"（供 UI 提示"已记录为纠正样本"） */
export function isCorrection(draft: SightingDraft): boolean {
  return Boolean(draft.autoSpeciesId) && draft.autoSpeciesId !== draft.speciesId;
}

/* ------------------------------------------------------------------ *
 * ④ 提交
 * ------------------------------------------------------------------ */

export interface SightingSubmitReceipt {
  sightingId: string;
  status: WildlifeSighting['status'];
  statusLabel: string;
  /** 提交后给用户的完整回执文案（含隐私说明与后续流程） */
  message: string;
  item: SightingListItemVM;
}

export interface SubmitSightingOutcome {
  /** 校验未通过时返回问题清单，UI 直接渲染（不是异常） */
  problems: string[];
  receipt: SightingSubmitReceipt | null;
}

/**
 * 提交上报。
 *
 * 注意：校验失败返回**结构化问题清单**（`problems`）而不是抛异常 ——
 * 表单校验是正常流程，不是错误。
 */
export async function submitSighting(
  repository: WildlifeRepository,
  draft: SightingDraft,
  catalog: WildlifeCatalog,
  now: Date = new Date(),
): Promise<Result<SubmitSightingOutcome, ApiError>> {
  const validation = validateSightingDraft(draft, now, {
    knownSpeciesIds: catalog.species.map((s) => s.id),
  });

  if (draft.individualName.trim() !== '') {
    const nameProblems = validateIndividualName(draft.individualName);
    if (nameProblems.length > 0) {
      return ok({ problems: nameProblems, receipt: null });
    }
  }

  if (!validation.ok) {
    return ok({ problems: validation.problems.map((p) => p.message), receipt: null });
  }

  const inputResult = toCreateSightingInput(draft, now, {
    knownSpeciesIds: catalog.species.map((s) => s.id),
  });
  if (!inputResult.ok) {
    const details = inputResult.error.details as { reasons?: string[] } | undefined;
    return err({
      ...inputResult.error,
      message: `${inputResult.error.message}${details?.reasons ? `（${details.reasons.join('、')}）` : ''}`,
    });
  }

  const created = await repository.createSighting(inputResult.value);
  if (!created.ok) return err(created.error);

  const item = toSightingListItemVM(created.value, catalog, now);
  return ok({
    problems: [],
    receipt: {
      sightingId: created.value.id,
      status: created.value.status,
      statusLabel: item.statusLabel,
      message: created.value.healthConcern
        ? '已提交（疑似受伤）。我们已立即通知校园动物社团，请勿自行处理或投喂；公开可见仍需审核。'
        : '已提交，进入审核队列。审核通过后才会出现在地图与列表里；位置在公开时会被模糊化。',
      item,
    },
  });
}

/** 上报页的"当前进度"提示（纯函数，UI 只渲染） */
export function reportProgressHint(input: {
  photoCount: number;
  hasGeo: boolean;
  speciesId: string;
  ethicsAcknowledged: boolean;
}): string {
  if (input.photoCount === 0) return '第 1 步：选一张照片（可选，但没有照片的上报更容易被拒）。';
  if (!input.hasGeo) return '第 2 步：在地图上点选发现地点。';
  if (!input.speciesId) return '第 3 步：选择物种（识别建议只是参考）。';
  if (!input.ethicsAcknowledged) return '第 4 步：阅读并勾选伦理守则。';
  return '信息齐全，可以提交。';
}

/** 便于测试与 UI：当前草稿对应的创建请求体（未通过校验时为 null） */
export function previewCreateInput(
  draft: SightingDraft,
  now: Date,
  knownSpeciesIds?: readonly string[],
): CreateSightingInput | null {
  const result = toCreateSightingInput(draft, now, {
    ...(knownSpeciesIds ? { knownSpeciesIds } : {}),
  });
  return result.ok ? result.value : null;
}
