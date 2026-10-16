import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../theme/cn';

export interface KdyEmptyProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** 空态占位（列表为空、模块未实现等）。 */
export function KdyEmpty({ title, description, action, className }: KdyEmptyProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center',
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-pill bg-surface-alt text-muted">
        <Inbox className="size-6" aria-hidden />
      </span>
      <p className="text-md font-semibold text-body">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}
