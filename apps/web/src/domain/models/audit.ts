/**
 * 审计与模块开关领域模型（契约 §9）。
 *
 * §9 硬规则：敏感模块读写全部落审计日志 —— 「谁、何时、对哪条记录、什么动作」。
 * 本文件把这些字段固化成模型，并提供纯函数派生（脱敏、摘要、过滤）。
 */
import type { Sensitivity } from '@kedaya/contracts';

/** 审计动作 */
export type AuditAction =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'export'
  | 'login'
  | 'consent_granted'
  | 'consent_revoked'
  | 'module_toggled';

export type AuditActorRole = 'student' | 'staff' | 'counselor' | 'admin' | 'system';

export type AuditResult = 'allowed' | 'denied';

/**
 * 一条审计记录。
 * 「谁」= actorId + actorRole + anonymized；「何时」= occurredAt；
 * 「对哪条记录」= moduleId + targetType + targetId；「什么动作」= action + result。
 */
export interface AuditLogEntry {
  id: string;
  /** ISO-8601 UTC */
  occurredAt: string;
  /** 脱敏后的主体标识（匿名主体与实名身份解耦） */
  actorId: string;
  actorRole: AuditActorRole;
  /** 主体是否为匿名身份 */
  anonymized: boolean;
  action: AuditAction;
  /** 冻结模块 key（契约 §4） */
  moduleId: string;
  targetType: string;
  targetId: string;
  sensitivity: Sensitivity;
  result: AuditResult;
  /** 拒绝原因 / 备注 */
  reason?: string;
  /** 链路追踪 id，与响应信封的 traceId 对齐 */
  traceId: string;
  /** 仅记录内网网段，最小化采集 */
  ip?: string;
}

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  read: '读取',
  create: '创建',
  update: '更新',
  delete: '删除',
  export: '导出',
  login: '登录',
  consent_granted: '授予同意',
  consent_revoked: '撤回同意',
  module_toggled: '模块开关',
};

export const AUDIT_ROLE_LABELS: Record<AuditActorRole, string> = {
  student: '学生',
  staff: '教工',
  counselor: '心理/调解专员',
  admin: '管理员',
  system: '系统',
};

/** 脱敏：只保留前 4 位与后 2 位 */
export function maskActorId(actorId: string): string {
  if (actorId.length <= 6) return '***';
  return `${actorId.slice(0, 4)}****${actorId.slice(-2)}`;
}

/** 一行中文摘要，管理后台表格与日志导出共用 */
export function auditSummary(entry: AuditLogEntry): string {
  const actor = entry.anonymized ? `${maskActorId(entry.actorId)}（匿名）` : maskActorId(entry.actorId);
  const verdict = entry.result === 'allowed' ? '允许' : '拒绝';
  return `${AUDIT_ROLE_LABELS[entry.actorRole]} ${actor} 于 ${entry.occurredAt} 对 ${entry.moduleId}/${entry.targetType}#${entry.targetId} 执行 ${AUDIT_ACTION_LABELS[entry.action]}（${verdict}）`;
}

export interface AuditFilter {
  moduleId?: string;
  actorRole?: AuditActorRole;
  onlyDenied?: boolean;
  /** 只看同意相关（合规巡检） */
  onlyConsent?: boolean;
}

export function filterAuditLog(
  entries: readonly AuditLogEntry[],
  filter: AuditFilter,
): AuditLogEntry[] {
  return entries.filter((e) => {
    if (filter.moduleId && e.moduleId !== filter.moduleId) return false;
    if (filter.actorRole && e.actorRole !== filter.actorRole) return false;
    if (filter.onlyDenied && e.result !== 'denied') return false;
    if (filter.onlyConsent && e.action !== 'consent_granted' && e.action !== 'consent_revoked') {
      return false;
    }
    return true;
  });
}

/** 按模块聚合，用于后台概览 */
export function groupAuditByModule(
  entries: readonly AuditLogEntry[],
): Record<string, AuditLogEntry[]> {
  const acc: Record<string, AuditLogEntry[]> = {};
  for (const entry of entries) {
    (acc[entry.moduleId] ??= []).push(entry);
  }
  return acc;
}

/** 时间倒序（最新在前） */
export function sortAuditDesc(entries: readonly AuditLogEntry[]): AuditLogEntry[] {
  return [...entries].sort((a, b) => {
    const ta = new Date(a.occurredAt).getTime();
    const tb = new Date(b.occurredAt).getTime();
    const va = Number.isNaN(ta) ? 0 : ta;
    const vb = Number.isNaN(tb) ? 0 : tb;
    return vb - va;
  });
}

/* ------------------------------------------------------------------ *
 * 模块开关（管理后台占位）
 * ------------------------------------------------------------------ */

export interface ModuleSwitch {
  moduleId: string;
  enabled: boolean;
  /** ISO-8601 UTC */
  updatedAt: string;
  updatedBy: string;
  sensitivity: Sensitivity;
  requiresConsent: boolean;
}

export const MODULE_SWITCH_BLOCKED_REASON = '敏感模块的开关仅管理员可操作';

/** 谁能改开关：只有 admin（敏感模块尤其如此，契约 §9） */
export function canToggleModule(role: AuditActorRole, sensitivity: Sensitivity): boolean {
  if (role === 'admin') return true;
  if (role === 'system') return false;
  return sensitivity === 'low' || sensitivity === 'medium';
}

export interface ToggleOutcome {
  switches: ModuleSwitch[];
  changed: boolean;
  deniedReason?: string;
}

/**
 * 纯函数式开关：返回新数组（不可变），并记录 updatedAt / updatedBy。
 * 无权限时原样返回并给出拒绝原因。
 */
export function toggleModule(
  switches: readonly ModuleSwitch[],
  moduleId: string,
  enabled: boolean,
  actor: { id: string; role: AuditActorRole },
  now: Date,
): ToggleOutcome {
  const index = switches.findIndex((s) => s.moduleId === moduleId);
  if (index < 0) {
    return { switches: [...switches], changed: false, deniedReason: `未知模块：${moduleId}` };
  }
  const target = switches[index];
  if (!target) {
    return { switches: [...switches], changed: false, deniedReason: `未知模块：${moduleId}` };
  }
  if (!canToggleModule(actor.role, target.sensitivity)) {
    return { switches: [...switches], changed: false, deniedReason: MODULE_SWITCH_BLOCKED_REASON };
  }
  if (target.enabled === enabled) {
    return { switches: [...switches], changed: false };
  }
  const next: ModuleSwitch = {
    ...target,
    enabled,
    updatedAt: now.toISOString(),
    updatedBy: actor.id,
  };
  const copy = [...switches];
  copy[index] = next;
  return { switches: copy, changed: true };
}

export function enabledModuleIds(switches: readonly ModuleSwitch[]): string[] {
  return switches.filter((s) => s.enabled).map((s) => s.moduleId);
}
