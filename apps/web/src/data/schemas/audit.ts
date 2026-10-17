/**
 * 审计 / 模块开关传输层校验（zod）。
 * 契约 §9：审计字段「谁、何时、对哪条记录、什么动作」缺一不可。
 */
import { z } from 'zod';

import type { AuditLogEntry, ModuleSwitch } from '@/domain/models/audit';

type AssertAssignable<From extends To, To> = true;

export const auditActionSchema = z.enum([
  'read',
  'create',
  'update',
  'delete',
  'export',
  'login',
  'consent_granted',
  'consent_revoked',
  'module_toggled',
]);

export const auditActorRoleSchema = z.enum(['student', 'staff', 'counselor', 'admin', 'system']);

export const sensitivitySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const auditLogEntrySchema = z.object({
  id: z.string().min(1),
  occurredAt: z.iso.datetime(),
  actorId: z.string().min(1),
  actorRole: auditActorRoleSchema,
  anonymized: z.boolean(),
  action: auditActionSchema,
  moduleId: z.string().min(1),
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  sensitivity: sensitivitySchema,
  result: z.enum(['allowed', 'denied']),
  reason: z.string().optional(),
  traceId: z.string().min(1),
  ip: z.string().optional(),
});

export const moduleSwitchSchema = z.object({
  moduleId: z.string().min(1),
  enabled: z.boolean(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.string().min(1),
  sensitivity: sensitivitySchema,
  requiresConsent: z.boolean(),
});

export const auditLogListSchema = z.array(auditLogEntrySchema);
export const moduleSwitchListSchema = z.array(moduleSwitchSchema);

export type __AuditEntryMatches = AssertAssignable<
  z.infer<typeof auditLogEntrySchema>,
  AuditLogEntry
>;
export type __AuditEntryDomainIsSchema = AssertAssignable<
  AuditLogEntry,
  z.infer<typeof auditLogEntrySchema>
>;
export type __ModuleSwitchMatches = AssertAssignable<
  z.infer<typeof moduleSwitchSchema>,
  ModuleSwitch
>;

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export function safeParseAuditLog(
  input: unknown,
): { ok: true; value: AuditLogEntry[] } | { ok: false; issues: string[] } {
  const result = auditLogListSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: formatZodIssues(result.error) };
}

export function safeParseModuleSwitches(
  input: unknown,
): { ok: true; value: ModuleSwitch[] } | { ok: false; issues: string[] } {
  const result = moduleSwitchListSchema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: formatZodIssues(result.error) };
}
