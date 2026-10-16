/**
 * 找搭子传输层校验（zod）—— data 层职责：**校验不可信输入**。
 *
 * domain 模型是类型真相；这里用类型级断言保证 schema 输出与 domain 模型
 * 双向可赋值 —— schema 一旦漂移，`tsc` 立刻报错（与 groupbuy / forum / wildlife 同一套约定）。
 *
 * 隐私相关的**负向断言**也在这里：出站对象里不允许出现 `embedding`、联系方式、
 * 性别 / 年龄字段（规格 §8.4 T26 / T27）。schema 用 `z.strictObject` 之外的形状
 * 会静默剥离未知键，因此这里额外提供 `findForbiddenFields()` 做显式检查。
 */
import { z } from 'zod';

import type {
  BuddyApplication,
  BuddyAvailabilitySlot,
  BuddyMatchFeedback,
  BuddyPost,
  BuddyPostCreator,
  BuddyProfile,
  BuddySection,
} from '@/domain/models/buddy';
import type { MatchReason } from '@kedaya/shared';

import type { BuddyPostDetail, BuddyRecommendation, BuddyRecommendationPage } from '@/domain/ports/buddy';

/** 类型级断言：From 必须可赋值给 To（不产生运行时代码） */
type AssertAssignable<From extends To, To> = true;

export const buddySectionSchema = z.enum(['academic', 'daily', 'sport']);

export const buddyActivitySchema = z.enum(['sport', 'study', 'meal', 'travel', 'game', 'other']);

export const buddyPostStatusSchema = z.enum(['OPEN', 'FULL', 'CLOSED', 'EXPIRED', 'CANCELLED']);

export const buddyApplicationStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
]);

export const buddyGenderPreferenceSchema = z.enum(['any', 'same', 'other']);

export const buddySkillLevelSchema = z.enum(['beginner', 'casual', 'regular', 'competitive']);

export const buddyFeedbackActionSchema = z.enum(['like', 'dislike', 'skip']);

export const buddyMatchModeSchema = z.enum(['vector', 'hash', 'rule']);

/** 可用时段：`endMin < startMin` 表示跨零点（与共享纯函数语义一致） */
export const buddyAvailabilitySlotSchema = z.object({
  dow: z.int().min(0).max(6),
  startMin: z.int().min(0).max(1439),
  endMin: z.int().min(0).max(1439),
});

export const buddyPostCreatorSchema = z.object({
  id: z.string().min(1),
  nickname: z.string().min(1),
  avatarUrl: z.string().nullable(),
});

export const buddyPostSchema = z.object({
  id: z.string().min(1),
  activity: buddyActivitySchema,
  status: buddyPostStatusSchema,
  title: z.string().min(1).max(60),
  description: z.string().max(1000).nullable(),
  location: z.string().min(1),
  startsAt: z.iso.datetime({ offset: true }),
  durationMin: z.int().min(30).max(480),
  capacity: z.int().min(2).max(20),
  joinedCount: z.int().min(1),
  genderPreference: buddyGenderPreferenceSchema,
  minSkillLevel: buddySkillLevelSchema.nullable(),
  tags: z.array(z.string()).max(8),
  creator: buddyPostCreatorSchema,
  createdAt: z.iso.datetime({ offset: true }),
  autoCloseAt: z.iso.datetime({ offset: true }).nullable(),
});

export const buddyApplicationSchema = z.object({
  id: z.string().min(1),
  postId: z.string().min(1),
  applicantId: z.string().min(1),
  applicantNickname: z.string().min(1),
  status: buddyApplicationStatusSchema,
  message: z.string().max(200).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  decidedBy: z.string().nullable(),
});

export const buddyPostDetailSchema = z.object({
  post: buddyPostSchema,
  applications: z.array(buddyApplicationSchema),
  viewerApplication: buddyApplicationSchema.nullable(),
  viewerIsCreator: z.boolean(),
});

export const buddyProfileSchema = z.object({
  userId: z.string().min(1),
  sections: z.array(buddySectionSchema).max(3),
  interestTags: z.array(z.string()).max(20),
  activityTags: z.array(z.string()).max(10),
  skillLevel: buddySkillLevelSchema,
  availability: z.array(buddyAvailabilitySlotSchema),
  preferredAreas: z.array(z.string()).max(5),
  department: z.string().max(64).nullable(),
  bio: z.string().max(200).nullable(),
  matchEnabled: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const buddyMatchFeedbackSchema = z.object({
  userId: z.string().min(1),
  targetPostId: z.string().min(1),
  section: buddySectionSchema,
  action: buddyFeedbackActionSchema,
  createdAt: z.iso.datetime({ offset: true }),
});

export const buddyPostPageSchema = z.object({
  items: z.array(buddyPostSchema),
  nextCursor: z.string().nullable(),
  total: z.int().nonnegative().optional(),
});

export const buddyApplicationPageSchema = z.object({
  items: z.array(buddyApplicationSchema),
  nextCursor: z.string().nullable(),
  total: z.int().nonnegative().optional(),
});

export const buddyMatchReasonSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  weight: z.number(),
});

export const buddyRecommendationSchema = z.object({
  post: buddyPostSchema,
  score: z.number().min(0).max(1),
  reason: z.string().min(1),
  reasons: z.array(buddyMatchReasonSchema).optional(),
});

export const buddyRecommendationPageSchema = z.object({
  items: z.array(buddyRecommendationSchema),
  nextCursor: z.string().nullable(),
  matchMode: buddyMatchModeSchema,
});

