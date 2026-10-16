/**
 * 论坛传输层校验（zod）—— data 层职责：**校验不可信输入**。
 *
 * domain 模型是类型真相；这里用类型级断言保证 schema 输出与 domain 模型
 * 双向可赋值 —— schema 一旦漂移，`tsc` 立刻报错。
 */
import { z } from 'zod';

import type {
  ForumBoard,
  ForumBoardVisibility,
  ForumPost,
  ForumPostStatus,
  ForumReply,
  ForumReplyStatus,
  ForumReport,
  ForumReportReason,
  ForumReportStatus,
  ForumReportTargetType,
} from '@/domain/models/forum';

/** 类型级断言：From 必须可赋值给 To（不产生运行时代码） */
type AssertAssignable<From extends To, To> = true;

export const forumBoardVisibilitySchema = z.enum(['public', 'campus_only']);

export const forumBoardSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  visibility: forumBoardVisibilitySchema,
  postCount: z.int().nonnegative(),
  lastPostAt: z.iso.datetime().nullable(),
});

export const forumPostStatusSchema = z.enum([
  'DRAFT',
  'PUBLISHED',
  'LOCKED',
  'HIDDEN',
  'DELETED',
]);

export const forumPostSchema = z.object({
  id: z.string().min(1),
  boardId: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  status: forumPostStatusSchema,
  anonymous: z.boolean(),
  authorId: z.string().min(1),
  authorNickname: z.string().min(1),
  tags: z.array(z.string()),
  replyCount: z.int().nonnegative(),
  likeCount: z.int().nonnegative(),
  pinnedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  lastActivityAt: z.iso.datetime(),
});

export const forumReplyStatusSchema = z.enum(['PUBLISHED', 'HIDDEN', 'DELETED']);

export const forumReplySchema = z.object({
  id: z.string().min(1),
  postId: z.string().min(1),
  parentReplyId: z.string().nullable(),
  body: z.string(),
  status: forumReplyStatusSchema,
  anonymous: z.boolean(),
  authorId: z.string().min(1),
  authorNickname: z.string().min(1),
  likeCount: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
});

export const forumReportTargetTypeSchema = z.enum(['POST', 'REPLY']);

export const forumReportReasonSchema = z.enum(['spam', 'abuse', 'illegal', 'privacy', 'other']);

export const forumReportStatusSchema = z.enum(['PENDING', 'UPHELD', 'DISMISSED']);

export const forumReportSchema = z.object({
  id: z.string().min(1),
  targetType: forumReportTargetTypeSchema,
  targetId: z.string().min(1),
  reason: forumReportReasonSchema,
  status: forumReportStatusSchema,
  reporterId: z.string().min(1),
  anonymous: z.boolean(),
  note: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export const forumPostPageSchema = z.object({
  items: z.array(forumPostSchema),
  nextCursor: z.string().nullable(),
  total: z.int().nonnegative().optional(),
});

export const forumReplyPageSchema = z.object({
  items: z.array(forumReplySchema),
  nextCursor: z.string().nullable(),
  total: z.int().nonnegative().optional(),
});

export const forumPostDetailSchema = z.object({
  post: forumPostSchema,
  replies: z.array(forumReplySchema),
  repliesNextCursor: z.string().nullable(),
});

export const forumBoardListSchema = z.array(forumBoardSchema);

/* ---- 编译期一致性断言（schema ↔ domain） ---- */
export type __VisibilityMatches = AssertAssignable<
  z.infer<typeof forumBoardVisibilitySchema>,
  ForumBoardVisibility
>;
export type __BoardSchemaIsDomain = AssertAssignable<z.infer<typeof forumBoardSchema>, ForumBoard>;
export type __BoardDomainIsSchema = AssertAssignable<ForumBoard, z.infer<typeof forumBoardSchema>>;
export type __PostStatusMatches = AssertAssignable<
  z.infer<typeof forumPostStatusSchema>,
  ForumPostStatus
>;
export type __PostSchemaIsDomain = AssertAssignable<z.infer<typeof forumPostSchema>, ForumPost>;
export type __PostDomainIsSchema = AssertAssignable<ForumPost, z.infer<typeof forumPostSchema>>;
export type __ReplyStatusMatches = AssertAssignable<
  z.infer<typeof forumReplyStatusSchema>,
  ForumReplyStatus
>;
export type __ReplySchemaIsDomain = AssertAssignable<z.infer<typeof forumReplySchema>, ForumReply>;
export type __ReplyDomainIsSchema = AssertAssignable<ForumReply, z.infer<typeof forumReplySchema>>;
export type __ReportTargetMatches = AssertAssignable<
  z.infer<typeof forumReportTargetTypeSchema>,
  ForumReportTargetType
>;
export type __ReportReasonMatches = AssertAssignable<
  z.infer<typeof forumReportReasonSchema>,
  ForumReportReason
>;
export type __ReportStatusMatches = AssertAssignable<
  z.infer<typeof forumReportStatusSchema>,
  ForumReportStatus
>;
export type __ReportSchemaIsDomain = AssertAssignable<z.infer<typeof forumReportSchema>, ForumReport>;
export type __ReportDomainIsSchema = AssertAssignable<ForumReport, z.infer<typeof forumReportSchema>>;

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

function parseWith<T>(schema: z.ZodType<T>, input: unknown): ParseOk<T> | ParseFail {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: formatZodIssues(result.error) };
}

export function safeParseForumBoards(input: unknown): ParseOk<ForumBoard[]> | ParseFail {
  return parseWith(forumBoardListSchema, input);
}

export function safeParseForumPost(input: unknown): ParseOk<ForumPost> | ParseFail {
  return parseWith(forumPostSchema, input);
}

export function safeParseForumReply(input: unknown): ParseOk<ForumReply> | ParseFail {
  return parseWith(forumReplySchema, input);
}

export function safeParseForumReport(input: unknown): ParseOk<ForumReport> | ParseFail {
  return parseWith(forumReportSchema, input);
}

export function safeParseForumPostPage(
  input: unknown,
): ParseOk<{ items: ForumPost[]; nextCursor: string | null; total?: number }> | ParseFail {
  return parseWith(forumPostPageSchema, input);
}

export function safeParseForumReplyPage(
  input: unknown,
): ParseOk<{ items: ForumReply[]; nextCursor: string | null; total?: number }> | ParseFail {
  return parseWith(forumReplyPageSchema, input);
}

export function safeParseForumPostDetail(input: unknown): ParseOk<{
  post: ForumPost;
  replies: ForumReply[];
  repliesNextCursor: string | null;
}> | ParseFail {
  return parseWith(forumPostDetailSchema, input);
}
