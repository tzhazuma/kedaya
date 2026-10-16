import type { ReactNode } from 'react';

import { cn } from '../theme/cn';

export type KdyBadgeTone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<KdyBadgeTone, string> = {
  neutral: 'bg-surface-alt text-muted border-border',
  brand: 'bg-brand-soft text-brand-strong border-brand-soft',
  info: 'bg-surface-alt text-info border-border',
  success: 'bg-surface-alt text-success border-border',
  warning: 'bg-surface-alt text-warning border-border',
  danger: 'bg-surface-alt text-danger border-border',
};

export interface KdyBadgeProps {
  tone?: KdyBadgeTone;
  className?: string;
  title?: string;
  children: ReactNode;
}

/** 状态/标签徽章。 */
export function KdyBadge({ tone = 'neutral', className, title, children }: KdyBadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center rounded-pill border px-2 py-0.5 text-xs whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
