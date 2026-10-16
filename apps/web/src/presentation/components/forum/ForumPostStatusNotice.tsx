import { Lock, ShieldAlert } from 'lucide-react';

import { cn } from '../../theme/cn';
import { KdyBadge } from '../KdyBadge';

export interface ForumPostStatusNoticeProps {
  statusLabel: string;
  tone: 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';
  /** 治理说明；null 表示无需额外说明 */
  notice: string | null;
  /** 被举报隐藏 */
  hidden?: boolean;
  /** 被版主锁定 */
  locked?: boolean;
  className?: string;
}

/**
 * 主题治理状态提示。
 *
 * 域模型 §2.4 治理规则要求「被隐藏的主题显示明确状态，不要静默消失」，
 * 所以 HIDDEN / LOCKED 的主题在列表与详情里都必须带上这段说明。
 */
export function ForumPostStatusNotice({
  statusLabel,
  tone,
  notice,
  hidden = false,
  locked = false,
  className,
}: ForumPostStatusNoticeProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <KdyBadge tone={tone}>{statusLabel}</KdyBadge>
        {hidden ? (
          <span className="inline-flex items-center gap-1 text-xs text-danger">
            <ShieldAlert className="size-3.5" aria-hidden />
            已被举报隐藏
          </span>
        ) : null}
        {locked ? (
          <span className="inline-flex items-center gap-1 text-xs text-warning">
            <Lock className="size-3.5" aria-hidden />
            已锁定，不再接受回复
          </span>
        ) : null}
      </div>
      {notice ? (
        <p
          className={cn(
            'rounded-md border border-border bg-surface-alt px-2 py-1 text-xs',
            hidden ? 'text-danger' : locked ? 'text-warning' : 'text-muted',
          )}
        >
          {notice}
        </p>
      ) : null}
    </div>
  );
}
