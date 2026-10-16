/**
 * 管理后台 HTTP 仓储（审计日志 + 模块开关）。
 *
 * 审计是只读的（后端不允许改审计）；模块开关是写操作，走 PATCH。
 * 注意：审计/开关不在契约 §6.1 的模块 CRUD 前缀表里，这里用的是管理域路径
 * `/api/v1/admin/*` —— 见 README「与契约的偏差」。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import type { AuditActorRole, AuditLogEntry, ModuleSwitch } from '@/domain/models/audit';
import type { AuditLogRepository, ModuleSwitchRepository } from '@/domain/ports/audit';

import type { ApiClient } from '../api/client';
import { safeParseAuditLog, safeParseModuleSwitches } from '../schemas/audit';
import { toApiError } from './groupbuy.http';

export const AUDIT_PATH = '/admin/audit-logs';
export const MODULE_SWITCH_PATH = '/admin/modules';

export function createAuditLogHttpRepository(client: ApiClient): AuditLogRepository {
  return {
    async list(): Promise<Result<AuditLogEntry[], ApiError>> {
      const result = await client.get<unknown>(AUDIT_PATH);
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseAuditLog(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的审计日志不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },
  };
}

export function createModuleSwitchHttpRepository(client: ApiClient): ModuleSwitchRepository {
  return {
    async list(): Promise<Result<ModuleSwitch[], ApiError>> {
      const result = await client.get<unknown>(MODULE_SWITCH_PATH);
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseModuleSwitches(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的模块开关不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },

    async toggle(
      moduleId: string,
      enabled: boolean,
      actor: { id: string; role: AuditActorRole },
    ): Promise<Result<ModuleSwitch[], ApiError>> {
      const result = await client.patch<unknown>(
        `${MODULE_SWITCH_PATH}/${encodeURIComponent(moduleId)}`,
        { enabled },
        { idempotencyKey: `module-toggle-${moduleId}-${String(enabled)}`, headers: { 'X-KedaYa-Actor': actor.id } },
      );
      if (!result.ok) return err(toApiError(result.error));

      const parsed = safeParseModuleSwitches(result.value);
      if (!parsed.ok) {
        return err({
          code: 'INTERNAL',
          message: '后端返回的模块开关不符合冻结契约',
          details: { issues: parsed.issues },
        });
      }
      return ok(parsed.value);
    },
  };
}
