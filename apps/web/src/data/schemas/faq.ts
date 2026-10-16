/**
 * 常见问题传输层校验（zod）—— data 层职责：**校验不可信输入**。
 *
 * domain 模型是类型真相；这里用类型级断言保证 schema 输出与 domain 模型
 * 双向可赋值 —— schema 一旦漂移，`tsc` 立刻报错。
 */
import { z } from 'zod';

import type {
  FaqArticle,
  FaqArticleStatus,
  FaqTicket,
  FaqTicketStatus,
  FaqVote,
} from '@/domain/models/faq';

/** 类型级断言：From 必须可赋值给 To（不产生运行时代码） */
type AssertAssignable<From extends To, To> = true;

export const faqArticleStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export const faqArticleSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  question: z.string().min(1),
  answer: z.string(),
  category: z.string().min(1),
  status: faqArticleStatusSchema,
  helpfulCount: z.int().nonnegative(),
  unhelpfulCount: z.int().nonnegative(),
  updatedAt: z.iso.datetime(),
});

export const faqTicketStatusSchema = z.enum(['OPEN', 'ANSWERED', 'CLOSED']);

export const faqTicketSchema = z.object({
  id: z.string().min(1),
  /** 未登录提交时为 null（契约 §2.8） */
  userId: z.string().min(1).nullable(),
  contact: z.string().min(1),
  question: z.string().min(1),
  status: faqTicketStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  answer: z.string().optional(),
  answeredAt: z.iso.datetime().optional(),
});

export const faqVoteSchema = z.enum(['helpful', 'unhelpful']);

export const faqArticlePageSchema = z.object({
  items: z.array(faqArticleSchema),
  nextCursor: z.string().nullable(),
  total: z.int().nonnegative().optional(),
});

export const faqTicketPageSchema = z.object({
  items: z.array(faqTicketSchema),
  nextCursor: z.string().nullable(),
  total: z.int().nonnegative().optional(),
});

/* ---- 编译期一致性断言（schema ↔ domain） ---- */
export type __ArticleStatusMatches = AssertAssignable<
  z.infer<typeof faqArticleStatusSchema>,
  FaqArticleStatus
>;
export type __ArticleSchemaIsDomain = AssertAssignable<
  z.infer<typeof faqArticleSchema>,
  FaqArticle
>;
export type __ArticleDomainIsSchema = AssertAssignable<
  FaqArticle,
  z.infer<typeof faqArticleSchema>
>;
export type __TicketStatusMatches = AssertAssignable<
  z.infer<typeof faqTicketStatusSchema>,
  FaqTicketStatus
>;
export type __TicketSchemaIsDomain = AssertAssignable<z.infer<typeof faqTicketSchema>, FaqTicket>;
export type __TicketDomainIsSchema = AssertAssignable<FaqTicket, z.infer<typeof faqTicketSchema>>;
export type __VoteMatches = AssertAssignable<z.infer<typeof faqVoteSchema>, FaqVote>;

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

export function safeParseFaqArticle(input: unknown): ParseOk<FaqArticle> | ParseFail {
  return parseWith(faqArticleSchema, input);
}

export function safeParseFaqTicket(input: unknown): ParseOk<FaqTicket> | ParseFail {
  return parseWith(faqTicketSchema, input);
}

export function safeParseFaqArticlePage(
  input: unknown,
): ParseOk<{ items: FaqArticle[]; nextCursor: string | null; total?: number }> | ParseFail {
  return parseWith(faqArticlePageSchema, input);
}

export function safeParseFaqTicketPage(
  input: unknown,
): ParseOk<{ items: FaqTicket[]; nextCursor: string | null; total?: number }> | ParseFail {
  return parseWith(faqTicketPageSchema, input);
}
