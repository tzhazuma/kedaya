/**
 * 审计 / 模块开关端口（契约 §9）。
 * 管理后台占位页只读这两者；写操作留在 data 层，便于将来接真后端。
 */
import type { ApiError } from '@kedaya/contracts';
import type { Result } from '@kedaya/shared';

import type { AuditActorRole, AuditLogEntry, ModuleSwitch } from '../models/audit';

export interface AuditLogRepository {
  list(): Promise<Result<AuditLogEntry[], ApiError>>;
}

export interface ModuleSwitchRepository {
  list(): Promise<Result<ModuleSwitch[], ApiError>>;
  toggle(
    moduleId: string,
    enabled: boolean,
    actor: { id: string; role: AuditActorRole },
  ): Promise<Result<ModuleSwitch[], ApiError>>;
}
