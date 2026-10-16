import { CircleAlert, Info, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../theme/cn';

export type KdyAlertTone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<KdyAlertTone, { box: string; Icon: typeof Info }> = {
  info: { box: 'bg-surface-alt text-info border-border', Icon: Info },
  success: { box: 'bg-surface-alt text-success border-border', Icon: ShieldCheck },
  warning: { box: 'bg-surface-alt text-warning border-border', Icon: TriangleAlert },
  danger: { box: 'bg-surface-alt text-danger border-border', Icon: CircleAlert },
};

export interface KdyAlertProps {
  tone?: KdyAlertTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** 无障碍角色：错误态用 alert，其余用 status */
  role?: 'alert' | 'status';
}

/** 提示条 —— 错误态 / 同意门 / 非官方声明都用它，保证文案层级一致。 */
export function KdyAlert({
  tone = 'info',
  title,
  children,
  action,
  className,
  role,
}: KdyAlertProps) {
  const { box, Icon } = TONES[tone];
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      className={cn('flex items-start gap-3 rounded-lg border p-4 text-sm', box, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex flex-1 flex-col gap-1">
        <p className="font-semibold">{title}</p>
        {children ? <div className="text-muted">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
