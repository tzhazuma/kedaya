/**
 * 观测卡片（列表项）。
 *
 * 组件**只渲染 VM 字段**，不做任何计算：物种名、相对时间、投喂政策、
 * "位置已模糊化 / 已扣留"说明、分类免责声明全部由 application 层算好。
 * 这样"隐私文案是否出现"可以在 node 环境的纯逻辑测试里被断言。
 */
import Link from 'next/link';

import type { SightingListItemVM } from '@/application/wildlife/listSightings';

import { KdyBadge } from '../KdyBadge';
import { KdyCard } from '../KdyCard';
import { FeedingPolicyBadge } from './FeedingPolicyBadge';

export interface SightingCardProps {
  item: SightingListItemVM;
  /** 管理端模式：显示状态与审核相关字段 */
  admin?: boolean;
}

export function SightingCard({ item, admin = false }: SightingCardProps) {
  return (
    <KdyCard interactive className="flex flex-col gap-3" data-testid="wildlife-sighting-card">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={item.href}
          className="text-md font-semibold text-body underline-offset-4 hover:underline"
        >
          {item.speciesLabel}
        </Link>
        {item.individualName ? (
          <KdyBadge tone="brand" title="已命名的个体">
            个体：{item.individualName}
          </KdyBadge>
        ) : null}
        {admin || item.status !== 'PUBLISHED' ? (
          <KdyBadge tone={item.status === 'PENDING' ? 'warning' : item.status === 'REJECTED' ? 'danger' : 'success'}>
            {item.statusLabel}
          </KdyBadge>
        ) : null}
        {item.healthConcern ? (
          <KdyBadge tone="danger" title="疑似受伤：已通知校园动物社团">
            疑似受伤
          </KdyBadge>
        ) : null}
        <FeedingPolicyBadge policy={item.feedingPolicy} className="ml-auto" />
      </div>

      <p className="text-xs text-muted">
        {item.observedLabel} · {item.reporterLabel}
        {item.zoneName ? ` · ${item.zoneName}` : ''}
        {item.photoCount > 0 ? ` · ${item.photoCount} 张照片` : ' · 无照片'}
      </p>

      {item.note ? <p className="text-sm text-body">{item.note}</p> : null}

      {item.forbiddenWarning ? (
        <p className="rounded-md border border-danger/40 bg-surface-alt px-3 py-2 text-xs text-danger" role="status">
          {item.forbiddenWarning}
        </p>
      ) : null}

      <p className="text-xs text-muted">{item.geoNotice}</p>

      {item.classifierDisclaimer ? (
        <p className="text-xs text-warning">
          {item.classifierDisclaimer}
          {item.autoSpeciesLabel ? `（识别建议：${item.autoSpeciesLabel}${item.autoConfidenceLabel ? ` · ${item.autoConfidenceLabel}` : ''}）` : ''}
        </p>
      ) : null}

      {admin ? <p className="text-xs text-muted">分类来源：{item.classifiedByLabel}</p> : null}
    </KdyCard>
  );
}
