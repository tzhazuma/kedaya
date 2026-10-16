/**
 * 常见问题 · faq —— 领域层（契约 §4；02-domain-model §2.8）
 *
 * ⚠️ 本文件**手写**，不在 `scripts/scaffold.mjs` 的 SPEC 表里。
 * 原因：faq 除了条目 CRUD，还需要「幂等 helpful」「工单状态机」
 * 「关键词建议排序」三块领域逻辑，超出生成器能表达的形状。
 *
 * 本层零框架依赖（不 import Prisma / Nest）。
 */
import type { Page } from '@kedaya/contracts';
import { isChinaMobile } from '@kedaya/shared';
import type { ListParams, ResourceRepository } from '../../../common/crud/resource';
import { ValidationError } from '../../../common/errors/app-error';

export const FAQ_MODULE_ID = 'faq';

/* ================================================================== *
 * 1. 工单状态机（02-domain-model §2.8）
 *
 *   OPEN → ANSWERED（管理员回复）
 *   ANSWERED → CLOSED（提问者确认）
 *   ANSWERED → OPEN（追问）
 * ================================================================== */

export const FAQ_TICKET_STATUSES = ['OPEN', 'ANSWERED', 'CLOSED'] as const;
export type FaqTicketStatus = (typeof FAQ_TICKET_STATUSES)[number];

export function isFaqTicketStatus(value: unknown): value is FaqTicketStatus {
  return typeof value === 'string' && (FAQ_TICKET_STATUSES as readonly string[]).includes(value);
}

export const FAQ_TICKET_TRANSITIONS: ReadonlyArray<readonly [FaqTicketStatus, FaqTicketStatus]> = [
  ['OPEN', 'ANSWERED'],
  ['ANSWERED', 'CLOSED'],
  ['ANSWERED', 'OPEN'],
];

export function canTransitionFaqTicket(from: FaqTicketStatus, to: FaqTicketStatus): boolean {
  if (from === to) return true;
  return FAQ_TICKET_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

/* ================================================================== *
 * 2. 联系方式约束（02-domain-model §2.8：邮箱或微信，**不存明文手机号**）
 * ================================================================== */

/** 文本里出现大陆手机号（11 位）即拒收 —— 比 isChinaMobile 更严，覆盖"微信 138…"这种混写 */
const CHINA_MOBILE_IN_TEXT = /1[3-9]\d{9}/;

export function normalizeContact(raw: string | null | undefined): string {
  const contact = (raw ?? '').trim();
  if (!contact) throw new ValidationError('contact 必填（邮箱或微信号）', { field: 'contact' });
  if (contact.length > 120) throw new ValidationError('contact 过长（≤120 字）', { field: 'contact' });
  if (isChinaMobile(contact) || CHINA_MOBILE_IN_TEXT.test(contact)) {
    throw new ValidationError('请勿提交明文手机号，请留邮箱或微信号（数据最小化，契约 §9）', {
      field: 'contact',
    });
  }
  return contact;
}

/* ================================================================== *
 * 3. 关键词建议（**简单关键词匹配**，不引入向量库 —— 任务书明确要求）
 * ================================================================== */

export interface FaqSuggestionSource {
  id: string;
  question: string;
  answer: string;
  category: string;
  tags: string[];
}

export interface FaqSuggestion<T> {
  entry: T;
  score: number;
  matchedTerms: string[];
}

/**
 * 抽取检索词：
 *   · 拉丁字母/数字连续段（长度 ≥2）整体作为一个词；
 *   · 中文按**二元组**切（"校园卡充值" → 校园/园卡/卡充/充值），
 *     这样"校园卡怎么充值"能命中"校园卡如何充值"，而不用分词词典。
 */
export function extractSearchTerms(query: string): string[] {
  const text = (query ?? '').toLowerCase();
  const terms: string[] = [];

  for (const run of text.match(/[a-z0-9]+/g) ?? []) {
    if (run.length >= 2) terms.push(run);
  }

  const cjkRuns = text.match(/[\u3400-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      terms.push(run);
      continue;
    }
    for (let i = 0; i < run.length - 1; i += 1) terms.push(run.slice(i, i + 2));
  }

  return [...new Set(terms)];
}

/**
 * 关键词打分排序（纯函数，可单测）。
 *
 * 权重：标签精确命中 4 > 标签包含 2、问题命中 3、分类命中 1、答案命中 1。
 * 返回 score>0 的前 `limit` 条；同分按问题长度升序、id 升序，保证结果稳定。
 */
export function rankFaqSuggestions<T extends FaqSuggestionSource>(
  query: string,
  entries: readonly T[],
  limit = 3,
): Array<FaqSuggestion<T>> {
  const terms = extractSearchTerms(query);
  if (terms.length === 0 || entries.length === 0) return [];

  const scored = entries.map((entry) => {
    const question = entry.question.toLowerCase();
    const category = entry.category.toLowerCase();
    const answer = entry.answer.toLowerCase();
    const tags = entry.tags.map((tag) => tag.toLowerCase());

    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of terms) {
      let hit = 0;
      if (tags.includes(term)) hit += 4;
      else if (tags.some((tag) => tag.includes(term))) hit += 2;
      if (question.includes(term)) hit += 3;
      if (category.includes(term)) hit += 1;
      if (answer.includes(term)) hit += 1;
      if (hit > 0) {
        score += hit;
        matchedTerms.push(term);
      }
    }

    return { entry, score, matchedTerms };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.entry.question.length !== b.entry.question.length) {
        return a.entry.question.length - b.entry.question.length;
      }
      return a.entry.id.localeCompare(b.entry.id);
    })
    .slice(0, limit);
}

