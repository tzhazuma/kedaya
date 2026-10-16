/**
 * 找搭子 · 问卷用例（规格 §2.6 / §5.1 端点 16–19）
 *
 * ## 答案 → 资料的同步（本文件的核心逻辑）
 *
 * 移植 STUMatch 的 `_sync_profile_from_answers`
 * （`questionnaires.py:117-169`），但**只同步白名单键**
 * （`interestTags` / `activityTags` / `availability` / `skillLevel` /
 * `preferredAreas` / `department`）。其余键只进 `answers`。
 * 白名单在 `domain/profile-sync.ts`，那里有"为什么必须白名单"的完整论证。
 *
 * ## 一条重要的隐私约束
 *
 * 填问卷会**创建/更新**匹配资料，但**不会**把 `matchEnabled` 打开。
 * 用户填资料 ≠ 同意参与匹配（规格 §6.3：匹配是新用途，不默认开启）。
 * 因此这里对已存在的资料**保留原 `matchEnabled`**，对新建的资料用 `false`。
 *
 * ## 未知题目 id 的答案
 *
 * 被丢弃（不报错）：题目可能已被运营下架，而用户手里还是旧版小程序。
 * 见 `validateAnswers` 的注释。
 */

import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../../../common/errors/app-error';
import { parseQuestions, validateAnswers, type Question } from '../domain/questionnaire';
import { syncProfileFromAnswers } from '../domain/profile-sync';
import type { BuddySection } from '../domain/section';
import {
  BUDDY_PROFILE_REPOSITORY,
  BUDDY_QUESTIONNAIRE_REPOSITORY,
  type BuddyProfileRepository,
  type BuddyQuestionnaireModel,
  type BuddyQuestionnaireRepository,
} from '../domain/buddy.domain';
import { BuddyMatchingService } from './buddy-matching.service';

export interface QuestionnaireView {
  slug: string;
  title: string;
  section: string;
  description: string | null;
  questions: unknown;
  version: number;
}

export interface SubmitResponseResult {
  slug: string;
  version: number;
  /** 实际写入 `BuddyProfile` 的键（透明化：用户能看到哪些答案被用于匹配） */
  syncedKeys: string[];
  /** 被丢弃的可同步键及原因（运营排查用） */
  ignored: Array<{ key: string; reason: string }>;
}

@Injectable()
export class BuddyQuestionnaireService {
  constructor(
    @Inject(BUDDY_QUESTIONNAIRE_REPOSITORY) private readonly questionnaires: BuddyQuestionnaireRepository,
    @Inject(BUDDY_PROFILE_REPOSITORY) private readonly profiles: BuddyProfileRepository,
    @Inject(BuddyMatchingService) private readonly matching: BuddyMatchingService,
  ) {}

  async list(section?: BuddySection): Promise<QuestionnaireView[]> {
    const rows = await this.questionnaires.listActive(section);
    return rows.map(toView);
  }

  async detail(slug: string): Promise<QuestionnaireView> {
    const found = await this.questionnaires.findBySlug(slug);
    if (!found || !found.isActive) throw new NotFoundError('问卷不存在或已下架');
    return toView(found);
  }

  /**
   * 提交答案。
   *
   * 校验分两层：
   *   1. **题目定义**必须合法（`parseQuestions`）—— 否则整份问卷不可用（500 级配置错误，
   *      但按 422 返回更诚实：这是"这份问卷的数据有问题"）；
   *   2. **答案**必须符合题目声明（`validateAnswers`）—— 不合法的答案返回 422 字段级错误。
   */
  async submit(slug: string, userId: string, rawAnswers: unknown): Promise<SubmitResponseResult> {
    const questionnaire = await this.questionnaires.findBySlug(slug);
    if (!questionnaire || !questionnaire.isActive) throw new NotFoundError('问卷不存在或已下架');

    const parsed = parseQuestions(questionnaire.questions);
    if (!parsed.ok) {
      throw new ValidationError(`问卷定义不合法：${parsed.reason}`, { reason: 'QUESTIONNAIRE_INVALID' });
    }

    const validated = validateAnswers(parsed.questions as Question[], rawAnswers);
    if (!validated.ok) {
      throw new ValidationError('答案不符合题目要求', validated.errors);
    }

    await this.questionnaires.upsertResponse({
      questionnaireId: questionnaire.id,
      userId,
      answers: validated.answers,
      version: questionnaire.version,
    });

    // —— 白名单同步进 BuddyProfile ——
    const { patch, ignored } = syncProfileFromAnswers(validated.answers);
    const syncedKeys = Object.keys(patch);

    if (syncedKeys.length > 0) {
      const existing = await this.profiles.findByUserId(userId);
      const saved = await this.profiles.upsert(userId, {
        // 未填过的板块/标签用空值起步，而不是"清空已有值"
        sections: existing?.sections ?? [questionnaire.section],
        interestTags: patch.interestTags ?? existing?.interestTags ?? [],
        activityTags: patch.activityTags ?? existing?.activityTags ?? [],
        skillLevel: patch.skillLevel ?? existing?.skillLevel ?? null,
        availability: patch.availability ?? existing?.availability ?? [],
        preferredAreas: patch.preferredAreas ?? existing?.preferredAreas ?? [],
        department: patch.department ?? existing?.department ?? null,
        bio: existing?.bio ?? null,
        // ⚠️ 保留原有开关；新建时**默认 false**（规格 §6.3：不默认开启）
        matchEnabled: existing?.matchEnabled ?? false,
      });
      await this.matching.ensureProfileEmbedding(userId, saved);
    }

    return {
      slug: questionnaire.slug,
      version: questionnaire.version,
      syncedKeys,
      ignored,
    };
  }

  /** 我的答案（规格 §5.1 端点 19） */
  async mine(slug: string, userId: string): Promise<{ slug: string; answers: unknown; version: number } | null> {
    const questionnaire = await this.questionnaires.findBySlug(slug);
    if (!questionnaire) throw new NotFoundError('问卷不存在或已下架');

    const response = await this.questionnaires.findResponse(questionnaire.id, userId);
    if (!response) return null;

    return { slug: questionnaire.slug, answers: response.answers, version: response.version };
  }
}

function toView(model: BuddyQuestionnaireModel): QuestionnaireView {
  return {
    slug: model.slug,
    title: model.title,
    section: model.section,
    description: model.description,
    questions: model.questions,
    version: model.version,
  };
}
