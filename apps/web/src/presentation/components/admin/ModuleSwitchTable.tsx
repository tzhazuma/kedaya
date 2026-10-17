'use client';

import type { ModuleSwitchVM } from '@/application/admin/loadAdminDashboard';

import { cn } from '../../theme/cn';
import { KdyBadge, type KdyBadgeTone } from '../KdyBadge';

const SENSITIVITY_TONE: Record<string, KdyBadgeTone> = {
  低敏感: 'neutral',
  中敏感: 'info',
  高敏感: 'warning',
  最高敏感: 'danger',
};

export interface ModuleSwitchTableProps {
  switches: readonly ModuleSwitchVM[];
  onToggle: (moduleId: string, enabled: boolean) => void;
  /** 正在提交的模块（禁用该行开关，避免重复提交） */
  pendingModuleId?: string;
  disabled?: boolean;
}

/**
 * 模块开关表（管理后台占位）。
 * 开关状态与审计都由 data 层 mock 提供；敏感模块的开关会在服务端记审计（契约 §9）。
 */
export function ModuleSwitchTable({
  switches,
  onToggle,
  pendingModuleId,
  disabled = false,
}: ModuleSwitchTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="sr-only">模块开关表</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">模块</th>
            <th scope="col" className="py-2 pr-3 font-medium">分类</th>
            <th scope="col" className="py-2 pr-3 font-medium">敏感级</th>
            <th scope="col" className="py-2 pr-3 font-medium">同意门</th>
            <th scope="col" className="py-2 pr-3 font-medium">最近变更</th>
            <th scope="col" className="py-2 pr-3 font-medium">开关</th>
          </tr>
        </thead>
        <tbody>
          {switches.map((item) => {
            const pending = pendingModuleId === item.moduleId;
            return (
              <tr key={item.moduleId} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">
                  <span className="flex flex-col">
                    <span className="font-medium text-body">{item.nameZh}</span>
                    <code className="font-mono text-xs text-muted">{item.moduleId}</code>
                  </span>
                </td>
                <td className="py-2 pr-3 text-muted">{item.categoryLabel}</td>
                <td className="py-2 pr-3">
                  <KdyBadge tone={SENSITIVITY_TONE[item.sensitivityLabel] ?? 'neutral'}>
                    {item.sensitivityLabel}
                  </KdyBadge>
                </td>
                <td className="py-2 pr-3">
                  {item.requiresConsent ? (
                    <KdyBadge tone="warning">需二次同意</KdyBadge>
                  ) : (
                    <span className="text-xs text-muted">不需要</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-muted">
                  {item.updatedLabel}
                  <br />
                  <span className="font-mono">{item.updatedBy}</span>
                </td>
                <td className="py-2 pr-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={item.enabled}
                    aria-label={`${item.nameZh} 模块开关`}
                    disabled={disabled || pending}
                    onClick={() => onToggle(item.moduleId, !item.enabled)}
                    className={cn(
                      'inline-flex h-6 w-11 items-center rounded-pill border transition-colors disabled:opacity-50',
                      item.enabled ? 'border-brand-strong bg-brand' : 'border-border bg-surface-alt',
                    )}
                  >
                    <span
                      className={cn(
                        'size-4 rounded-pill bg-surface shadow-sm transition-transform',
                        item.enabled ? 'translate-x-6' : 'translate-x-1',
                      )}
                    />
                  </button>
                  <span className="ml-2 text-xs text-muted">
                    {pending ? '提交中…' : item.enabled ? '已启用' : '已停用'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
