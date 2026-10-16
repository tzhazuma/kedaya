'use client';

import { useMemo, useState } from 'react';

import type { AuditLogVM } from '@/application/admin/loadAdminDashboard';

import { cn } from '../../theme/cn';
import { KdyBadge } from '../KdyBadge';
import { KdyEmpty } from '../KdyEmpty';

export interface AuditLogTableProps {
  entries: readonly AuditLogVM[];
}

/**
 * 审计日志表 —— 契约 §9 的落地：每行必须能回答
 * 「谁（脱敏主体 + 角色）、何时、对哪条记录（模块 + 对象）、什么动作（含结果）」。
 */
export function AuditLogTable({ entries }: AuditLogTableProps) {
  const [onlyDenied, setOnlyDenied] = useState(false);

  const rows = useMemo(
    () => (onlyDenied ? entries.filter((entry) => entry.result === 'denied') : entries),
    [entries, onlyDenied],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={!onlyDenied}
          onClick={() => setOnlyDenied(false)}
          className={cn(
            'rounded-pill border px-3 py-1 text-xs',
            !onlyDenied
              ? 'border-brand-soft bg-brand-soft text-brand-strong'
              : 'border-border bg-surface text-muted hover:bg-surface-alt',
          )}
        >
          全部（{entries.length}）
        </button>
        <button
          type="button"
          aria-pressed={onlyDenied}
          onClick={() => setOnlyDenied(true)}
          className={cn(
            'rounded-pill border px-3 py-1 text-xs',
            onlyDenied
              ? 'border-brand-soft bg-brand-soft text-brand-strong'
              : 'border-border bg-surface text-muted hover:bg-surface-alt',
          )}
        >
          仅被拒
        </button>
      </div>

      {rows.length === 0 ? (
        <KdyEmpty title="没有审计记录" description="当前筛选条件下没有命中的审计条目。" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <caption className="sr-only">审计日志表</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">何时</th>
                <th scope="col" className="py-2 pr-3 font-medium">谁</th>
                <th scope="col" className="py-2 pr-3 font-medium">动作</th>
                <th scope="col" className="py-2 pr-3 font-medium">模块</th>
                <th scope="col" className="py-2 pr-3 font-medium">对象</th>
                <th scope="col" className="py-2 pr-3 font-medium">敏感级</th>
                <th scope="col" className="py-2 pr-3 font-medium">结果</th>
                <th scope="col" className="py-2 pr-3 font-medium">traceId</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} className="border-b border-border last:border-0 align-top">
                  <td className="py-2 pr-3 text-xs text-muted">
                    {entry.occurredLabel}
                    <br />
                    <time dateTime={entry.occurredAt} className="font-mono">
                      {entry.occurredAt.slice(0, 19)}Z
                    </time>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex flex-col">
                      <span className="text-body">{entry.roleLabel}</span>
                      <span className="font-mono text-xs text-muted">{entry.maskedActorId}</span>
                      {entry.ip ? (
                        <span className="font-mono text-xs text-muted">{entry.ip}</span>
                      ) : null}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-body">{entry.actionLabel}</td>
                  <td className="py-2 pr-3">
                    <span className="flex flex-col">
                      <span className="text-body">{entry.moduleLabel}</span>
                      <code className="font-mono text-xs text-muted">{entry.moduleId}</code>
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-muted">{entry.target}</td>
                  <td className="py-2 pr-3">
                    <KdyBadge
                      tone={
                        entry.sensitivityLabel === '最高敏感'
                          ? 'danger'
                          : entry.sensitivityLabel === '高敏感'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {entry.sensitivityLabel}
                    </KdyBadge>
                  </td>
                  <td className="py-2 pr-3">
                    <KdyBadge tone={entry.result === 'allowed' ? 'success' : 'danger'}>
                      {entry.resultLabel}
                    </KdyBadge>
                    {entry.reason ? (
                      <span className="mt-1 block text-xs text-muted">{entry.reason}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-muted">{entry.traceId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
