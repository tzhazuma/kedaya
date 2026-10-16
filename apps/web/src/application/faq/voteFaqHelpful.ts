/**
 * 用例：「有用 / 无用」投票 —— **乐观更新 + 失败回滚**。
 *
 * 分工：
 * - domain `applyVote` 负责**计数**语义（幂等 / 改票 / 撤回），与后端必须一致；
 * - 本文件负责**视图模型**层的乐观更新与回滚（纯函数，可单测）；
 * - 组件只调用 `applyOptimisticVote` / `rollbackVote` 与 mutation，不自己算数字。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import { applyVote, helpfulPercent, type FaqArticle, type FaqVote } from '@/domain/models/faq';
import type { FaqRepository } from '@/domain/ports/faq';

import type { FaqArticleVM } from './listFaqArticles';

/** 单条目的乐观更新：改计数 + 改我的一票 + 重算派生文案 */
export function applyVoteToArticleVM(article: FaqArticleVM, next: FaqVote | null): FaqArticleVM {
  const counts = applyVote(article, article.vote, next);
  const percent = helpfulPercent(counts);
  return {
    ...article,
    helpfulCount: counts.helpfulCount,
    unhelpfulCount: counts.unhelpfulCount,
    helpfulPercent: percent,
    helpfulLabel: `有用 ${counts.helpfulCount} · 无用 ${counts.unhelpfulCount}（${percent}% 认为有用）`,
    vote: next,
  };
}

/** 一页列表的乐观更新（不可变） */
export function applyVoteToItems(
  items: readonly FaqArticleVM[],
  slug: string,
  next: FaqVote | null,
): FaqArticleVM[] {
  return items.map((item) => (item.slug === slug ? applyVoteToArticleVM(item, next) : item));
}

/**
 * TanStack Query 的分页数据形状（只依赖结构，不 import 框架类型 —— application 保持零框架）。
 */
export interface PagedData<TPage> {
  pages: TPage[];
  pageParams: unknown[];
}

export interface FaqPageLike {
  items: FaqArticleVM[];
}

/** 对 InfiniteQuery 的缓存做乐观更新（返回新对象，原对象不动） */
export function applyVoteToPages<T extends FaqPageLike>(
  data: PagedData<T> | undefined,
  slug: string,
  next: FaqVote | null,
): PagedData<T> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: applyVoteToItems(page.items, slug, next),
    })),
  };
}

/**
 * 回滚：把 `onMutate` 保存的快照写回缓存。
 * 单独抽成函数是为了让"失败回滚"这条路径也能被单测覆盖。
 */
export function rollbackVote<T>(
  snapshot: T | undefined,
  setData: (value: T | undefined) => void,
): boolean {
  if (snapshot === undefined) return false;
  setData(snapshot);
  return true;
}

export interface VoteFaqHelpfulOptions {
  /** 未登录传 null（知识库允许匿名浏览与投票） */
  userId?: string | null;
  idempotencyKey?: string;
}

/** 提交一票（成功后返回服务端的最新条目，用于最终对齐计数） */
export async function voteFaqHelpful(
  repository: FaqRepository,
  slug: string,
  vote: FaqVote | null,
  options: VoteFaqHelpfulOptions = {},
): Promise<Result<FaqArticle, ApiError>> {
  if (!slug.trim()) return err({ code: 'VALIDATION_FAILED', message: '缺少条目 slug' });
  const result = await repository.voteHelpful({
    slug,
    vote,
    userId: options.userId ?? null,
  });
  if (!result.ok) return err(result.error);
  return ok(result.value);
}

/** 投票失败的提示文案（回滚后展示，让用户知道"你的票没有生效"） */
export function voteRollbackMessage(error: ApiError): string {
  return `「有用」没有记录成功，已恢复到投票前的状态：${error.message}`;
}
