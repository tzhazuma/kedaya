'use client';

import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { ChevronDown, RefreshCw, Search, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { loadFaqArticles, type FaqArticleVM, type FaqBrowserVM } from '@/application/faq/listFaqArticles';
import {
  applyVoteToPages,
  rollbackVote,
  voteFaqHelpful,
  voteRollbackMessage,
} from '@/application/faq/voteFaqHelpful';
import { deriveViewState } from '@/application/viewState';
import { getMockFaqRepository, getRepositories } from '@/data/repositories';
import { FAQ_ALL_CATEGORY_ID, type FaqVote } from '@/domain/models/faq';

import { queryKeys } from '../../query/keys';
import { asApiError, errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdyEmpty } from '../KdyEmpty';
import { KdyCardSkeleton } from '../KdySkeleton';

/** 演示用户（真实身份层见契约 §5，尚未接入 —— README「未实现」已列出） */
const DEMO_FAQ_USER_ID = 'u_1024';
const PAGE_SIZE = 5;

interface VoteVariables {
  slug: string;
  vote: FaqVote | null;
}

/**
 * FAQ 浏览器：分类导航 + 搜索 + 手风琴条目 + 「有用」投票（乐观更新 + 失败回滚）。
 *
 * 乐观更新的关键点：
 * 1. `onMutate` 先算好本地新状态写进缓存，并**保存快照**；
 * 2. `onError` 用快照回滚，并明确告诉用户"你的一票没有生效"；
 * 3. `onSettled` 再和服务端对齐（成功时服务端计数才是真相）。
 */
export function FaqBrowser() {
  const repository = getRepositories().faq;
  const mockRepository = getMockFaqRepository();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<string>(FAQ_ALL_CATEGORY_ID);
  const [keyword, setKeyword] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [forcingError, setForcingError] = useState(false);
  const [rollbackNotice, setRollbackNotice] = useState<string | null>(null);

  /**
   * 「我的一票」本地账本（slug → 我投了什么）。
   * 用 ref 而不是 state：它是 queryFn 的**输入**，不进 queryKey（否则每次投票都会换 key）。
   */
  const myVotesRef = useRef<Record<string, FaqVote>>({});

  const filters = { category, keyword };
  const queryKey = queryKeys.faq.articles(filters);

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrapOrThrow(
        await loadFaqArticles(repository, {
          query: {
            cursor: pageParam,
            limit: PAGE_SIZE,
            category,
            ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          },
          // 「我的一票」由本地维护并注入：列表接口本身不返回"谁投过"，
          // 否则每次 onSettled 重新拉取后按钮会退回未投票态（用户会以为没生效）。
          votes: myVotesRef.current,
        }),
      ),
    getNextPageParam: (last: FaqBrowserVM) => last.nextCursor ?? undefined,
  });

  const pages = useMemo(() => query.data?.pages ?? [], [query.data]);
  const items = useMemo(() => pages.flatMap((page) => page.items), [pages]);
  const categories = pages[0]?.categories ?? [];
  const total = pages[0]?.total ?? 0;
  const emptyHint = pages[0]?.emptyHint ?? '';

  const state = deriveViewState({
    isPending: query.isPending,
    isError: query.isError,
    isEmpty: items.length === 0,
  });

  const voteMutation = useMutation({
    mutationFn: async ({ slug, vote }: VoteVariables) =>
      unwrapOrThrow(await voteFaqHelpful(repository, slug, vote, { userId: DEMO_FAQ_USER_ID })),
    onMutate: async ({ slug, vote }: VoteVariables) => {
      await queryClient.cancelQueries({ queryKey });
      const snapshot = queryClient.getQueryData<InfiniteData<FaqBrowserVM>>(queryKey);
      const previousVote = myVotesRef.current[slug] ?? null;
      if (vote === null) {
        const rest = { ...myVotesRef.current };
        delete rest[slug];
        myVotesRef.current = rest;
      } else {
        myVotesRef.current = { ...myVotesRef.current, [slug]: vote };
      }
      queryClient.setQueryData<InfiniteData<FaqBrowserVM>>(queryKey, (old) =>
        applyVoteToPages(old, slug, vote),
      );
      setRollbackNotice(null);
      return { snapshot, previousVote };
    },
    onError: (error, variables, context) => {
      rollbackVote(context?.snapshot, (value) =>
        queryClient.setQueryData<InfiniteData<FaqBrowserVM>>(queryKey, value),
      );
      // 本地「我的一票」也要回滚，否则重拉后按钮会显示一个并未生效的投票态
      const rest = { ...myVotesRef.current };
      if (context?.previousVote) rest[variables.slug] = context.previousVote;
      else delete rest[variables.slug];
      myVotesRef.current = rest;
      setRollbackNotice(voteRollbackMessage(asApiError(error)));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const castVote = (article: FaqArticleVM, vote: FaqVote): void => {
    const next = article.vote === vote ? null : vote;
    voteMutation.mutate({ slug: article.slug, vote: next });
  };

  const toggleForcedError = (): void => {
    if (!mockRepository) return;
    const next = !forcingError;
    mockRepository.setFailureMode(next ? 'error' : 'none');
    setForcingError(next);
    void query.refetch();
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="faq-browser-heading">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h2 id="faq-browser-heading" className="text-sm font-semibold text-body">
          按分类浏览
        </h2>

        <nav aria-label="FAQ 分类" className="flex flex-wrap items-center gap-2">
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.active}
              onClick={() => {
                setCategory(item.id);
                setExpanded(null);
              }}
              title={item.description}
              className={cn(
                'inline-flex items-center gap-1 rounded-pill border px-3 py-1 text-xs transition-colors',
                item.active
                  ? 'border-brand-soft bg-brand-soft text-brand-strong'
                  : 'border-border bg-surface text-body hover:bg-surface-alt',
              )}
            >
              {item.label}
              <span className="text-muted">· {item.countLabel}</span>
            </button>
          ))}
        </nav>

        <label className="flex items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2">
          <Search className="size-4 text-muted" aria-hidden />
          <span className="sr-only">搜索常见问题</span>
          <input
            type="search"
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
              setExpanded(null);
            }}
            placeholder="搜索问题关键词，例：绑定、匿名、手机号"
            className="w-full bg-transparent text-sm text-body outline-none placeholder:text-muted"
          />
        </label>

        {mockRepository ? (
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted">
              当前数据源：<strong className="font-medium">mock</strong>
              （内存数据，无后端可跑）。切换故障模式可验证「乐观更新失败回滚」。
            </p>
            <KdyButton
              size="sm"
              variant={forcingError ? 'danger' : 'secondary'}
              onClick={toggleForcedError}
            >
              {forcingError ? '恢复正常' : '演练故障'}
            </KdyButton>
          </div>
        ) : null}
      </div>

      {rollbackNotice ? (
        <KdyAlert tone="warning" title="投票未生效，已回滚" role="alert">
          <p data-testid="faq-vote-rollback">{rollbackNotice}</p>
        </KdyAlert>
      ) : null}

      {/* ---- loading 态 ---- */}
      {state === 'loading' ? (
        <div className="flex flex-col gap-3" aria-busy aria-live="polite" data-testid="faq-loading">
          <KdyCardSkeleton />
          <KdyCardSkeleton />
        </div>
      ) : null}

      {/* ---- error 态 ---- */}
      {state === 'error' ? (
        <KdyAlert
          tone="danger"
          title="知识库加载失败"
          role="alert"
          action={
            <KdyButton
              size="sm"
              variant="secondary"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} aria-hidden />
              重试
            </KdyButton>
          }
        >
          <p>{errorMessage(query.error)}</p>
          <p className="mt-1 text-xs">
            也可以直接到「我的工单」提交问题，值班同学会人工回复。
          </p>
        </KdyAlert>
      ) : null}

      {/* ---- empty 态（必须带引导） ---- */}
      {state === 'empty' ? (
        <KdyEmpty
          title="没有匹配的条目"
          description={emptyHint}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <KdyButton
                size="sm"
                variant="secondary"
                onClick={() => {
                  setKeyword('');
                  setCategory(FAQ_ALL_CATEGORY_ID);
                }}
              >
                清空筛选
              </KdyButton>
              <KdyButton size="sm" href="/faq/tickets">
                提交工单
              </KdyButton>
            </div>
          }
        />
      ) : null}

      {/* ---- success 态 ---- */}
      {items.length > 0 ? (
        <>
          <p className="text-xs text-muted" data-testid="faq-total">
            共 {total} 条 · 当前展示 {items.length} 条
          </p>
          <ul className="flex flex-col gap-2">
            {items.map((article) => {
              const open = expanded === article.slug;
              return (
                <li key={article.slug}>
                  <KdyCard className="flex flex-col gap-2">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : article.slug)}
                      className="flex w-full items-start justify-between gap-3 text-left"
                    >
                      <span className="flex flex-col gap-1">
                        <span className="text-md font-medium text-body">{article.question}</span>
                        <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <KdyBadge tone="neutral">{article.categoryLabel}</KdyBadge>
                          <span>{article.helpfulLabel}</span>
                          <span>更新于 {article.updatedLabel}</span>
                        </span>
                      </span>
                      <ChevronDown
                        className={cn('mt-1 size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')}
                        aria-hidden
                      />
                    </button>

                    {open ? (
                      <div className="flex flex-col gap-3 border-t border-border pt-3">
                        {article.answerSegments.map((segments, paragraphIndex) => (
                          <p
                            key={`${article.slug}-p-${paragraphIndex}`}
                            className="whitespace-pre-wrap text-sm text-body"
                          >
                            {segments.map((segment, segmentIndex) =>
                              segment.kind === 'bold' ? (
                                <strong key={segmentIndex} className="font-semibold">
                                  {segment.text}
                                </strong>
                              ) : segment.kind === 'code' ? (
                                <code key={segmentIndex} className="rounded-sm bg-surface-alt px-1 font-mono text-xs">
                                  {segment.text}
                                </code>
                              ) : (
                                <span key={segmentIndex}>{segment.text}</span>
                              ),
                            )}
                          </p>
                        ))}

                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted">这条对你有帮助吗？</span>
                          <KdyButton
                            size="sm"
                            variant={article.vote === 'helpful' ? 'primary' : 'secondary'}
                            aria-pressed={article.vote === 'helpful'}
                            disabled={voteMutation.isPending}
                            onClick={() => castVote(article, 'helpful')}
                          >
                            <ThumbsUp className="size-3.5" aria-hidden />
                            有用（{article.helpfulCount}）
                          </KdyButton>
                          <KdyButton
                            size="sm"
                            variant={article.vote === 'unhelpful' ? 'danger' : 'secondary'}
                            aria-pressed={article.vote === 'unhelpful'}
                            disabled={voteMutation.isPending}
                            onClick={() => castVote(article, 'unhelpful')}
                          >
                            <ThumbsDown className="size-3.5" aria-hidden />
                            没用（{article.unhelpfulCount}）
                          </KdyButton>
                          {article.vote ? (
                            <button
                              type="button"
                              className="text-xs text-muted underline"
                              onClick={() => voteMutation.mutate({ slug: article.slug, vote: null })}
                            >
                              撤回我的一票
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </KdyCard>
                </li>
              );
            })}
          </ul>

          {query.hasNextPage ? (
            <div className="flex justify-center">
              <KdyButton
                variant="secondary"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage ? '加载中…' : '加载更多（游标分页）'}
              </KdyButton>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
