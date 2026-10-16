/**
 * 用例：发布搭子活动（契约 §7：application 层编排，不含 IO）。
 *
 * 表单里有两处**必须**由 domain 说了算、UI 不得自己判断的东西：
 * 1. **封闭标签**：`tags` 只能取自标签白名单，自由文本一律 `VALIDATION_FAILED`
 *    （规格 §3.2 —— 自由文本会让"共同兴趣"匹配失效）；
 * 2. **联系方式**：`description` 命中手机号 / 微信 / QQ / 邮箱即拒绝
 *    （规格 §6.4 —— 联系方式放进公开正文会被爬取）。
 *
 * 板块不进表单：它由 `activity` 派生（`sectionOf`），避免同一信息两处存储。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import {
  BUDDY_ACTIVITIES,
  BUDDY_ACTIVITY_LABELS,
  BUDDY_CAPACITY_MAX,
  BUDDY_CAPACITY_MIN,
  BUDDY_DESCRIPTION_MAX_LENGTH,
  BUDDY_DURATION_MAX,
  BUDDY_DURATION_MIN,
  BUDDY_MAX_POST_TAGS,
  BUDDY_SECTIONS,
  BUDDY_SECTION_LABELS,
  BUDDY_SKILL_LEVELS,
  BUDDY_SKILL_LEVEL_LABELS,
  BUDDY_TITLE_MAX_LENGTH,
  emptyBuddyPostDraft,
  sectionOf,
  validateBuddyPostDraft,
  type BuddyActivity,
  type BuddyDraftProblem,
  type BuddyPostDraft,
  type BuddySection,
  type BuddySkillLevel,
} from '@/domain/models/buddy';
import type { BuddyRepository, CreateBuddyPostInput } from '@/domain/ports/buddy';

import { newIdempotencyKey } from './ids';
import { toBuddyPostCardVM, type BuddyPostCardVM } from './listBuddyPosts';
import type { BuddySession } from './session';

export interface BuddyPostFormLimits {
  titleMax: number;
  descriptionMax: number;
  capacityMin: number;
  capacityMax: number;
  durationMin: number;
  durationMax: number;
  tagsMax: number;
}

export const BUDDY_POST_FORM_LIMITS: BuddyPostFormLimits = {
  titleMax: BUDDY_TITLE_MAX_LENGTH,
  descriptionMax: BUDDY_DESCRIPTION_MAX_LENGTH,
  capacityMin: BUDDY_CAPACITY_MIN,
  capacityMax: BUDDY_CAPACITY_MAX,
  durationMin: BUDDY_DURATION_MIN,
  durationMax: BUDDY_DURATION_MAX,
  tagsMax: BUDDY_MAX_POST_TAGS,
};

export interface BuddyPostFormVM {
  valid: boolean;
  problems: BuddyDraftProblem[];
  /** 字段 → 第一条中文错误（UI 就地展示） */
  fieldErrors: Record<string, string>;
}

/* ------------------------------------------------------------------ *
 * `datetime-local` ↔ ISO（纯函数，可单测）
 * ------------------------------------------------------------------ */

/** `Date` → `<input type="datetime-local">` 的本地值 `YYYY-MM-DDTHH:mm` */
export function toDatetimeLocalValue(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** `YYYY-MM-DDTHH:mm` → ISO；非法返回空串（**不猜**当前时间） */
export function fromDatetimeLocalValue(value: string): string {
  if (!value.trim()) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

/** 表单默认开始时间：明天 19:00（本地时区） */
export function defaultStartsAtValue(now: Date): string {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + 1);
  date.setHours(19, 0, 0, 0);
  return toDatetimeLocalValue(date);
}

export function emptyBuddyPostForm(now: Date): BuddyPostDraft {
  return { ...emptyBuddyPostDraft(), startsAt: defaultStartsAtValue(now) };
}

/* ------------------------------------------------------------------ *
 * 选项（UI 只渲染，不自己拼枚举）
 * ------------------------------------------------------------------ */

export interface BuddyActivityOption {
  value: BuddyActivity;
  label: string;
  section: BuddySection;
  sectionLabel: string;
}

/** 板块 → 可选活动类型（板块由 activity 派生，所以这里是"反查"） */
export function activityOptionsForSection(section: BuddySection): BuddyActivityOption[] {
  return BUDDY_ACTIVITIES.filter((activity) => sectionOf(activity) === section).map((activity) => ({
    value: activity,
    label: BUDDY_ACTIVITY_LABELS[activity],
    section,
    sectionLabel: BUDDY_SECTION_LABELS[section],
  }));
}

export const BUDDY_POST_SECTION_OPTIONS: readonly {
  value: BuddySection;
  label: string;
  activities: BuddyActivityOption[];
}[] = BUDDY_SECTIONS.map((section) => ({
  value: section,
  label: BUDDY_SECTION_LABELS[section],
  activities: activityOptionsForSection(section),
}));

export const BUDDY_SKILL_OPTIONS: readonly { value: BuddySkillLevel; label: string }[] =
  BUDDY_SKILL_LEVELS.map((level) => ({ value: level, label: BUDDY_SKILL_LEVEL_LABELS[level] }));

/* ------------------------------------------------------------------ *
 * 校验与提交
 * ------------------------------------------------------------------ */

export function validateBuddyPostForm(draft: BuddyPostDraft, now: Date): BuddyPostFormVM {
  const problems = validateBuddyPostDraft(draft, { now });
  const fieldErrors: Record<string, string> = {};
  for (const problem of problems) {
    fieldErrors[problem.field] ??= problem.message;
  }
  return { valid: problems.length === 0, problems, fieldErrors };
}

export function toCreatePostInput(
  draft: BuddyPostDraft,
  session: BuddySession,
): CreateBuddyPostInput {
  return {
    ...draft,
    title: draft.title.trim(),
    description: draft.description.trim(),
    creator: { id: session.userId, nickname: session.nickname, avatarUrl: null },
    idempotencyKey: newIdempotencyKey(),
  };
}

/** 从 `ApiError.details` 里取出结构化问题（服务端也会回 `problems`） */
export function problemsFromApiError(error: ApiError): BuddyDraftProblem[] {
  const details = error.details;
  if (!details || typeof details !== 'object') return [];
  const problems = (details as { problems?: unknown }).problems;
  if (!Array.isArray(problems)) return [];
  return problems.filter(
    (item): item is BuddyDraftProblem =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as BuddyDraftProblem).field === 'string' &&
      typeof (item as BuddyDraftProblem).message === 'string',
  );
}

/**
 * 发布。本地先校验一次（即时反馈），服务端再校验一次（权威）。
 * 校验失败走**同一个** `Result` 错误通道，UI 不需要两套分支。
 */
export async function publishBuddyPost(
  repository: BuddyRepository,
  input: { draft: BuddyPostDraft; session: BuddySession; now?: Date },
): Promise<Result<BuddyPostCardVM, ApiError>> {
  const now = input.now ?? new Date();
  const form = validateBuddyPostForm(input.draft, now);
  if (!form.valid) {
    const first = form.problems[0] as BuddyDraftProblem;
    return err({
      code: 'VALIDATION_FAILED',
      message: first.message,
      details: { reason: first.reason, problems: form.problems },
    });
  }

  const created = await repository.createPost(toCreatePostInput(input.draft, input.session));
  if (!created.ok) return err(created.error);

  return ok(
    toBuddyPostCardVM(created.value, {
      now,
      viewerId: input.session.userId,
      myApplicationStatus: null,
    }),
  );
}
