'use client';

import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import {
  capabilityListState,
  loadCapabilities,
  type CapabilityVM,
  type TechpieCapabilityListVM,
} from '@/application/techpie/capabilities';
import { getRepositories } from '@/data/repositories';
import {
  CAMPUS_TARGET_ALLOWLIST_NOTE,
  CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER,
} from '@/domain/models/techpie';

import { queryKeys } from '../../query/keys';
import { shouldRetryQuery } from '../../query/retry';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdyEmpty } from '../KdyEmpty';
import { KdyCardSkeleton } from '../KdySkeleton';

/**
 * 校园能力清单（规格 §8.1 端点 6 / §3.1 映射表）。
 *
 * ⚠️ **本组件的核心职责**：`CAMPUS_BINDING_REQUIRED` 与 `EXPIRED` 是**引导**，
 * 不是报错（契约 §5 硬规则 3、ADR §5.4）。因此：
 * - 用 `KdyAlert tone="info"` + "去绑定"按钮，而不是红色错误框；
 * - 文案说明"绑定是可选的、不绑定不影响自有功能"；
 * - Phase 1+ 的能力如实标为"尚未开放"并给出阻塞原因（**不假装只是待接线**）。
 */
export function TechpieCapabilityList() {
  const repository = getRepositories().techpie;

  const query = useQuery({
    queryKey: queryKeys.techpie.capabilities,
    queryFn: async () => unwrapOrThrow(await loadCapabilities(repository)),
    retry: shouldRetryQuery,
  });

  const vm: TechpieCapabilityListVM | undefined = query.data;
  const items = vm?.items ?? [];
  const state = capabilityListState({
    isPending: query.isPending,
    isError: query.isError,
    itemCount: items.length,
  });

  return (
    <section className="flex flex-col gap-4" aria-labelledby="techpie-capabilities-heading">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="techpie-capabilities-heading" className="mr-auto text-sm font-semibold text-body">
          校园能力清单
        </h2>
        <KdyButton href="/techpie" size="sm" variant="secondary">
          绑定管理
        </KdyButton>
        <KdyButton
          size="sm"
          variant="secondary"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} aria-hidden />
          刷新
        </KdyButton>
      </div>

      {CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER ? (
        <KdyAlert tone="warning" title="校园域名白名单内容仍是占位">
          <p>{CAMPUS_TARGET_ALLOWLIST_NOTE}</p>
          <p className="mt-1 text-xs">
            服务端下发的 WebView 目标地址会逐条过白名单校验（fail-closed）；
            客户端只原样透传服务端下发的地址，不自行拼接。
          </p>
        </KdyAlert>
      ) : null}

      {state === 'loading' ? (
        <div aria-busy aria-live="polite" className="flex flex-col gap-3" data-testid="techpie-capabilities-loading">
          <KdyCardSkeleton />
          <KdyCardSkeleton />
        </div>
      ) : null}

      {state === 'error' ? (
        <KdyAlert
          tone="danger"
          title="能力清单加载失败"
          role="alert"
          action={
            <KdyButton size="sm" variant="secondary" onClick={() => void query.refetch()}>
              重试
            </KdyButton>
          }
        >
          <p>{errorMessage(query.error)}</p>
        </KdyAlert>
      ) : null}

      {state === 'empty' ? (
        <KdyEmpty
          title="暂时没有可展示的校园能力"
          description="Phase 0 只接入零合规风险的入口：校园卡（OPENID 通道）与 WebView 直连。结构化校园数据（课表 / 考试 / DDL）与场馆预约需要学校信息办的书面确认，本轮不实现。"
          action={<KdyButton href="/techpie" size="sm">去绑定管理</KdyButton>}
        />
      ) : null}

      {vm && items.length > 0 ? (
        <>
          {vm.groups.needsBinding.length > 0 ? (
            <div className="flex flex-col gap-3" data-testid="techpie-capability-binding-required">
              <h3 className="text-sm font-semibold text-body">需要先绑定（这是引导，不是错误）</h3>
              {vm.groups.needsBinding.map((item) => (
                <KdyCard key={item.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-body">{item.nameZh}</span>
                    <KdyBadge tone={item.statusTone}>{item.statusLabel}</KdyBadge>
                    <KdyBadge tone="neutral">{item.moduleLabel}</KdyBadge>
                    {item.platformLabel ? <KdyBadge tone="neutral">{item.platformLabel}</KdyBadge> : null}
                  </div>
                  <p className="text-xs text-muted">{item.summary}</p>
                  <KdyAlert tone="info" title="先绑定才能使用">
                    <p data-testid={`techpie-guidance-${item.id}`}>{item.guidance}</p>
                  </KdyAlert>
                  {item.bindHref ? (
                    <div>
                      <KdyButton href={item.bindHref} size="sm">
                        去绑定
                      </KdyButton>
                    </div>
                  ) : null}
                </KdyCard>
              ))}
            </div>
          ) : null}

          {vm.groups.available.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-body">可用</h3>
              {vm.groups.available.map((item) => (
                <CapabilityCard key={item.id} item={item} />
              ))}
            </div>
          ) : null}

          {vm.groups.blocked.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-body">尚未开放（本轮不实现）</h3>
              {vm.groups.blocked.map((item) => (
                <CapabilityCard key={item.id} item={item} />
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function CapabilityCard({ item }: { item: CapabilityVM }) {
  return (
    <KdyCard className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-body">{item.nameZh}</span>
        <KdyBadge tone={item.statusTone}>{item.statusLabel}</KdyBadge>
        <KdyBadge tone="neutral">{item.moduleLabel}</KdyBadge>
        <KdyBadge tone="neutral">{item.phaseLabel}</KdyBadge>
        {item.platformLabel ? <KdyBadge tone="neutral">{item.platformLabel}</KdyBadge> : null}
      </div>
      <p className="text-xs text-muted">{item.summary}</p>
      {item.guidance ? (
        <p className="rounded-md bg-surface-alt p-2 text-xs text-body" data-testid={`techpie-guidance-${item.id}`}>
          {item.guidance}
        </p>
      ) : null}
      {item.entryHref ? (
        <div>
          <KdyButton href={item.entryHref} size="sm" variant="secondary">
            {item.access === 'webview' ? '打开 WebView 直连' : '进入'}
          </KdyButton>
        </div>
      ) : null}
    </KdyCard>
  );
}
