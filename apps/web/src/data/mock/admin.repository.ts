/**
 * 管理后台 mock 适配器（审计日志 + 模块开关）。
 *
 * 契约 §9：敏感模块的写操作**必须落审计**。因此这里的 `toggle` 不是单纯改状态，
 * 而是「权限判定 → 改状态 → 追加审计记录」三步，被拒时也记一条 denied。
 */
import type { ApiError, ApiErrorCode } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import {
  canToggleModule,
  MODULE_SWITCH_BLOCKED_REASON,
  toggleModule,
} from '@/domain/models/audit';
import type { AuditActorRole, AuditLogEntry, ModuleSwitch } from '@/domain/models/audit';
import type { AuditLogRepository, ModuleSwitchRepository } from '@/domain/ports/audit';

import { safeParseAuditLog, safeParseModuleSwitches } from '../schemas/audit';
import { createAuditSeed, createModuleSwitchSeed } from './fixtures/audit';

export interface MockAdminOptions {
  now?: () => Date;
  latencyMs?: number;
  /** 故障演练：'error' 时返回 UPSTREAM_UNAVAILABLE */
  failureMode?: 'none' | 'error';
}

export interface MockAdminRepositories {
  auditLog: AuditLogRepository;
  moduleSwitches: ModuleSwitchRepository;
  /** 当前内存中的审计条数（供页面显示"本次会话新增 N 条"） */
  auditCount(): number;
}

function apiError(code: ApiErrorCode, message: string, details?: unknown): ApiError {
  return details === undefined ? { code, message } : { code, message, details };
}

export function createMockAdminRepositories(
  options: MockAdminOptions = {},
): MockAdminRepositories {
  const now = options.now ?? (() => new Date());
  const latencyMs = options.latencyMs ?? 180;
  const failureMode = options.failureMode ?? 'none';

  let audit: AuditLogEntry[] = createAuditSeed(now());
  let switches: ModuleSwitch[] = createModuleSwitchSeed(now());
  let auditSeq = audit.length;

  const delay = async (): Promise<void> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
  };

  const failIfNeeded = (): ApiError | null =>
    failureMode === 'error'
      ? apiError('UPSTREAM_UNAVAILABLE', '管理后台服务暂时不可用（mock 故障演练）')
      : null;

  const appendAudit = (entry: Omit<AuditLogEntry, 'id' | 'occurredAt' | 'traceId'>): void => {
    auditSeq += 1;
    audit = [
      {
        ...entry,
        id: `aud-mock-${auditSeq}`,
        occurredAt: now().toISOString(),
        traceId: `trc-mock-${auditSeq}`,
      },
      ...audit,
    ];
  };

  const auditLog: AuditLogRepository = {
    async list(): Promise<Result<AuditLogEntry[], ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const parsed = safeParseAuditLog(audit);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', 'mock 审计数据不符合契约', { issues: parsed.issues }));
      }
      return ok(parsed.value);
    },
  };

  const moduleSwitches: ModuleSwitchRepository = {
    async list(): Promise<Result<ModuleSwitch[], ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const parsed = safeParseModuleSwitches(switches);
      if (!parsed.ok) {
        return err(
          apiError('INTERNAL', 'mock 模块开关数据不符合契约', { issues: parsed.issues }),
        );
      }
      return ok(parsed.value);
    },

    async toggle(
      moduleId: string,
      enabled: boolean,
      actor: { id: string; role: AuditActorRole },
    ): Promise<Result<ModuleSwitch[], ApiError>> {
      await delay();
      const failure = failIfNeeded();
      if (failure) return err(failure);

      const target = switches.find((s) => s.moduleId === moduleId);
      if (!target) return err(apiError('NOT_FOUND', `未知模块：${moduleId}`));

      if (!canToggleModule(actor.role, target.sensitivity)) {
        appendAudit({
          actorId: actor.id,
          actorRole: actor.role,
          anonymized: false,
          action: 'module_toggled',
          moduleId,
          targetType: 'module-switch',
          targetId: moduleId,
          sensitivity: target.sensitivity,
          result: 'denied',
          reason: MODULE_SWITCH_BLOCKED_REASON,
        });
        return err(apiError('FORBIDDEN', MODULE_SWITCH_BLOCKED_REASON));
      }

      const outcome = toggleModule(switches, moduleId, enabled, actor, now());
      switches = outcome.switches;

      if (outcome.changed) {
        appendAudit({
          actorId: actor.id,
          actorRole: actor.role,
          anonymized: false,
          action: 'module_toggled',
          moduleId,
          targetType: 'module-switch',
          targetId: moduleId,
          sensitivity: target.sensitivity,
          result: 'allowed',
          reason: enabled ? '启用模块' : '停用模块',
        });
      }

      const parsed = safeParseModuleSwitches(switches);
      if (!parsed.ok) {
        return err(apiError('INTERNAL', '模块开关数据不符合契约', { issues: parsed.issues }));
      }
      return ok(parsed.value);
    },
  };

  return {
    auditLog,
    moduleSwitches,
    auditCount: () => audit.length,
  };
}
