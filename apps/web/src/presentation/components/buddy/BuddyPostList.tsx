'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Plus, RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  buddyListState,
  loadBuddyPostList,
  type BuddyPostListVM,
} from '@/application/buddy/listBuddyPosts';
import { DEMO_BUDDY_SESSION } from '@/application/buddy/session';
import { getMockBuddyRepository, getRepositories } from '@/data/repositories';

import { queryKeys } from '../../query/keys';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyButton } from '../KdyButton';
import { KdyEmpty } from '../KdyEmpty';
import { KdyCardSkeleton } from '../KdySkeleton';
import { BuddyPostCard } from './BuddyPostCard';
import { BuddyPrivacyNotice } from './BuddyPrivacyNotice';
import { BuddySectionNav } from './BuddySectionNav';

/** 每页条数（故意取小值，便于演示游标分页） */
const PAGE_SIZE = 4;

/**
 * 搭子广场 —— buddy 切片的入口。
 *
 * 数据流：`BuddyPostList`（presentation）→ `loadBuddyPostList`（application）
 *         → `BuddyRepository`（domain port）← mock/http adapter（data）
 *
 * 三态齐全：loading（骨架） / error（可重试，保留上一次数据） / empty（带引导文案）。
 * 游标分页：只把服务端给的 `nextCursor` 原样回传（契约 §11.10-E，客户端不解析游标）。
 */
export function BuddyPostList() {
  const [section, setSection] = useState<BuddyPostListVM['activeSection']>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);
  const [forcingError, setForcingError] = useState(false);

  const repository = getRepositories().buddy;
  const mockRepository = getMockBuddyRepository();

  const query = useInfiniteQuery({
    queryKey: queryKeys.buddy.list({
      section: section ?? 'all',
      tags,
      keyword,
      includeClosed,
    }),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrapOrThrow(
        await loadBuddyPostList(
          repository,
          {
            cursor: pageParam,
            limit: PAGE_SIZE,
            ...(section ? { section } : {}),
            ...(tags.length > 0 ? { tags } : {}),
            ...(includeClosed ? { includeClosed: true } : {}),
          },
          { viewerId: DEMO_BUDDY_SESSION.userId, authenticated: DEMO_BUDDY_SESSION.authenticated },
        ),
      ),
    getNextPageParam: (last: BuddyPostListVM) => last.nextCursor ?? undefined,
  });

  const pages = useMemo(() => query.data?.pages ?? [], [query.data]);
  const allItems = useMemo(() => pages.flatMap((page) => page.items), [pages]);
  // 关键词过滤在客户端做（mock 的列表端点没有 keyword 参数，规格 §5.3 也没有）
  const items = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.creatorLabel.toLowerCase().includes(q) ||
        item.locationLabel.toLowerCase().includes(q) ||
        item.tags.some((tag) => tag.label.toLowerCase().includes(q)),
    );
  }, [allItems, keyword]);

  const sections = pages[0]?.sections ?? [];
  const total = pages[0]?.total ?? 0;

  const state = buddyListState({
    isPending: query.isPending,
    isError: query.isError,
    itemCount: items.length,
  });

  const toggleTag = (key: string): void => {
    setTags((current) =>
      current.includes(key) ? current.filter((tag) => tag !== key) : [...current, key],
    );
  };

  const toggleForcedError = (): void => {
    if (!mockRepository) return;
    const next = !forcingError;
    mockRepository.setFailureMode(next ? 'error' : 'none');
    setForcingError(next);
    void query.refetch();
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="buddy-list-heading">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="buddy-list-heading" className="mr-auto text-sm font-semibold text-body">
            搭子广场
          </h2>
          <KdyButton href="/buddy/recommendations" size="sm" variant="secondary">
            看推荐
          </KdyButton>
          <KdyButton href="/buddy/profile" size="sm" variant="secondary">
            我的匹配资料
          </KdyButton>
          <KdyButton href="/buddy/new" size="sm">
            <Plus className="size-3.5" aria-hidden />
            发布搭子
          </KdyButton>
        </div>

        <BuddySectionNav
          sections={sections}
          activeSection={section}
          onSelectSection={setSection}
          activeTags={tags}
          onToggleTag={toggleTag}
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex flex-1 items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2">
            <Search className="size-4 text-muted" aria-hidden />
            <span className="sr-only">搜索活动</span>
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索标题 / 地点 / 标签 / 发起人"
              className="w-full bg-transparent text-sm text-body outline-none placeholder:text-muted"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(event) => setIncludeClosed(event.target.checked)}
            />
            包含已满 / 已关闭（默认只列招募中）
          </label>
        </div>

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

      {state === 'loading' ? (
        <div
          aria-busy
          aria-live="polite"
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          data-testid="buddy-loading"
        >
          <KdyCardSkeleton />
          <KdyCardSkeleton />
        </div>
      ) : null}

      {state === 'error' ? (
        <KdyAlert
          tone="danger"
          title="搭子列表加载失败"
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

      {state === 'empty' ? (
        <KdyEmpty
          title="这个筛选下还没有搭子"
          description={
            keyword.trim()
              ? `没有找到包含「${keyword.trim()}」的活动。换个关键词，或者由你来发第一条。`
              : '这个板块还没有人发活动。发一条，把搭子凑起来 —— 自习、吃饭、出行、运动都行。'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <KdyButton
                size="sm"
                variant="secondary"
                onClick={() => {
                  setKeyword('');
                  setSection(null);
                  setTags([]);
                  setIncludeClosed(false);
                }}
              >
                清空筛选
              </KdyButton>
              <KdyButton size="sm" href="/buddy/new">
                去发布
              </KdyButton>
            </div>
          }
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <p className="text-xs text-muted" data-testid="buddy-total">
            共 {total} 条 · 当前展示 {items.length} 条
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {items.map((item) => (
              <BuddyPostCard key={item.id} item={item} />
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

      <BuddyPrivacyNotice
        compact
        items={[]}
        summary={{
          publicNotice: '活动标题、时间、地点、人数、发起人昵称与头像。',
          hiddenNotice:
            '兴趣标签、可用时段、常去区域、院系与性别。匹配资料对任何人都不可见，包括活动发起人。',
          contactExchange:
            '活动正文禁止写联系方式。只有发起人接受了申请，系统才会经站内信把双方联系方式发给对方。',
          withdrawal:
            '「我的匹配资料」页可随时关闭匹配（立即移出推荐池）或删除资料（硬删，含匹配向量）。',
        }}
      />
    </section>
  );
}