/** 该条目是否命中检索词（与 SQL 侧 contains 过滤保持同一套词） */
export function matchesSearchTerm(entry: FaqSuggestionSource, query: string): boolean {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) return true;
  const haystack = `${entry.question}\n${entry.answer}\n${entry.category}\n${entry.tags.join(' ')}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

/* ================================================================== *
 * 4. 领域模型
 * ================================================================== */

export interface FaqEntryModel {
  id: string;
  slug: string;
  question: string;
  answer: string;
  category: string;
  tags: string[];
  status: string;
  helpfulCount: number;
  unhelpfulCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FaqTicketModel {
  id: string;
  userId: string | null;
  contact: string;
  question: string;
  status: string;
  answer: string | null;
  answeredAt: Date | null;
  closedAt: Date | null;
  suggestedEntryIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

/* ================================================================== *
 * 5. 输入 / 过滤条件
 * ================================================================== */

export interface CreateFaqEntryInput {
  /** 省略时由用例层用 `slugify(question)` 生成（中文问题退化为 ULID） */
  slug?: string;
  question: string;
  answer: string;
  category: string;
  tags?: string[];
  status?: FaqEntryStatus;
}

export interface UpdateFaqEntryInput {
  question?: string;
  answer?: string;
  category?: string;
  tags?: string[];
  status?: FaqEntryStatus;
}

export interface FaqEntryListFilter extends ListParams {
  category?: string;
  /** wire 契约：`keyword`（`q` 只是控制器侧的兼容别名） */
  keyword?: string;
}

/* ---------------- 条目状态（02-domain-model §2.8） ---------------- */

export const FAQ_ENTRY_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type FaqEntryStatus = (typeof FAQ_ENTRY_STATUSES)[number];

export function isFaqEntryStatus(value: unknown): value is FaqEntryStatus {
  return typeof value === 'string' && (FAQ_ENTRY_STATUSES as readonly string[]).includes(value);
}

/** 大小写不敏感解析（对外 canonical 是大写） */
export function normalizeFaqEntryStatus(value: unknown): FaqEntryStatus | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  return isFaqEntryStatus(upper) ? upper : null;
}

/* ---------------- 投票（有用 / 无用） ---------------- */

export const FAQ_VOTE_VALUES = ['helpful', 'unhelpful'] as const;
export type FaqVoteValue = (typeof FAQ_VOTE_VALUES)[number];

export function normalizeVote(value: unknown): FaqVoteValue | null {
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  return (FAQ_VOTE_VALUES as readonly string[]).includes(lower) ? (lower as FaqVoteValue) : null;
}

export interface CreateFaqTicketInput {
  userId: string | null;
  contact: string;
  question: string;
  suggestedEntryIds: string[];
}

export interface UpdateFaqTicketInput {
  status?: FaqTicketStatus;
  answer?: string | null;
  answeredAt?: Date | null;
  closedAt?: Date | null;
}

export interface SubmitFaqTicketCommand {
  contact: string;
  question: string;
}

export interface PatchFaqTicketCommand {
  status?: string | null;
  answer?: string | null;
}

/**
 * 投票结果。
 *   counted=false —— 同一人重复投**同一票**：幂等命中，计数不变
 *   changed=true  —— 同一人**改票**（helpful ⇄ unhelpful）：两边计数同步调整
 */
export interface CastVoteResult {
  entry: FaqEntryModel;
  counted: boolean;
  changed: boolean;
}

/* ================================================================== *
 * 6. 端口
 * ================================================================== */

export interface FaqEntryRepository
  extends ResourceRepository<FaqEntryModel, CreateFaqEntryInput, UpdateFaqEntryInput> {
  /** 分类过滤 + 关键词搜索（游标分页） */
  searchEntries(filter: FaqEntryListFilter): Promise<Page<FaqEntryModel>>;
  findManyByIds(ids: string[]): Promise<FaqEntryModel[]>;
  /** 按 id **或** slug 解析条目（客户端用 slug，路由里也接受 id） */
  findEntryByIdOrSlug(value: string): Promise<FaqEntryModel | null>;
  /**
   * 幂等投票：同一 `voterKey` 对同一条目只有一票。
   * 幂等性由 `FaqHelpfulVote` 的 `@@unique([entryId, voterKey])` 保证；
   * 重复投同一票不改计数，改票则两边计数同步调整。
   */
  castVote(entryId: string, voterKey: string, vote: FaqVoteValue): Promise<CastVoteResult>;
}

export interface FaqTicketRepository {
  createTicket(input: CreateFaqTicketInput): Promise<FaqTicketModel>;
  findTicketById(id: string): Promise<FaqTicketModel | null>;
  listTickets(filter: { userId?: string } & ListParams): Promise<Page<FaqTicketModel>>;
  updateTicket(id: string, input: UpdateFaqTicketInput): Promise<FaqTicketModel>;
}

export const FAQ_ENTRY_REPOSITORY = Symbol('KEDAYA_FAQ_ENTRY_REPOSITORY');
export const FAQ_TICKET_REPOSITORY = Symbol('KEDAYA_FAQ_TICKET_REPOSITORY');

/** 投票人键：当前实现要求登录（匿名投票需要契约先给出设备级身份，见交付说明） */
export function voterKeyFor(userId: string): string {
  return `user:${userId}`;
}