/* ---- 编译期一致性断言（schema ↔ domain） ---- */
export type __SectionMatches = AssertAssignable<
  z.infer<typeof buddySectionSchema>,
  BuddySection
>;
export type __SlotSchemaIsDomain = AssertAssignable<
  z.infer<typeof buddyAvailabilitySlotSchema>,
  BuddyAvailabilitySlot
>;
export type __SlotDomainIsSchema = AssertAssignable<
  BuddyAvailabilitySlot,
  z.infer<typeof buddyAvailabilitySlotSchema>
>;
export type __CreatorMatches = AssertAssignable<
  z.infer<typeof buddyPostCreatorSchema>,
  BuddyPostCreator
>;
export type __PostSchemaIsDomain = AssertAssignable<z.infer<typeof buddyPostSchema>, BuddyPost>;
export type __PostDomainIsSchema = AssertAssignable<BuddyPost, z.infer<typeof buddyPostSchema>>;
export type __ApplicationMatches = AssertAssignable<
  z.infer<typeof buddyApplicationSchema>,
  BuddyApplication
>;
export type __ApplicationDomainIsSchema = AssertAssignable<
  BuddyApplication,
  z.infer<typeof buddyApplicationSchema>
>;
export type __DetailMatches = AssertAssignable<
  z.infer<typeof buddyPostDetailSchema>,
  BuddyPostDetail
>;
export type __ProfileMatches = AssertAssignable<z.infer<typeof buddyProfileSchema>, BuddyProfile>;
export type __ProfileDomainIsSchema = AssertAssignable<
  BuddyProfile,
  z.infer<typeof buddyProfileSchema>
>;
export type __FeedbackMatches = AssertAssignable<
  z.infer<typeof buddyMatchFeedbackSchema>,
  BuddyMatchFeedback
>;
export type __MatchReasonSchemaIsShared = AssertAssignable<
  z.infer<typeof buddyMatchReasonSchema>,
  MatchReason
>;
export type __RecommendationMatches = AssertAssignable<
  z.infer<typeof buddyRecommendationSchema>,
  Omit<BuddyRecommendation, 'reasons'> & { reasons?: MatchReason[] }
>;
export type __RecommendationPageMatches = AssertAssignable<
  z.infer<typeof buddyRecommendationPageSchema>,
  Omit<BuddyRecommendationPage, 'items'> & {
    items: (Omit<BuddyRecommendation, 'reasons'> & { reasons?: MatchReason[] })[];
  }
>;

/** 校验失败时的可读问题清单 */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export interface ParseOk<T> {
  ok: true;
  value: T;
}
export interface ParseFail {
  ok: false;
  issues: string[];
}

function parseWith<T>(result: z.ZodSafeParseResult<T>): ParseOk<T> | ParseFail {
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: formatZodIssues(result.error) };
}

/**
 * 出站对象里**禁止出现**的字段（规格 §8.4 T26 / T27）。
 * 联系方式不在 `buddy` 的任何响应里；匹配向量绝不外发；性别与年龄不采集。
 */
export const BUDDY_FORBIDDEN_RESPONSE_FIELDS: readonly string[] = [
  'embedding',
  'embeddingModel',
  'phone',
  'mobile',
  'wechat',
  'wechatId',
  'email',
  'qq',
  'contact',
  'contactInfo',
  'gender',
  'age',
  'birthDate',
  'mbti',
];

/** 递归查找被禁止的字段名（返回 `path:field` 列表，空数组 = 干净） */
export function findForbiddenFields(
  value: unknown,
  forbidden: readonly string[] = BUDDY_FORBIDDEN_RESPONSE_FIELDS,
  path = '',
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenFields(item, forbidden, `${path}[${index}]`));
  }
  if (typeof value !== 'object' || value === null) return [];

  const hits: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    if (forbidden.includes(key)) hits.push(here);
    hits.push(...findForbiddenFields(child, forbidden, here));
  }
  return hits;
}

export const safeParseBuddyPost = (input: unknown): ParseOk<BuddyPost> | ParseFail =>
  parseWith(buddyPostSchema.safeParse(input));

export const safeParseBuddyPostPage = (
  input: unknown,
): ParseOk<{ items: BuddyPost[]; nextCursor: string | null; total?: number }> | ParseFail =>
  parseWith(buddyPostPageSchema.safeParse(input));

export const safeParseBuddyPostDetail = (input: unknown): ParseOk<BuddyPostDetail> | ParseFail =>
  parseWith(buddyPostDetailSchema.safeParse(input));

export const safeParseBuddyApplication = (
  input: unknown,
): ParseOk<BuddyApplication> | ParseFail => parseWith(buddyApplicationSchema.safeParse(input));

export const safeParseBuddyApplications = (
  input: unknown,
): ParseOk<BuddyApplication[]> | ParseFail =>
  parseWith(z.array(buddyApplicationSchema).safeParse(input));

export const safeParseBuddyProfile = (input: unknown): ParseOk<BuddyProfile> | ParseFail =>
  parseWith(buddyProfileSchema.safeParse(input));

export const safeParseBuddyFeedback = (
  input: unknown,
): ParseOk<BuddyMatchFeedback> | ParseFail =>
  parseWith(buddyMatchFeedbackSchema.safeParse(input));

export const safeParseBuddyRecommendationPage = (
  input: unknown,
): ParseOk<{
  items: (Omit<BuddyRecommendation, 'reasons'> & { reasons?: MatchReason[] })[];
  nextCursor: string | null;
  matchMode: 'vector' | 'hash' | 'rule';
}> | ParseFail => parseWith(buddyRecommendationPageSchema.safeParse(input));
