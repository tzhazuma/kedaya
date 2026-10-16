'use client';

/**
 * 观测详情（`/wildlife/sightings/[id]`）。
 *
 * 详情页承担三件事：
 * 1. 展示**公开信息**（物种、公开时间、模糊化位置说明、照片数量）；
 * 2. 说明隐私边界：精确坐标与精确时间**不在**这个响应里（规格 §2.7 / §11.2 T15）；
 * 3. `rejectReason` 只在这里出现，且**必须由审核端标记**（规格 §2.6）。
 */
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { loadWildlifeCatalog } from '@/application/wildlife/loadWildlifeCatalog';
import { loadSightingDetail } from '@/application/wildlife/listSightings';
import { getRepositories } from '@/data/repositories';

import { queryKeys } from '../../query/keys';
import { errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { cn } from '../../theme/cn';
import { KdyAlert } from '../KdyAlert';
import { KdyBadge } from '../KdyBadge';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdyEmpty } from '../KdyEmpty';
import { KdySkeleton } from '../KdySkeleton';
import { FeedingPolicyBadge } from './FeedingPolicyBadge';

export interface SightingDetailViewProps {
  sightingId: string;
  /** 审核端视角（可显示仅审核端可见的字段） */
  admin?: boolean;
}

export function SightingDetailView({ sightingId, admin = false }: SightingDetailViewProps) {
  const repository = getRepositories().wildlife;
  const query = useQuery({
    queryKey: queryKeys.wildlife.detail(sightingId),
    queryFn: async () => {
      const catalog = unwrapOrThrow(await loadWildlifeCatalog(repository));
      return unwrapOrThrow(await loadSightingDetail(repository, sightingId, catalog));
    },
  });

  if (query.isPending) {
    return (
      <div aria-busy aria-live="polite" className="flex flex-col gap-3" data-testid="wildlife-detail-loading">
        <KdySkeleton className="h-32 w-full" />
        <KdySkeleton lines={4} />
      </div>
    );
  }

  if (query.isError) {
    const message = errorMessage(query.error);
    const notFound = message.includes('不存在');
    return (
      <KdyAlert
        tone="danger"
        title={notFound ? '观测记录不存在' : '观测详情加载失败'}
        role="alert"
        action={
          notFound ? (
            <KdyButton size="sm" variant="secondary" href="/wildlife">
              返回地图
            </KdyButton>
          ) : (
            <KdyButton size="sm" variant="secondary" onClick={() => void query.refetch()}>
              <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} aria-hidden />
              重试
            </KdyButton>
          )
        }
      >
        <p>{message}</p>
        {notFound ? (
          <p className="mt-1 text-xs">
            未审核通过的记录不会出现在公开列表里；若这是你自己的上报，请从「我的」查看处理进度。
          </p>
        ) : null}
      </KdyAlert>
    );
  }

  const item = query.data;
  if (!item) {
    return <KdyEmpty title="没有数据" description="该观测记录暂不可用。" />;
  }

  return (
    <article className="flex flex-col gap-4" data-testid="wildlife-sighting-detail">
      <KdyCard className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-body">{item.speciesLabel}</h2>
          {item.individualName ? <KdyBadge tone="brand">个体：{item.individualName}</KdyBadge> : null}
          <KdyBadge
            tone={item.status === 'PENDING' ? 'warning' : item.status === 'REJECTED' ? 'danger' : 'success'}
          >
            {item.statusLabel}
          </KdyBadge>
          {item.healthConcern ? <KdyBadge tone="danger">疑似受伤</KdyBadge> : null}
          <FeedingPolicyBadge policy={item.feedingPolicy} withHint className="ml-auto" />
        </div>

        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">公开时间（已粗化）</dt>
            <dd className="text-body">{item.observedLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">上报人</dt>
            <dd className="text-body">{item.reporterLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">所属区域</dt>
            <dd className="text-body">{item.zoneName ?? '未落在已定义区域内'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">照片</dt>
            <dd className="text-body">{item.photoCount > 0 ? `${item.photoCount} 张` : '无照片'}</dd>
          </div>
        </dl>

        {item.note ? <p className="text-sm text-body">{item.note}</p> : null}

        {item.forbiddenWarning ? (
          <p className="rounded-md border border-danger/40 bg-surface-alt px-3 py-2 text-xs text-danger" role="status">
            {item.forbiddenWarning}
          </p>
        ) : null}
      </KdyCard>

      <KdyAlert tone="info" title={item.geoWithheld ? '该记录不公开坐标' : '位置已模糊化'}>
        <p>{item.geoNotice}</p>
        <p className="mt-1 text-xs">{item.timeNotice}</p>
        <p className="mt-1 text-xs">
          公开响应里<strong className="font-medium">没有</strong>精确坐标、也没有上报人 id ——
          不是“前端不显示”，而是接口就不返回（规格 §2.7 受限表 + §11.2 T15）。
        </p>
      </KdyAlert>

      {item.classifierDisclaimer ? (
        <KdyAlert tone="warning" title="物种来自自动识别建议">
          <p>
            {item.classifierDisclaimer}
            {item.autoSpeciesLabel
              ? `（识别建议：${item.autoSpeciesLabel}${item.autoConfidenceLabel ? ` · 置信度 ${item.autoConfidenceLabel}` : ''}）`
              : ''}
          </p>
          <p className="mt-1 text-xs">分类来源：{item.classifiedByLabel}</p>
        </KdyAlert>
      ) : null}

      {admin ? (
        <KdyAlert tone="warning" title="审核端视角">
          <p>{item.moderatedLabel ?? '尚未审核'}</p>
          {item.rejectReason ? <p className="mt-1">拒绝理由（仅审核端可见）：{item.rejectReason}</p> : null}
          <p className="mt-1 text-xs">
            审核端可见精确坐标与精确时间，且每次读取都会写审计日志（规格 §2.7 / §11.2 T16）。
          </p>
        </KdyAlert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <KdyButton href="/wildlife" variant="secondary">
          返回地图
        </KdyButton>
        <KdyButton href="/wildlife/report">上报观测</KdyButton>
      </div>
    </article>
  );
}
