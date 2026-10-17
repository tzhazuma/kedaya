/**
 * 拼单传输层校验（zod）—— data 层职责：**校验不可信输入**。
 *
 * domain 模型是类型真相；这里用类型级断言保证 schema 输出与 domain 模型
 * 双向可赋值 —— schema 一旦漂移，`tsc` 立刻报错。
 */
import { z } from 'zod';

import type {
  GroupBuyCategory,
  GroupBuyDetail,
  GroupBuyInitiator,
  GroupBuyItem,
  GroupBuyParticipant,
  GroupBuyStatus,
} from '@/domain/models/groupbuy';

/** 类型级断言：From 必须可赋值给 To（不产生运行时代码） */
type AssertAssignable<From extends To, To> = true;

export const groupBuyStatusSchema = z.enum([
  'recruiting',
  'locked',
  'completed',
  'cancelled',
]);

export const groupBuyCategorySchema = z.enum([
  'food',
  'drink',
  'daily',
  'stationery',
  'digital',
  'other',
]);

export const groupBuyInitiatorSchema = z.object({
  id: z.string().min(1),
  nickname: z.string().min(1),
});

export const groupBuyItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  merchant: z.string().min(1),
  category: groupBuyCategorySchema,
  status: groupBuyStatusSchema,
  targetCount: z.int().positive(),
  joinedCount: z.int().nonnegative(),
  priceFen: z.int().nonnegative(),
  originalPriceFen: z.int().nonnegative(),
  initiator: groupBuyInitiatorSchema,
  pickupSpot: z.string().min(1),
  deadlineAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  note: z.string().optional(),
});

export const groupBuyParticipantSchema = z.object({
  id: z.string().min(1),
  nickname: z.string().min(1),
  quantity: z.int().positive(),
  paidFen: z.int().nonnegative(),
  joinedAt: z.iso.datetime(),
  anonymous: z.boolean(),
});

export const groupBuyDetailSchema = groupBuyItemSchema.extend({
  participants: z.array(groupBuyParticipantSchema),
  rules: z.array(z.string()),
});

export const groupBuyPageSchema = z.object({
  items: z.array(groupBuyItemSchema),
  nextCursor: z.string().nullable(),
  total: z.int().nonnegative().optional(),
});

/* ---- 编译期一致性断言（schema ↔ domain） ---- */
export type __StatusMatches = AssertAssignable<z.infer<typeof groupBuyStatusSchema>, GroupBuyStatus>;
export type __CategoryMatches = AssertAssignable<
  z.infer<typeof groupBuyCategorySchema>,
  GroupBuyCategory
>;
export type __InitiatorMatches = AssertAssignable<
  z.infer<typeof groupBuyInitiatorSchema>,
  GroupBuyInitiator
>;
export type __ItemSchemaIsDomain = AssertAssignable<
  z.infer<typeof groupBuyItemSchema>,
  GroupBuyItem
>;
export type __ItemDomainIsSchema = AssertAssignable<
  GroupBuyItem,
  z.infer<typeof groupBuyItemSchema>
>;
export type __ParticipantMatches = AssertAssignable<
  z.infer<typeof groupBuyParticipantSchema>,
  GroupBuyParticipant
>;
export type __DetailMatches = AssertAssignable<z.infer<typeof groupBuyDetailSchema>, GroupBuyDetail>;
export type __DetailDomainIsSchema = AssertAssignable<
  GroupBuyDetail,
  z.infer<typeof groupBuyDetailSchema>
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

export function safeParseGroupBuyItem(input: unknown): ParseOk<GroupBuyItem> | ParseFail {
  const result = groupBuyItemSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: formatZodIssues(result.error) };
}

export function safeParseGroupBuyDetail(input: unknown): ParseOk<GroupBuyDetail> | ParseFail {
  const result = groupBuyDetailSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: formatZodIssues(result.error) };
}

export function safeParseGroupBuyPage(
  input: unknown,
): ParseOk<{ items: GroupBuyItem[]; nextCursor: string | null; total?: number }> | ParseFail {
  const result = groupBuyPageSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: formatZodIssues(result.error) };
}
