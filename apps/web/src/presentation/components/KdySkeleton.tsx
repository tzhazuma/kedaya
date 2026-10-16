import { cn } from '../theme/cn';

export interface KdySkeletonProps {
  className?: string;
  /** 渲染成多行（最后一行短一些） */
  lines?: number;
}

/** 骨架屏 —— 契约 §8：启动/加载时先渲染骨架，禁止阻塞等待网络。 */
export function KdySkeleton({ className, lines = 1 }: KdySkeletonProps) {
  if (lines <= 1) {
    return (
      <span
        aria-hidden
        className={cn('block h-4 w-full animate-pulse rounded-sm bg-surface-alt', className)}
      />
    );
  }

  return (
    <span className={cn('flex flex-col gap-2', className)} aria-hidden>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className={cn(
            'block h-4 animate-pulse rounded-sm bg-surface-alt',
            index === lines - 1 ? 'w-2/3' : 'w-full',
          )}
        />
      ))}
    </span>
  );
}

/** 卡片骨架（列表三态里的 loading 态复用） */
export function KdyCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm',
        className,
      )}
    >
      <KdySkeleton className="h-5 w-1/2" />
      <KdySkeleton lines={2} />
      <KdySkeleton className="h-2 w-full" />
    </div>
  );
}
