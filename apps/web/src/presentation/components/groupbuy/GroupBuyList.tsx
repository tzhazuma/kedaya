'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { RefreshCw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { loadGroupBuyList, type GroupBuyListVM } from '@/application/groupbuy/listGroupBuys';
import { getMockGroupBuyRepository, getRepositories } from '@/data/repositories';
import { GROUP_BUY_STATUS_LABELS, type GroupBuyStatus } from '@/domain/models/groupbuy';

import { queryKeys } from '../../query/keys';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyButton } from '../KdyButton';
import { KdyEmpty } from '../KdyEmpty';
import { KdyCardSkeleton } from '../KdySkeleton';
import { GroupBuyCard } from './GroupBuyCard';

/** 每页条数（故意取小值，便于演示游标分页） */
const PAGE_SIZE = 4;

const STATUS_VALUES = ['recruiting', 'locked', 'completed', 'cancelled'] as const;

const STATUS_FILTERS: ReadonlyArray<{ value: GroupBuyStatus | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  ...STATUS_VALUES.map((status) => ({
    value: status as GroupBuyStatus | 'all',
    label: GROUP_BUY_STATUS_LABELS[status],
  })),
];

/**
 * 拼单列表 —— 垂直切片的入口。
 *
 * 数据流：`GroupBuyList`（presentation）→ `loadGroupBuyList`（application）
 *         → `GroupBuyRepository`（domain port）← mock/http adapter（data）
 *
 * 三态齐全：loading（骨架） / error（可重试） / empty（空态）+ success。
 */
export function GroupBuyList() {
  const [status, setStatus] = useState<GroupBuyStatus | 'all'>('all');
  const [keyword, setKeyword] = useState('');
  const [forcingError, setForcingError] = useState(false);

  const repository = getRepositories().groupbuy;
  const mockRepository = getMockGroupBuyRepository();

  const query = useInfiniteQuery({
    queryKey: queryKeys.groupbuy.list({ status, keyword }),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrapOrThrow(
        await loadGroupBuyList(
          repository,
          {
            cursor: pageParam,
            limit: PAGE_SIZE,
            ...(status === 'all' ? {} : { status }),
            ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          },
          new Date(),
        ),
      ),
    getNextPageParam: (last: GroupBuyListVM) => last.nextCursor ?? undefined,
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;

  const toggleForcedError = (): void => {
    if (!mockRepository) return;
    const next = !forcingError;
    mockRepository.setFailureMode(next ? 'error' : 'none');
    setForcingError(next);
    void query.refetch();
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="groupbuy-list-heading">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="groupbuy-list-heading" className="mr-auto text-sm font-semibold text-body">
            筛选
          </h2>
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
              className={cn(
                'rounded-pill border px-3 py-1 text-xs transition-colors',
                status === filter.value
                  ? 'border-brand-soft bg-brand-soft text-brand-strong'
                  : 'border-border bg-surface text-muted hover:bg-surface-alt',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 rounded-md border border-border bg-surface-alt px-3 py-2">
          <Search className="size-4 text-muted" aria-hidden />
          <span className="sr-only">搜索拼单</span>
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索标题 / 商家 / 取货点"
            className="w-full bg-transparent text-sm text-body outline-none placeholder:text-muted"
          />
        </label>

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
      {query.isPending ? (
        <div
          aria-busy
          aria-live="polite"
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          data-testid="groupbuy-loading"
        >
          <KdyCardSkeleton />
          <KdyCardSkeleton />
        </div>
      ) : null}

      {/* ---- error 态 ---- */}
      {query.isError ? (
        <KdyAlert
          tone="danger"
          title="拼单列表加载失败"
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
            提示：这是可恢复错误，契约 §8 要求失败静默降级而非白屏。
            {items.length > 0 ? '下方展示的是上一次成功获取的数据。' : ''}
          </p>
        </KdyAlert>
      ) : null}

      {/* ---- empty 态 ---- */}
      {query.isSuccess && items.length === 0 ? (
        <KdyEmpty
          title="没有匹配的拼单"
          description="换个关键词，或把状态筛选切回「全部」。"
          action={
            <KdyButton
              size="sm"
              variant="secondary"
              onClick={() => {
                setKeyword('');
                setStatus('all');
              }}
            >
              清空筛选
            </KdyButton>
          }
        />
      ) : null}

      {/* ---- success 态 ---- */}
      {items.length > 0 ? (
        <>
          <p className="text-xs text-muted" data-testid="groupbuy-total">
            共 {total} 条 · 当前展示 {items.length} 条
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {items.map((item) => (
              <GroupBuyCard key={item.id} item={item} />
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
