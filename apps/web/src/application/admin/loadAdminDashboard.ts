/**
 * 用例：加载管理后台概览（模块开关 + 审计日志）。
 *
 * 契约 §9：后台必须能回答「谁、何时、对哪条记录、什么动作」，
 * 所以审计 VM 把主体脱敏、动作/角色/敏感级都翻成中文，并保留 traceId 供追溯。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, formatRelativeTime, ok, type Result } from '@kedaya/shared';

import {
  AUDIT_ACTION_LABELS,
  AUDIT_ROLE_LABELS,
  maskActorId,
  sortAuditDesc,
  type AuditActorRole,
  type AuditLogEntry,
  type ModuleSwitch,
} from '@/domain/models/audit';
import { categoryLabel, findPortalModule, sensitivityLabel } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import type { AuditLogRepository, ModuleSwitchRepository } from '@/domain/ports/audit';

export interface ModuleSwitchVM {
  moduleId: string;
  nameZh: string;
  categoryLabel: string;
  sensitivityLabel: string;
  requiresConsent: boolean;
  enabled: boolean;
  updatedLabel: string;
  updatedBy: string;
}

export interface AuditLogVM {
  id: string;
  occurredLabel: string;
  occurredAt: string;
  actorLabel: string;
  maskedActorId: string;
  roleLabel: string;
  actionLabel: string;
  moduleId: string;
  moduleLabel: string;
  target: string;
  result: 'allowed' | 'denied';
  resultLabel: string;
  sensitivityLabel: string;
  reason?: string;
  traceId: string;
  ip?: string;
}

export interface AdminDashboardVM {
  switches: ModuleSwitchVM[];
  audit: AuditLogVM[];
  enabledCount: number;
  disabledCount: number;
  deniedCount: number;
  consentGatedCount: number;
  auditedModuleCount: number;
}

export function toModuleSwitchVM(item: ModuleSwitch, now: Date): ModuleSwitchVM {
  // 注意：变量名不能叫 `module`（Next 的 @next/next/no-assign-module-variable）
  const mod = findPortalModule(PORTAL_MODULES, item.moduleId);
  return {
    moduleId: item.moduleId,
    nameZh: mod?.nameZh ?? item.moduleId,
    categoryLabel: mod ? categoryLabel(mod.category) : '未知',
    sensitivityLabel: sensitivityLabel(item.sensitivity),
    requiresConsent: item.requiresConsent,
    enabled: item.enabled,
    updatedLabel: formatRelativeTime(item.updatedAt, now) || '时间未知',
    updatedBy: item.updatedBy,
  };
}

export function toAuditLogVM(entry: AuditLogEntry, now: Date): AuditLogVM {
  const mod = findPortalModule(PORTAL_MODULES, entry.moduleId);
  return {
    id: entry.id,
    occurredLabel: formatRelativeTime(entry.occurredAt, now) || '时间未知',
    occurredAt: entry.occurredAt,
    actorLabel: entry.anonymized ? '匿名主体' : AUDIT_ROLE_LABELS[entry.actorRole],
    maskedActorId: maskActorId(entry.actorId),
    roleLabel: AUDIT_ROLE_LABELS[entry.actorRole],
    actionLabel: AUDIT_ACTION_LABELS[entry.action],
    moduleId: entry.moduleId,
    moduleLabel: mod?.nameZh ?? entry.moduleId,
    target: `${entry.targetType}#${entry.targetId}`,
    result: entry.result,
    resultLabel: entry.result === 'allowed' ? '允许' : '拒绝',
    sensitivityLabel: sensitivityLabel(entry.sensitivity),
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    traceId: entry.traceId,
    ...(entry.ip === undefined ? {} : { ip: entry.ip }),
  };
}

export function toAdminDashboardVM(
  switches: readonly ModuleSwitch[],
  audit: readonly AuditLogEntry[],
  now: Date,
): AdminDashboardVM {
  const switchVMs = switches.map((s) => toModuleSwitchVM(s, now));
  const auditVMs = sortAuditDesc(audit).map((e) => toAuditLogVM(e, now));
  return {
    switches: switchVMs,
    audit: auditVMs,
    enabledCount: switchVMs.filter((s) => s.enabled).length,
    disabledCount: switchVMs.filter((s) => !s.enabled).length,
    deniedCount: auditVMs.filter((a) => a.result === 'denied').length,
    consentGatedCount: switchVMs.filter((s) => s.requiresConsent).length,
    auditedModuleCount: PORTAL_MODULES.filter((m) => m.audited).length,
  };
}

export interface AdminRepositories {
  moduleSwitches: ModuleSwitchRepository;
  auditLog: AuditLogRepository;
}

export async function loadAdminDashboard(
  repositories: AdminRepositories,
  now: Date = new Date(),
): Promise<Result<AdminDashboardVM, ApiError>> {
  const [switchesResult, auditResult] = await Promise.all([
    repositories.moduleSwitches.list(),
    repositories.auditLog.list(),
  ]);

  if (!switchesResult.ok) return err(switchesResult.error);
  if (!auditResult.ok) return err(auditResult.error);

  return ok(toAdminDashboardVM(switchesResult.value, auditResult.value, now));
}

/** 后台操作者（占位：真实实现必须来自契约 §5 第一级身份层） */
export const DEMO_ADMIN_ACTOR: { id: string; role: AuditActorRole } = {
  id: 'u_admin_01',
  role: 'admin',
};
