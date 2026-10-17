import type { ReactNode } from 'react';

import { cn } from '../theme/cn';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * 页面标题区（portal / admin 共用）。
 *
 * 这里刻意没有「eyebrow / 小标签」：标题上方再挂一行
 * 「校园服务 · wildlife」既占高度又像开发者留下的占位符，
 * 用户从它身上拿不到任何信息 —— 标题自己已经说清这是哪一页了。
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex flex-col gap-1">
        <h1 className="text-xxl font-bold text-body">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
