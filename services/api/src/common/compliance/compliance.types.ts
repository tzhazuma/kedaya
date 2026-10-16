import type { Page } from '@kedaya/contracts';

/* ------------------------------------------------------------------ *
 * 审计（契约 §9：敏感模块读写全部落审计日志）
 * ------------------------------------------------------------------ */

export type ActorType = 'user' | 'anonymous' | 'system' | 'service';

export interface AuditEntry {
  actorId?: string | null;
  actorType?: ActorType;
  /** 领域动作，如 wellbeing.appointment.create */
  action: string;
  /** 资源类型，如 WellbeingAppointment */
  resource: string;
  resourceId?: string | null;
  /** 契约 §4 模块 id */
  module?: string | null;
  ip?: string | null;
  ua?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditRecord extends AuditEntry {
  id: string;
  at: Date;
}

export interface AuditListParams {
  module?: string;
  actorId?: string;
  resource?: string;
  cursor?: string;
  limit: number;
}

export interface AuditRepository {
  append(entry: AuditEntry): Promise<AuditRecord>;
  list(params: AuditListParams): Promise<Page<AuditRecord>>;
}

export const AUDIT_REPOSITORY = Symbol('KEDAYA_AUDIT_REPOSITORY');

/* ------------------------------------------------------------------ *
 * 二次同意（契约 §9：敏感模块独立同意，可随时撤回）
 * ------------------------------------------------------------------ */

export interface ConsentRecord {
  id: string;
  userId: string;
  module: string;
  version: string;
  grantedAt: Date;
  revokedAt: Date | null;
}

export interface ConsentMeta {
  ip?: string | null;
  ua?: string | null;
  version?: string;
}

export interface ConsentRepository {
  /** 仅返回**未撤回**的同意记录 */
  findActive(userId: string, module: string): Promise<ConsentRecord | null>;
  /** 同意（幂等：已存在则刷新 grantedAt 并清空 revokedAt） */
  upsertGrant(userId: string, module: string, meta: ConsentMeta): Promise<ConsentRecord>;
  /** 撤回（幂等） */
  revoke(userId: string, module: string): Promise<ConsentRecord | null>;
  listByUser(userId: string): Promise<ConsentRecord[]>;
}

export const CONSENT_REPOSITORY = Symbol('KEDAYA_CONSENT_REPOSITORY');
