/**
 * 常见问题 mock 适配器（契约 §7 硬规则 4）。
 *
 * 行为对齐真实后端的**契约形状**：`Result<Page<...>, ApiError>` + 冻结错误码。
 * 所有出站数据都过一遍 zod schema。
 *
 * 投票语义（与 domain `applyVote` 完全一致，便于乐观更新对齐）：
 * - 每个 (userId, slug) 记录**一票**；重复点同一按钮是幂等的
 * - 改票（helpful ↔ unhelpful）会让旧侧 -1、新侧 +1
 * - `vote: null` 表示撤回
 */
import type { ApiError, ApiErrorCode, Page } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import {
  applyVote,
  searchArticles,
  validateTicketContact,
  validateTicketDraft,
  type FaqArticle,
  type FaqTicket,
  type FaqVote,
} from '@/domain/models/faq';
import type {
  FaqArticleListQuery,
  FaqRepository,
  FaqTicketListQuery,
  MockFailureMode,
  SubmitFaqTicketInput,
  VoteFaqHelpfulInput,
} from '@/domain/ports/faq';

import {
  safeParseFaqArticle,
  safeParseFaqArticlePage,
  safeParseFaqTicket,
  safeParseFaqTicketPage,
} from '../schemas/faq';
import { slicePage } from './cursor';
import { createFaqArticleSeed, createFaqTicketSeed } from './fixtures/faq';

export interface MockFaqOptions {
  /** 注入时钟（测试用固定时间） */
  now?: () => Date;
  /** 模拟网络延迟，用于演示骨架屏 */
  latencyMs?: number;
  /** 故障演练：'error' 时所有请求返回 UPSTREAM_UNAVAILABLE */
  failureMode?: MockFailureMode;
  /** 覆盖数据集 */
  articles?: readonly FaqArticle[];
  tickets?: readonly FaqTicket[];
  /** 默认页大小 */
  pageSize?: number;
  /** 当前登录用户（未登录传 null；工单允许匿名提交） */
  currentUserId?: string | null;
}

export interface MockFaqRepository extends FaqRepository {
  setFailureMode(mode: MockFailureMode): void;
  getFailureMode(): MockFailureMode;
  /** 恢复到初始数据集 */
  reset(): void;
  /** 当前用户对某条目的投票（用于验证幂等 / 改票） */
  myVote(slug: string): FaqVote | null;
}

function apiError(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return details === undefined ? { code, message } : { code, message, details };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** 条目过滤（纯函数，可单测）：默认只出 PUBLISHED */
export function filterFaqArticles(
  articles: readonly FaqArticle[],
  query: FaqArticleListQuery,
): FaqArticle[] {
  return searchArticles(articles, query.keyword ?? '', {
    status: query.status ?? 'PUBLISHED',
    ...(query.category ? { category: query.category } : {}),
  });
}

export function createMockFaqRepository(options: MockFaqOptions = {}): MockFaqRepository {
  const now = options.now ?? (() => new Date());
  const latencyMs = options.latencyMs ?? 200;
  const pageSize = options.pageSize ?? 20;
  const currentUserId = options.currentUserId === undefined ? 'u_1024' : options.currentUserId;
  let failureMode: MockFailureMode = options.failureMode ?? 'none';

  const initialArticles = (): FaqArticle[] =>
    options.articles ? [...options.articles] : createFaqArticleSeed(now());
  const initialTickets = (): FaqTicket[] =>
    options.tickets ? [...options.tickets] : createFaqTicketSeed(now());

  let articles: FaqArticle[] = clone(initialArticles());
  let tickets: FaqTicket[] = clone(initialTickets());
  /** (userId|anon, slug) -> 我的一票 */
  let votes = new Map<string, FaqVote>();
  let ticketSeq = 9000;

  const voteKey = (slug: string): string => `${currentUserId ?? 'anon'}\u0000${slug}`;

  const delay = async (): Promise<void> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
  };

  const failIfNeeded = (): ApiError | null =>
    failureMode === 'error'
      ? apiError('UPSTREAM_UNAVAILABLE', '常见问题服务暂时不可用（mock 故障演练）')
      : null;

  return {
    async listArticles(query: FaqArticleListQuery): Promise<Result<Page<FaqArticle>, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const filtered = filterFaqArticles(articles, query);
      const page = slicePage(filtered, query.cursor, query.limit, pageSize);
      const parsed = safeParseFaqArticlePage(page);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 条目列表不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(clone(parsed.value));
    },

    async voteHelpful(input: VoteFaqHelpfulInput): Promise<Result<FaqArticle, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const index = articles.findIndex((a) => a.slug === input.slug);
      const current = index >= 0 ? articles[index] : undefined;
      if (!current) return err(apiError('NOT_FOUND', `条目不存在：${input.slug}`));
      if (current.status !== 'PUBLISHED') {
        return err(apiError('CONFLICT', '该条目已归档，不能再投票'));
      }

      const key = voteKey(input.slug);
      const previous = votes.get(key) ?? null;
      const counts = applyVote(
        { helpfulCount: current.helpfulCount, unhelpfulCount: current.unhelpfulCount },
        previous,
        input.vote,
      );

      const next: FaqArticle = {
        ...current,
        helpfulCount: counts.helpfulCount,
        unhelpfulCount: counts.unhelpfulCount,
      };

      if (input.vote === null) votes.delete(key);
      else votes.set(key, input.vote);

      articles = articles.map((a, i) => (i === index ? next : a));

      const parsed = safeParseFaqArticle(next);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 投票产生了非法数据', { issues: parsed.issues }));
      }
      return ok(clone(parsed.value));
    },

    async listTickets(query: FaqTicketListQuery): Promise<Result<Page<FaqTicket>, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const mine = tickets
        .filter((t) => (currentUserId === null ? t.userId === null : t.userId === currentUserId))
        .filter((t) => (query.status ? t.status === query.status : true))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      const page = slicePage(mine, query.cursor, query.limit, pageSize);
      const parsed = safeParseFaqTicketPage(page);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 工单列表不符合冻结契约', { issues: parsed.issues }));
      }
      return ok(clone(parsed.value));
    },

    async submitTicket(input: SubmitFaqTicketInput): Promise<Result<FaqTicket, ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const problems = validateTicketDraft({ contact: input.contact, question: input.question });
      if (problems.length > 0) {
        return err(apiError('VALIDATION_FAILED', problems[0] ?? '工单内容不合法', { problems }));
      }

      const contact = validateTicketContact(input.contact).contact;
      const at = now().toISOString();
      ticketSeq += 1;
      const ticket: FaqTicket = {
        id: `ft-${ticketSeq}`,
        userId: input.userId,
        contact,
        question: input.question.trim(),
        status: 'OPEN',
        createdAt: at,
        updatedAt: at,
      };

      tickets = [ticket, ...tickets];

      const parsed = safeParseFaqTicket(ticket);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 工单产生了非法数据', { issues: parsed.issues }));
      }
      return ok(clone(parsed.value));
    },

    setFailureMode(mode: MockFailureMode): void {
      failureMode = mode;
    },

    getFailureMode(): MockFailureMode {
      return failureMode;
    },

    reset(): void {
      articles = clone(initialArticles());
      tickets = clone(initialTickets());
      votes = new Map();
      ticketSeq = 9000;
      failureMode = 'none';
    },

    myVote(slug: string): FaqVote | null {
      return votes.get(voteKey(slug)) ?? null;
    },
  };
}
