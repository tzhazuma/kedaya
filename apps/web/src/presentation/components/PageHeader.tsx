import type { ReactNode } from 'react';

import { cn } from '../theme/cn';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}

/** 页面标题区（portal / admin 共用）。 */
export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex flex-col gap-1">
        {eyebrow ? (
          <span className="text-xs font-medium tracking-wide text-brand-strong">{eyebrow}</span>
        ) : null}
        <h1 className="text-xxl font-bold text-body">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
