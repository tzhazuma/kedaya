import { err, ok, type Result } from '@kedaya/shared'

import {
  FAQ_CATEGORY_ALL,
  faqCategories,
  hasVotedHelpful,
  summarizeArticle,
} from '../../domain/models/faq'
import type { FaqArticle, FaqArticleSummary } from '../../domain/models/faq'
import type { CachePort } from '../../domain/ports/cachePort'
import type { ClockPort } from '../../domain/ports/clockPort'
import type { RepositoryError } from '../../domain/ports/errors'
import type { FaqRepository, ListFaqArticlesQuery } from '../../domain/ports/faqRepository'
import type { SessionStorePort } from '../../domain/ports/sessionPort'
import { createIdempotencyKey } from '../idempotency'

/**
 * FAQ 浏览用例 —— 分类 + 搜索 + 「有用」投票。
 *
 * 契约 §8 启动时序同样适用：`hydrate()` 同步给出缓存的问答与**已投票记录**，
 * 页面立刻可渲染；`load()` 再后台刷新。
 *
 * 「有用」按钮的幂等有**两道**保险：
 * 1. 本地：已投过的文章直接返回 `applied: false`，连请求都不发；
 * 2. 服务端：mock 仓储同样按 `userId + articleId` 去重，真后端另有
 *    `Idempotency-Key` 兜底（契约 §11.3）。
 * 两者共用 domain 的 `applyHelpfulVote`，语义不会漂移。
 */

export type FaqBrowseStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'

export interface BrowseFaqState {
  status: FaqBrowseStatus
  articles: FaqArticleSummary[]
  /** 可筛选的分类清单（来自当前数据集，按首次出现顺序） */
  categories: string[]
  activeCategory: string
  keyword: string
  /** 已投过「有用」的文章 id（幂等的本地依据） */
  votedArticleIds: string[]
  nextCursor: string | null
  total: number | null
  error: string | null
  fromCache: boolean
  updatedAt: string | null
  loadingMore: boolean
}

export interface CachedFaqArticleList {
  articles: FaqArticle[]
  activeCategory: string
  keyword: string
  nextCursor: string | null
  total?: number
  updatedAt: string
}

export interface BrowseFaqDeps {
  repository: FaqRepository
  cache: CachePort
  clock: ClockPort
  cacheKey: string
  /** 已投票记录的缓存 key（与列表分开存，刷新列表不会丢投票状态） */
  votesCacheKey: string
  session: SessionStorePort
  defaultLimit?: number
}

export interface LoadFaqQuery {
  category?: string
  keyword?: string
  limit?: number
}

export interface VoteHelpfulOutcome {
  /** false = 重复点击，未产生任何变化 */
  applied: boolean
  helpfulCount: number
}

export interface BrowseFaqUseCase {
  getSnapshot(): BrowseFaqState
  subscribe(listener: () => void): () => void
  hydrate(): BrowseFaqState
  load(query?: LoadFaqQuery): Promise<BrowseFaqState>
  loadMore(): Promise<BrowseFaqState>
  /** 切换分类：只改筛选并清空列表，由调用方接着 `load()` */
  selectCategory(category: string): BrowseFaqState
  /** 「有用」按钮 —— 幂等，重复点只算一次 */
  voteHelpful(articleId: string): Promise<Result<VoteHelpfulOutcome, RepositoryError>>
  reset(): void
}

