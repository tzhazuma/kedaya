import Link from 'next/link';

import type { GroupBuyListItemVM } from '@/application/groupbuy/listGroupBuys';

import { cn } from '../../theme/cn';
import { KdyBadge, type KdyBadgeTone } from '../KdyBadge';

const STATUS_TONE: Record<GroupBuyListItemVM['status'], KdyBadgeTone> = {
  recruiting: 'brand',
  locked: 'info',
  completed: 'success',
  cancelled: 'neutral',
};

export interface GroupBuyCardProps {
  item: GroupBuyListItemVM;
  className?: string;
}

/** 拼单卡片（纯展示：所有文案/金额已在 application 层算好） */
export function GroupBuyCard({ item, className }: GroupBuyCardProps) {
  return (
    <article
      data-testid="groupbuy-card"
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-md font-semibold text-body">
            <Link href={`/groupbuy/${item.id}`} className="hover:text-brand-strong">
              {item.title}
            </Link>
          </h3>
          <p className="text-xs text-muted">
            {item.merchant} · {item.categoryLabel} · 发起人 {item.initiatorName}
          </p>
        </div>
        <KdyBadge tone={STATUS_TONE[item.status]}>{item.statusLabel}</KdyBadge>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold text-brand-strong">{item.priceLabel}</span>
        <span className="text-xs text-muted line-through">{item.originalPriceLabel}</span>
        <KdyBadge tone="success">{item.discountLabel}</KdyBadge>
      </div>

      <div className="flex flex-col gap-1">
        <div
          className="h-2 w-full overflow-hidden rounded-pill bg-surface-alt"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={item.progress}
          aria-label={`成团进度 ${item.progress}%`}
        >
          <span
            className="block h-full rounded-pill bg-brand"
            style={{ width: `${item.progress}%` }}
          />
        </div>
        <p className="flex items-center justify-between text-xs text-muted">
          <span>{item.joinedLabel}</span>
          <span>
            {item.remainingSlots > 0 ? `还差 ${item.remainingSlots} 人` : '人数已满'} ·{' '}
            {item.deadlineLabel}
          </span>
        </p>
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
        <span>取货点：{item.pickupSpot}</span>
        <span>{item.createdLabel}</span>
      </footer>

      {item.note ? <p className="text-xs text-muted">备注：{item.note}</p> : null}
    </article>
  );
}
