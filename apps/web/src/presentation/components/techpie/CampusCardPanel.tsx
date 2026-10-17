'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, RefreshCw, QrCode, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  PaymentCodeHolder,
  campusCardBindingGuidance,
  campusCardState,
  issuePaymentCode,
  revokePaymentCode,
  toCampusCardVM,
  toTransactionListVM,
  type CampusCardVM,
} from '@/application/techpie/campusCard';
import { getMockTechpieRepository, getRepositories } from '@/data/repositories';
import { PAYMENT_CODE_TTL_SEC, paymentCodeRemainingSec } from '@/domain/models/techpie';

import { queryKeys } from '../../query/keys';
import { shouldRetryQuery } from '../../query/retry';
import { asApiError, errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdyEmpty } from '../KdyEmpty';
import { KdyCardSkeleton } from '../KdySkeleton';

const TX_PAGE_SIZE = 5;

/**
 * 校园卡（**独立 OPENID 通道**，规格 §2.5 / §3.3）。
 *
 * ⚠️ 付款码的三条硬规则（本组件的关键约束）：
 * 1. 60 秒 TTL，旧码立即失效 —— 每次"申请"都是新码；
 * 2. **不缓存**：码值只活在 `PaymentCodeHolder`（内存），不进 TanStack Query 缓存、
 *    不进 URL、不进 storage；
 * 3. **不进日志/埋点**：本文件没有任何 console/track 调用，码值也不参与埋点字段。
 *
 * 离开页面（卸载）时主动作废付款码 —— 对应领域状态机
 * `ISSUED --用户主动作废或退出页面--> REVOKED`。
 */
