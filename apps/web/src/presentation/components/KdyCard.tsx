import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../theme/cn';

export type KdyCardTone = 'surface' | 'alt' | 'brand';

const TONES: Record<KdyCardTone, string> = {
  surface: 'bg-surface border-border',
  alt: 'bg-surface-alt border-border',
  brand: 'kdy-brand-gradient border-brand-soft',
};

export interface KdyCardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: KdyCardTone;
  /** 是否使用标准内边距（p-4 = 16px，来自 --kdy-space-4） */
  padded?: boolean;
  /** 悬浮时抬升阴影（用于可点击卡片） */
  interactive?: boolean;
  children?: ReactNode;
}

/** 基础卡片容器。所有颜色/圆角/阴影均来自 design-tokens。 */
export function KdyCard({
  tone = 'surface',
  padded = true,
  interactive = false,
  className,
  children,
  ...rest
}: KdyCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border shadow-sm',
        TONES[tone],
        padded && 'p-4',
        interactive && 'transition-shadow hover:shadow-md',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
