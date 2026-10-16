import Link from 'next/link';

import type { BuddyPostCardVM } from '@/application/buddy/listBuddyPosts';

import { KdyBadge } from '../KdyBadge';
import { KdyCard } from '../KdyCard';

export interface BuddyPostCardProps {
  item: BuddyPostCardVM;
  /** 推荐页会额外渲染理由区，卡片本身不关心 */
  footer?: React.ReactNode;
}

/** 搭子卡片 —— 状态、名额、时间、地点、标签全部来自 VM，组件不做计算。 */
export function BuddyPostCard({ item, footer }: BuddyPostCardProps) {
  return (
    <KdyCard className="flex flex-col gap-3" data-testid={`buddy-card-${item.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <KdyBadge tone="neutral">{item.sectionLabel}</KdyBadge>
        <KdyBadge tone={item.statusTone}>{item.statusLabel}</KdyBadge>
        {item.isMine ? <KdyBadge tone="info">我发布的</KdyBadge> : null}
        {item.myApplicationLabel ? (
          <KdyBadge tone="brand">我的申请：{item.myApplicationLabel}</KdyBadge>
        ) : null}
        <span className="ml-auto text-xs text-muted">{item.createdLabel}发布</span>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-md font-semibold text-body">
          <Link href={`/buddy/${item.id}`} className="hover:text-brand-strong">
            {item.title}
          </Link>
        </h3>
        <p className="text-xs text-muted">
          {item.activityLabel} · {item.locationLabel} · {item.startsAtLabel}（{item.startsInLabel}） ·{' '}
          {item.durationLabel}
        </p>
      </div>

      {item.tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="活动标签">
          {item.tags.map((tag) => (
            <li key={tag.key}>
              <KdyBadge tone="brand">{tag.label}</KdyBadge>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>
            {item.capacityLabel} · {item.remainingLabel}
          </span>
          <span>{item.creatorLabel} 发起</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-alt"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={item.progress}
          aria-label={`${item.title} 的报名进度`}
        >
          <span
            className="block h-full rounded-pill bg-brand"
            style={{ width: `${item.progress}%` }}
          />
        </div>
      </div>

      <p className="text-xs text-muted">
        {item.genderPreferenceLabel}
        {item.skillLabel ? ` · ${item.skillLabel}` : ''}
      </p>

      {item.notice ? (
        <p className="rounded-md border border-border bg-surface-alt px-3 py-2 text-xs text-muted">
          {item.notice}
        </p>
      ) : null}

      {item.blockedReason ? (
        <p className="text-xs text-warning" data-testid={`buddy-blocked-${item.id}`}>
          {item.blockedReason}
        </p>
      ) : (
        <p className="text-xs text-success">可以申请</p>
      )}

      <p className="text-xs text-muted">
        联系方式不在这里公开：申请被接受后由站内信交换。
      </p>

      {footer}
    </KdyCard>
  );
}