export function CampusCardPanel() {
  const repository = getRepositories().campusCard;
  const mockRepository = getMockTechpieRepository();
  const queryClient = useQueryClient();

  // 付款码持有者：**只在内存**里活着的可变盒子（码值不进 Query 缓存 / URL / storage）。
  // 用 `useState` 的惰性初始化拿到**跨渲染稳定**的实例：
  // 在渲染期间读写 `useRef().current` 会被 React 编译器的 `react-hooks/refs`
  // 判为非法（refs 不参与渲染），而这里确实只需要"一个稳定的对象"。
  const [holder] = useState(() => new PaymentCodeHolder());

  const [codeActive, setCodeActive] = useState(false);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(
    null,
  );

  const cardQuery = useQuery({
    queryKey: queryKeys.campusCard.card,
    queryFn: async () => unwrapOrThrow(await repository.getCard()),
    // 余额是缓存值（TTL 60s，契约 §3.3），不需要窗口聚焦时重取
    staleTime: 60_000,
    // `CAMPUS_BINDING_REQUIRED` 是**确定性**结果：重试没有意义，
    // 只会把"去绑定"的引导推迟（后台标签页里更是会被定时器节流卡住）
    retry: shouldRetryQuery,
  });

  const txQuery = useInfiniteQuery({
    queryKey: queryKeys.campusCard.transactions(),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrapOrThrow(await repository.listTransactions({ cursor: pageParam, limit: TX_PAGE_SIZE })),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: cardQuery.isSuccess,
    retry: shouldRetryQuery,
  });

  // 付款码倒计时：到期即作废（旧码立即失效）
  useEffect(() => {
    if (!codeActive) return undefined;
    const tick = (): void => {
      const expiresAt = holder.expiresAt;
      if (!expiresAt) {
        setCodeActive(false);
        setRemainingSec(null);
        return;
      }
      const left = paymentCodeRemainingSec({ expiresAt }, new Date());
      setRemainingSec(left);
      if (left <= 0) {
        holder.clear();
        setCodeActive(false);
        setRemainingSec(null);
      }
    };
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [codeActive, holder]);

  // 离开页面即作废（不把凭证留在内存里等下一次进来）
  useEffect(
    () => () => {
      if (holder.state === 'empty') return;
      holder.clear();
      void repository.revokePaymentCode();
    },
    [holder, repository],
  );

  const cardError = cardQuery.isError ? asApiError(cardQuery.error) : undefined;
  const state = campusCardState({
    isPending: cardQuery.isPending,
    isError: cardQuery.isError,
    ...(cardError === undefined ? {} : { errorCode: cardError.code }),
  });

  const cardVM: CampusCardVM | undefined = cardQuery.data
    ? toCampusCardVM(cardQuery.data, { now: new Date() })
    : undefined;

  const txPages = txQuery.data?.pages ?? [];
  const txVM = toTransactionListVM(
    { items: txPages.flatMap((page) => page.items), nextCursor: txPages.at(-1)?.nextCursor ?? null },
    { now: new Date() },
  );

  const requestCode = async (): Promise<void> => {
    setFeedback(null);
    const result = await issuePaymentCode(repository, holder);
    if (!result.ok) {
      setFeedback({ tone: 'danger', text: result.error.message });
      return;
    }
    setCodeActive(true);
    setRemainingSec(paymentCodeRemainingSec(result.value, new Date()));
    setFeedback({
      tone: 'success',
      text: `已生成新付款码（${PAYMENT_CODE_TTL_SEC} 秒内有效）。上一张码已立即失效。`,
    });
  };

  const dropCode = async (): Promise<void> => {
    const result = await revokePaymentCode(repository, holder);
    setCodeActive(false);
    setRemainingSec(null);
    setFeedback(
      result.ok
        ? { tone: 'info', text: '付款码已作废（审计只记录动作，不记录码值）。' }
        : { tone: 'danger', text: result.error.message },
    );
  };

  const runMockBinding = async (): Promise<void> => {
    if (!mockRepository) return;
    mockRepository.linkEcardForDemo();
    setFeedback({ tone: 'success', text: '（mock）已模拟完成校园卡 OPENID 绑定。' });
    await queryClient.invalidateQueries({ queryKey: queryKeys.campusCard.root });
    await queryClient.invalidateQueries({ queryKey: queryKeys.techpie.root });
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="campus-card-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="campus-card-heading" className="mr-auto text-sm font-semibold text-body">
          我的校园卡
        </h2>
        <KdyButton href="/techpie" size="sm" variant="secondary">
          绑定管理
        </KdyButton>
        <KdyButton
          size="sm"
          variant="secondary"
          onClick={() => {
            void cardQuery.refetch();
            void txQuery.refetch();
          }}
          disabled={cardQuery.isFetching}
        >
          <RefreshCw className={cn('size-3.5', cardQuery.isFetching && 'animate-spin')} aria-hidden />
          刷新
        </KdyButton>
      </div>

      <p className="text-xs text-muted">
        校园卡走<strong className="font-medium">独立的 OPENID 通道</strong>
        （eCard 的 OPENID 会话），与 eGate / CpDaily 的校园会话（CASTGC）完全解耦 ——
        因此校园卡可以在不代持校园会话的前提下独立落地。
      </p>

      {feedback ? (
        <KdyAlert
          tone={feedback.tone}
          title={feedback.tone === 'danger' ? '操作失败' : '操作结果'}
          role={feedback.tone === 'danger' ? 'alert' : 'status'}
        >
          <p data-testid="campus-card-feedback">{feedback.text}</p>
        </KdyAlert>
      ) : null}

      {state === 'loading' ? (
        <div aria-busy aria-live="polite" className="flex flex-col gap-3" data-testid="campus-card-loading">
          <KdyCardSkeleton />
        </div>
      ) : null}

      {state === 'binding_required' ? (
        <KdyAlert
          tone="info"
          title="先绑定校园卡才能查看余额与流水"
          role="status"
          action={
            <KdyButton href="/techpie" size="sm">
              去绑定
            </KdyButton>
          }
        >
          <p data-testid="campus-card-binding-required">{campusCardBindingGuidance()}</p>
          <p className="mt-1 text-xs">
            服务端返回的是 <code>CAMPUS_BINDING_REQUIRED</code>（409），
            这是合法状态而不是登录过期 —— 你的可达鸭登录态仍然有效。
          </p>
          {mockRepository ? (
            <div className="mt-2">
              <KdyButton size="sm" variant="secondary" onClick={() => void runMockBinding()}>
                （mock）模拟完成 OPENID 绑定
              </KdyButton>
            </div>
          ) : null}
        </KdyAlert>
      ) : null}

      {state === 'error' ? (
        <KdyAlert
          tone="danger"
          title="校园卡加载失败"
          role="alert"
          action={
            <KdyButton size="sm" variant="secondary" onClick={() => void cardQuery.refetch()}>
              重试
            </KdyButton>
          }
        >
          <p>{errorMessage(cardQuery.error)}</p>
        </KdyAlert>
      ) : null}

      {state === 'ready' && cardVM ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <KdyCard className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CreditCard className="size-4 text-brand-strong" aria-hidden />
              <span className="font-mono text-sm text-body">{cardVM.cardNoMasked}</span>
              <KdyBadge tone={cardVM.statusTone}>{cardVM.statusLabel}</KdyBadge>
              <span className="ml-auto text-xs text-muted">同步于 {cardVM.syncedLabel}</span>
            </div>
            <p className="text-display font-bold text-body" data-testid="campus-card-balance">
              {cardVM.balanceLabel}
            </p>
            <p className="text-xs text-muted">
              只展示掩码卡号：完整卡号不进入客户端模型（契约 §3.3 只存
              <code className="mx-1">cardNoMasked</code>）。
            </p>
            {cardVM.notice ? (
              <p className="rounded-md bg-surface-alt p-2 text-xs text-body" role="status">
                {cardVM.notice}
              </p>
            ) : null}
          </KdyCard>

          <KdyCard className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <QrCode className="size-4 text-brand-strong" aria-hidden />
              <span className="text-sm font-semibold text-body">付款码</span>
              <KdyBadge tone={codeActive ? 'success' : 'neutral'}>
                {codeActive ? `${remainingSec ?? 0} 秒后失效` : '未生成'}
              </KdyBadge>
            </div>

            {codeActive ? (
              <p
                className="rounded-md bg-surface-alt p-3 text-center font-mono text-sm break-all text-body"
                data-testid="campus-card-payment-code"
              >
                {holder.peek() ?? '（码值已清除）'}
              </p>
            ) : (
              <p className="text-xs text-muted">
                付款码 60 秒有效且一次性；每次申请都会让上一张立即失效。
                码值不缓存、不进 URL、不进日志与审计正文。
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <KdyButton size="sm" onClick={() => void requestCode()} disabled={cardVM.status !== 'ACTIVE'}>
                <QrCode className="size-3.5" aria-hidden />
                {codeActive ? '重新生成（旧码作废）' : '生成付款码'}
              </KdyButton>
              {codeActive ? (
                <KdyButton size="sm" variant="secondary" onClick={() => void dropCode()}>
                  <XCircle className="size-3.5" aria-hidden />
                  立即作废
                </KdyButton>
              ) : null}
            </div>

            <p className="text-xs text-muted">
              离开本页会自动作废当前付款码（领域状态机：用户主动作废或退出页面 → REVOKED）。
            </p>
          </KdyCard>

          <KdyCard className="flex flex-col gap-3 lg:col-span-2">
            <h3 className="text-sm font-semibold text-body">流水</h3>

            {txQuery.isPending ? (
              <div aria-busy aria-live="polite" className="flex flex-col gap-2" data-testid="campus-card-tx-loading">
                <KdyCardSkeleton />
              </div>
            ) : null}

            {txQuery.isError ? (
              <KdyAlert
                tone="danger"
                title="流水加载失败"
                role="alert"
                action={
                  <KdyButton size="sm" variant="secondary" onClick={() => void txQuery.refetch()}>
                    重试
                  </KdyButton>
                }
              >
                <p>{errorMessage(txQuery.error)}</p>
              </KdyAlert>
            ) : null}

            {!txQuery.isPending && !txQuery.isError && txVM.items.length === 0 ? (
              <KdyEmpty
                title="还没有流水"
                description="校园卡暂时没有交易记录。消费、充值、退款都会在这里出现。"
              />
            ) : null}

            {txVM.items.length > 0 ? (
              <ul className="flex flex-col" data-testid="campus-card-transactions">
                {txVM.items.map((tx) => (
                  <li
                    key={tx.id}
                    className="flex flex-wrap items-center gap-2 border-t border-border py-2 text-xs first:border-t-0"
                  >
                    <span className="text-body">{tx.merchantLabel}</span>
                    <KdyBadge tone="neutral">{tx.kindLabel}</KdyBadge>
                    <span className="ml-auto text-muted">{tx.occurredLabel}</span>
                    <span
                      className={cn(
                        'w-20 text-right font-mono',
                        tx.isExpense ? 'text-danger' : 'text-success',
                      )}
                    >
                      {tx.amountLabel}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {txQuery.hasNextPage ? (
              <div className="flex justify-center">
                <KdyButton
                  size="sm"
                  variant="secondary"
                  onClick={() => void txQuery.fetchNextPage()}
                  disabled={txQuery.isFetchingNextPage}
                >
                  {txQuery.isFetchingNextPage ? '加载中…' : '加载更多（游标分页）'}
                </KdyButton>
              </div>
            ) : null}
          </KdyCard>
        </div>
      ) : null}
    </section>
  );
}