const INITIAL_STATE: BrowseFaqState = {
  status: 'idle',
  articles: [],
  categories: [],
  activeCategory: FAQ_CATEGORY_ALL,
  keyword: '',
  votedArticleIds: [],
  nextCursor: null,
  total: null,
  error: null,
  fromCache: false,
  updatedAt: null,
  loadingMore: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCachedFaqArticleList(value: unknown): value is CachedFaqArticleList {
  if (!isRecord(value)) return false
  return Array.isArray(value.articles) && typeof value.updatedAt === 'string'
}

/** 已投票记录的形状校验（本地缓存可能被旧版本写入） */
export function isVotedArticleIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function createBrowseFaqUseCase(deps: BrowseFaqDeps): BrowseFaqUseCase {
  const { repository, cache, clock, cacheKey, votesCacheKey, session, defaultLimit } = deps

  let state: BrowseFaqState = INITIAL_STATE
  let hydrated = false
  let rawArticles: FaqArticle[] = []
  const listeners = new Set<() => void>()

  function patch(next: Partial<BrowseFaqState>): BrowseFaqState {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
    return state
  }

  function toSummaries(articles: readonly FaqArticle[], voted: readonly string[]): FaqArticleSummary[] {
    return articles.map((article) => summarizeArticle(article, hasVotedHelpful(voted, article.id)))
  }

  function persistVotes(ids: readonly string[]): void {
    cache.write(votesCacheKey, [...ids])
  }

  function hydrate(): BrowseFaqState {
    if (hydrated) return state
    hydrated = true

    const cachedVotes = cache.read<unknown>(votesCacheKey)
    const votedArticleIds = isVotedArticleIds(cachedVotes) ? cachedVotes : []

    const cached = cache.read<unknown>(cacheKey)
    if (!isCachedFaqArticleList(cached)) {
      return patch({ votedArticleIds })
    }

    rawArticles = cached.articles
    const articles = toSummaries(cached.articles, votedArticleIds)
    return patch({
      status: articles.length === 0 ? 'empty' : 'ready',
      articles,
      categories: faqCategories(cached.articles),
      activeCategory: cached.activeCategory,
      keyword: cached.keyword,
      votedArticleIds,
      nextCursor: cached.nextCursor,
      total: cached.total ?? null,
      error: null,
      fromCache: true,
      updatedAt: cached.updatedAt,
    })
  }

  function writeCache(page: {
    articles: FaqArticle[]
    activeCategory: string
    keyword: string
    nextCursor: string | null
    total?: number
  }): string {
    const updatedAt = clock.now().toISOString()
    cache.write(cacheKey, { ...page, updatedAt } satisfies CachedFaqArticleList)
    return updatedAt
  }

  async function load(query: LoadFaqQuery = {}): Promise<BrowseFaqState> {
    const activeCategory = query.category === undefined ? state.activeCategory : query.category
    const keyword = query.keyword === undefined ? state.keyword : query.keyword

    const request: ListFaqArticlesQuery = {
      category: activeCategory,
      keyword,
      cursor: null,
      ...(query.limit === undefined && defaultLimit === undefined
        ? {}
        : { limit: query.limit ?? defaultLimit }),
    }

    patch({
      status: state.articles.length > 0 ? 'ready' : 'loading',
      error: null,
      activeCategory,
      keyword,
    })

    const result = await repository.listArticles(request)
    if (!result.ok) {
      return patch({
        status: state.articles.length > 0 ? 'ready' : 'error',
        error: result.error.message,
        fromCache: state.articles.length > 0,
      })
    }

    rawArticles = result.value.items
    const articles = toSummaries(result.value.items, state.votedArticleIds)
    const updatedAt = writeCache({
      articles: result.value.items,
      activeCategory,
      keyword,
      nextCursor: result.value.nextCursor,
      ...(result.value.total === undefined ? {} : { total: result.value.total }),
    })

    return patch({
      status: articles.length === 0 ? 'empty' : 'ready',
      articles,
      categories: faqCategories(result.value.items),
      nextCursor: result.value.nextCursor,
      total: result.value.total ?? null,
      error: null,
      fromCache: false,
      updatedAt,
    })
  }

  async function loadMore(): Promise<BrowseFaqState> {
    if (state.nextCursor === null || state.loadingMore) return state

    patch({ loadingMore: true, error: null })
    const result = await repository.listArticles({
      category: state.activeCategory,
      keyword: state.keyword,
      cursor: state.nextCursor,
      ...(defaultLimit === undefined ? {} : { limit: defaultLimit }),
    })

    if (!result.ok) {
      return patch({ loadingMore: false, error: result.error.message })
    }

    rawArticles = [...rawArticles, ...result.value.items]
    const appended = [...state.articles, ...toSummaries(result.value.items, state.votedArticleIds)]
    const updatedAt = writeCache({
      articles: rawArticles,
      activeCategory: state.activeCategory,
      keyword: state.keyword,
      nextCursor: result.value.nextCursor,
      ...(result.value.total === undefined ? {} : { total: result.value.total }),
    })

    return patch({
      status: appended.length === 0 ? 'empty' : 'ready',
      articles: appended,
      categories: faqCategories(rawArticles),
      nextCursor: result.value.nextCursor,
      total: result.value.total ?? state.total,
      error: null,
      fromCache: false,
      updatedAt,
      loadingMore: false,
    })
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hydrate,
    load,
    loadMore,

    selectCategory(category: string): BrowseFaqState {
      rawArticles = []
      return patch({
        activeCategory: category,
        articles: [],
        nextCursor: null,
        total: null,
        error: null,
        status: 'idle',
        fromCache: false,
      })
    },

    async voteHelpful(articleId: string): Promise<Result<VoteHelpfulOutcome, RepositoryError>> {
      const current = state.articles.find((article) => article.id === articleId)

      // 第 1 道保险：本地幂等 —— 已投过就连请求都不发
      if (hasVotedHelpful(state.votedArticleIds, articleId)) {
        return ok({ applied: false, helpfulCount: current?.helpfulCount ?? 0 })
      }

      const userId = session.getSnapshot().profile?.id ?? 'anonymous'
      const result = await repository.voteHelpful({
        articleId,
        userId,
        idempotencyKey: createIdempotencyKey(`faq:helpful:${userId}:${articleId}`, clock.now()),
      })
      if (!result.ok) return err(result.error)

      const votedArticleIds = [...state.votedArticleIds, articleId]
      persistVotes(votedArticleIds)

      // 计数以服务端返回为准（本地不做「+1 猜测」，避免与后端不一致）
      rawArticles = rawArticles.map((article) =>
        article.id === articleId ? { ...article, helpfulCount: result.value.helpfulCount } : article,
      )
      patch({
        votedArticleIds,
        articles: state.articles.map((article) =>
          article.id === articleId
            ? { ...article, voted: true, helpfulCount: result.value.helpfulCount }
            : article,
        ),
      })

      return ok({ applied: result.value.applied, helpfulCount: result.value.helpfulCount })
    },

    reset(): void {
      hydrated = false
      rawArticles = []
      state = INITIAL_STATE
      for (const listener of listeners) listener()
    },
  }
}
