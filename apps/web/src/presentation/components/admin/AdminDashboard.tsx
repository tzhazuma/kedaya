'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
  DEMO_ADMIN_ACTOR,
  loadAdminDashboard,
  type AdminDashboardVM,
} from '@/application/admin/loadAdminDashboard';
import { getRepositories } from '@/data/repositories';

import { queryKeys } from '../../query/keys';
import { asApiError, errorMessage, unwrapOrThrow } from '../../query/unwrap';
import { KdyAlert } from '../KdyAlert';
import { KdyButton } from '../KdyButton';
import { KdyCard } from '../KdyCard';
import { KdySkeleton } from '../KdySkeleton';
import { AuditLogTable } from './AuditLogTable';
import { ModuleSwitchTable } from './ModuleSwitchTable';

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <KdyCard tone="alt" className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xxl font-bold text-body">{value}</span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </KdyCard>
  );
}

/**
 * 管理后台占位页主体（契约 §9 的可视化落地）：
 * 模块开关表 + 审计日志表 + 合规概览。
 *
 * 说明：写操作（开关）在 mock 里会**同时追加一条审计**，被拒时也记 denied —— 
 * 与真实后端的行为保持一致，避免"占位页看不出合规要求"。
 */
export function AdminDashboard() {
  const repositories = getRepositories();
  const queryClient = useQueryClient();
  const [pendingModuleId, setPendingModuleId] = useState<string | undefined>(undefined);
  const [toggleError, setToggleError] = useState<string | undefined>(undefined);

  const query = useQuery({
    queryKey: queryKeys.admin.dashboard,
    queryFn: async () =>
      unwrapOrThrow(
        await loadAdminDashboard(
          { moduleSwitches: repositories.moduleSwitches, auditLog: repositories.auditLog },
          new Date(),
        ),
      ),
  });

  const toggleMutation = useMutation({
    mutationFn: async (input: { moduleId: string; enabled: boolean }) =>
      unwrapOrThrow(
        await repositories.moduleSwitches.toggle(input.moduleId, input.enabled, DEMO_ADMIN_ACTOR),
      ),
    onMutate: (input) => {
      setPendingModuleId(input.moduleId);
      setToggleError(undefined);
    },
    onError: (error) => {
      setToggleError(asApiError(error).message);
    },
    onSettled: () => {
      setPendingModuleId(undefined);
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.root });
    },
  });

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy data-testid="admin-loading">
        <KdyCard className="flex flex-col gap-3">
          <KdySkeleton className="h-6 w-40" />
          <KdySkeleton lines={4} />
        </KdyCard>
        <KdyCard className="flex flex-col gap-3">
          <KdySkeleton className="h-6 w-40" />
          <KdySkeleton lines={5} />
        </KdyCard>
      </div>
    );
  }

  if (query.isError) {
    const apiError = asApiError(query.error);
    return (
      <KdyAlert
        tone="danger"
        title="管理后台数据加载失败"
        action={
          <KdyButton size="sm" variant="secondary" onClick={() => void query.refetch()}>
            <RefreshCw className="size-3.5" aria-hidden />
            重试
          </KdyButton>
        }
      >
        <p>{errorMessage(query.error)}</p>
        <p className="mt-1 text-xs">错误码：{apiError.code}</p>
      </KdyAlert>
    );
  }

  const data: AdminDashboardVM = query.data;

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="已启用模块" value={data.enabledCount} />
        <Stat label="已停用模块" value={data.disabledCount} />
        <Stat label="需二次同意" value={data.consentGatedCount} hint="契约 §9" />
        <Stat label="审计范围内模块" value={data.auditedModuleCount} hint="high + critical" />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="admin-switch-heading">
        <header className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="admin-switch-heading" className="text-lg font-semibold text-body">
              模块开关
            </h2>
            <p className="text-xs text-muted">
              开关状态来自 data 层 mock（<code className="font-mono">/admin/modules</code>
              ）。占位实现：不落库，刷新即回到默认值。
            </p>
          </div>
          <KdyButton
            size="sm"
            variant="secondary"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw className={query.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden />
            刷新
          </KdyButton>
        </header>

        {toggleError ? (
          <KdyAlert tone="danger" title="开关操作被拒绝">
            <p>{toggleError}</p>
          </KdyAlert>
        ) : null}

        <KdyCard padded={false} className="p-4">
          <ModuleSwitchTable
            switches={data.switches}
            pendingModuleId={pendingModuleId}
            onToggle={(moduleId, enabled) => toggleMutation.mutate({ moduleId, enabled })}
          />
        </KdyCard>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="admin-audit-heading">
        <header>
          <h2 id="admin-audit-heading" className="text-lg font-semibold text-body">
            审计日志
          </h2>
          <p className="text-xs text-muted">
            谁 · 何时 · 对哪条记录 · 什么动作（契约 §9）。被拒访问同样落审计；主体标识已脱敏。
          </p>
        </header>
        <KdyCard>
          <AuditLogTable entries={data.audit} />
        </KdyCard>
      </section>
    </div>
  );
}
