/**
 * 用例：加载 FAQ 条目（分类导航 + 搜索 + 手风琴列表）。
 */
import type { ApiError, Page } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  categoryLabel,
  FAQ_ALL_CATEGORY_ID,
  FAQ_ARTICLE_STATUS_LABELS,
  FAQ_CATEGORIES,
  countByCategory,
  helpfulPercent,
  searchArticles,
  type FaqArticle,
} from '@/domain/models/faq';
import type { FaqArticleListQuery, FaqRepository } from '@/domain/ports/faq';

import { deriveViewState, type ViewState } from '../viewState';
import {
  parseMarkdownParagraphs,
  stripInlineMarkdown,
  type InlineSegment,
} from './markdownSubset';

export interface FaqCategoryVM {
  id: string;
  label: string;
  description: string;
  count: number;
  countLabel: string;
  active: boolean;
}

export interface FaqArticleVM {
  id: string;
  slug: string;
  question: string;
  /** Markdown 子集原文；手风琴展开后渲染 */
  answer: string;
  /** 供"摘要行"使用：按空行切段（纯文本，已去掉行内标记） */
  answerParagraphs: string[];
  /** 每段的 Markdown 子集行内片段（加粗 / 行内代码），UI 直接映射成 React 元素 */
  answerSegments: InlineSegment[][];
  category: string;
  categoryLabel: string;
  statusLabel: string;
  helpfulCount: number;
  unhelpfulCount: number;
  helpfulPercent: number;
  helpfulLabel: string;
  updatedLabel: string;
  /** 我当前的一票（乐观更新用；由页面从本地状态合并） */
  vote: 'helpful' | 'unhelpful' | null;
}

export interface FaqBrowserVM {
  items: FaqArticleVM[];
  categories: FaqCategoryVM[];
  nextCursor: string | null;
  total: number;
  activeCategory: string;
  keyword: string;
  isEmpty: boolean;
  /** 搜索无结果时的引导文案（空态必须有引导，不能只写"暂无数据"） */
  emptyHint: string;
  state: ViewState;
}

export function toFaqArticleVM(
  article: FaqArticle,
  now: Date,
  vote: 'helpful' | 'unhelpful' | null = null,
): FaqArticleVM {
  const percent = helpfulPercent(article);
  return {
    id: article.id,
    slug: article.slug,
    question: article.question,
    answer: article.answer,
    answerParagraphs: article.answer
      .split(/\n{2,}/)
      .map((p) => stripInlineMarkdown(p.trim()))
      .filter(Boolean),
    answerSegments: parseMarkdownParagraphs(article.answer),
    category: article.category,
    categoryLabel: categoryLabel(article.category),
    statusLabel: FAQ_ARTICLE_STATUS_LABELS[article.status],
    helpfulCount: article.helpfulCount,
    unhelpfulCount: article.unhelpfulCount,
    helpfulPercent: percent,
    helpfulLabel: `有用 ${article.helpfulCount} · 无用 ${article.unhelpfulCount}（${percent}% 认为有用）`,
    updatedLabel: formatRelativeTime(article.updatedAt, now) || '时间未知',
    vote,
  };
}

export function toFaqCategoryVMs(
  articles: readonly FaqArticle[],
  activeCategory: string,
): FaqCategoryVM[] {
  const counts = countByCategory(articles);
  const total = articles.length;
  const all: FaqCategoryVM = {
    id: FAQ_ALL_CATEGORY_ID,
    label: '全部',
    description: '全部已发布条目',
    count: total,
    countLabel: `${total} 条`,
    active: activeCategory === FAQ_ALL_CATEGORY_ID,
  };
  return [
    all,
    ...FAQ_CATEGORIES.map((category) => {
      const count = counts[category.id] ?? 0;
      return {
        id: category.id,
        label: category.label,
        description: category.description,
        count,
        countLabel: `${count} 条`,
        active: activeCategory === category.id,
      };
    }),
  ];
}

export interface FaqBrowserOptions {
  activeCategory?: string;
  keyword?: string;
  now: Date;
  /** 用于分类计数与"全部"计数的完整集合（未分页） */
  allArticles?: readonly FaqArticle[];
  votes?: Readonly<Record<string, 'helpful' | 'unhelpful'>>;
  state?: ViewState;
}

export function emptyHintFor(options: { keyword: string; activeCategory: string }): string {
  if (options.keyword.trim()) {
    return `没有匹配「${options.keyword.trim()}」的条目。试试更短的关键词，或直接提交工单让值班同学人工回答。`;
  }
  if (options.activeCategory !== FAQ_ALL_CATEGORY_ID) {
    return `「${categoryLabel(options.activeCategory)}」分类下暂时没有已发布条目。可以切回「全部」，或提交工单。`;
  }
  return '知识库暂时没有已发布条目。可以直接提交工单，值班同学会在 48 小时内回复。';
}

export function toFaqBrowserVM(
  page: Page<FaqArticle>,
  options: FaqBrowserOptions,
): FaqBrowserVM {
  const activeCategory = options.activeCategory ?? FAQ_ALL_CATEGORY_ID;
  const keyword = options.keyword ?? '';
  const votes = options.votes ?? {};
  const items = searchArticles(page.items, '', { status: undefined }).map((article) =>
    toFaqArticleVM(article, options.now, votes[article.slug] ?? null),
  );
  return {
    items,
    categories: toFaqCategoryVMs(options.allArticles ?? page.items, activeCategory),
    nextCursor: page.nextCursor,
    total: page.total ?? page.items.length,
    activeCategory,
    keyword,
    isEmpty: items.length === 0,
    emptyHint: emptyHintFor({ keyword, activeCategory }),
    state:
      options.state ??
      deriveViewState({ isPending: false, isError: false, isEmpty: items.length === 0 }),
  };
}

export interface LoadFaqArticlesOptions {
  query?: FaqArticleListQuery;
  now?: Date;
  /** 页面已知的本地投票状态（乐观更新后立刻生效） */
  votes?: Readonly<Record<string, 'helpful' | 'unhelpful'>>;
}

/** 用例入口：条目列表 + 分类导航（分类计数取"当前筛选条件下的全集"） */
export async function loadFaqArticles(
  repository: FaqRepository,
  options: LoadFaqArticlesOptions = {},
): Promise<Result<FaqBrowserVM, ApiError>> {
  const query = options.query ?? {};
  const now = options.now ?? new Date();

  const result = await repository.listArticles(query);
  if (!result.ok) return err(result.error);

  // 分类计数需要"不受关键词影响"的全集：再取一次不带关键词的首页（mock/http 都支持）
  const counts = await repository.listArticles({
    category: query.category,
    status: query.status,
    limit: 100,
  });

  return ok(
    toFaqBrowserVM(result.value, {
      activeCategory: query.category ?? FAQ_ALL_CATEGORY_ID,
      keyword: query.keyword ?? '',
      now,
      allArticles: counts.ok ? counts.value.items : result.value.items,
      votes: options.votes ?? {},
    }),
  );
}

/** 供页面在错误/空态之间复用 */
export function faqListState(input: {
  isPending: boolean;
  isError: boolean;
  itemCount: number;
}): ViewState {
  return deriveViewState({
    isPending: input.isPending,
    isError: input.isError,
    isEmpty: input.itemCount === 0,
  });
}
