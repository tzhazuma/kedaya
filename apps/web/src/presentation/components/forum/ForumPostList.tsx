'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { loadForumPostList, forumListState, type ForumPostListVM } from '@/application/forum/listForumPosts';
import { DEMO_FORUM_SESSION } from '@/application/forum/session';
import { getMockForumRepository, getRepositories } from '@/data/repositories';

import { queryKeys } from '../../query/keys';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyButton } from '../KdyButton';
import { KdyEmpty } from '../KdyEmpty';
import { KdyCardSkeleton } from '../KdySkeleton';
import { ForumBoardNav } from './ForumBoardNav';
import { ForumPostCard } from './ForumPostCard';

/** 每页条数（故意取小值，便于演示游标分页） */
const PAGE_SIZE = 4;

/**
 * 论坛主题列表 —— forum 切片的入口。
 *
 * 数据流：`ForumPostList`（presentation）→ `loadForumPostList`（application）
 *         → `ForumRepository`（domain port）← mock/http adapter（data）
 *
 * 三态齐全：loading（骨架） / error（可重试） / empty（带引导文案）+ success。
 * 治理：被隐藏 / 被锁定的主题**留在列表里**并展示明确状态（域模型 §2.4）。
 */
export function ForumPostList() {
  const [boardId, setBoardId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [forcingError, setForcingError] = useState(false);

  const repository = getRepositories().forum;
  const mockRepository = getMockForumRepository();

  const query = useInfiniteQuery({
    queryKey: queryKeys.forum.list({
      boardId: boardId ?? 'all',
      keyword,
      includeGoverned: true,
    }),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrapOrThrow(
        await loadForumPostList(
          repository,
          {
            cursor: pageParam,
            limit: PAGE_SIZE,
            includeGoverned: true,
            ...(boardId ? { boardId } : {}),
            ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          },
          { session: DEMO_FORUM_SESSION },
        ),
      ),
    getNextPageParam: (last: ForumPostListVM) => last.nextCursor ?? undefined,
  });

  const pages = useMemo(() => query.data?.pages ?? [], [query.data]);
  const items = useMemo(() => pages.flatMap((page) => page.items), [pages]);
  const boards = pages[0]?.boards ?? [];
  const total = pages[0]?.total ?? 0;
  const governedCount = pages[0]?.governedCount ?? 0;

  const state = forumListState({
    isPending: query.isPending,
    isError: query.isError,
    itemCount: items.length,
  });

  const toggleForcedError = (): void => {
    if (!mockRepository) return;
    const next = !forcingError;
    mockRepository.setFailureMode(next ? 'error' : 'none');
    setForcingError(next);
    void query.refetch();
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="forum-list-heading">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="forum-list-heading" className="mr-auto text-sm font-semibold text-body">
            版块
          </h2>
          <KdyButton href="/forum/new" size="sm">
            <Plus className="size-3.5" aria-hidden />
            发帖
          </KdyButton>
        </div>

        <ForumBoardNav boards={boards} activeBoardId={boardId} onSelect={setBoardId} />

        <label className="flex items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2">
          <Search className="size-4 text-muted" aria-hidden />
          <span className="sr-only">搜索主题</span>
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索标题 / 正文 / 标签"
            className="w-full bg-transparent text-sm text-body outline-none placeholder:text-muted"
          />
        </label>

        <p className="text-xs text-muted" data-testid="forum-governance-summary">
          社区公约：举报达 3 个不同用户即自动隐藏并进人工队列；被隐藏的主题会「保留在列表里并标注状态」，
          不会静默消失。
          {governedCount > 0 ? `当前列表里有 ${governedCount} 条已被治理。` : ''}
        </p>

        {mockRepository ? (
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted">
              当前数据源：<strong className="font-medium">mock</strong>
              （内存数据，无后端可跑）。可切换故障模式验证错误态。
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

      {/* ---- loading 态 ---- */}
      {state === 'loading' ? (
        <div
          aria-busy
          aria-live="polite"
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          data-testid="forum-loading"
        >
          <KdyCardSkeleton />
          <KdyCardSkeleton />
        </div>
      ) : null}

      {/* ---- error 态 ---- */}
      {state === 'error' ? (
        <KdyAlert
          tone="danger"
          title="主题列表加载失败"
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
            契约 §8 要求失败静默降级而非白屏。
            {items.length > 0 ? '下方展示的是上一次成功获取的数据。' : ''}
          </p>
        </KdyAlert>
      ) : null}

      {/* ---- empty 态（带引导） ---- */}
      {state === 'empty' ? (
        <KdyEmpty
          title="没有匹配的主题"
          description={
            keyword.trim()
              ? `没有找到包含「${keyword.trim()}」的主题。换个关键词，或者由你来发第一帖。`
              : '这个版块还没有主题。发一帖，把话题开起来。'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <KdyButton
                size="sm"
                variant="secondary"
                onClick={() => {
                  setKeyword('');
                  setBoardId(null);
                }}
              >
                清空筛选
              </KdyButton>
              <KdyButton size="sm" href="/forum/new">
                去发帖
              </KdyButton>
            </div>
          }
        />
      ) : null}

      {/* ---- success 态 ---- */}
      {items.length > 0 ? (
        <>
          <p className="text-xs text-muted" data-testid="forum-total">
            共 {total} 条 · 当前展示 {items.length} 条
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {items.map((item) => (
              <ForumPostCard key={item.id} item={item} />
            ))}
          </div>

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
