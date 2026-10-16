/**
 * 审计日志 & 模块开关 mock 数据（契约 §9）。
 * 覆盖：敏感模块读写、同意授予/撤回、被拒访问、匿名主体。
 */
import type { AuditLogEntry, ModuleSwitch } from '@/domain/models/audit';
import { PORTAL_MODULES } from '@/domain/models/modules';

function iso(base: Date, deltaMs: number): string {
  return new Date(base.getTime() + deltaMs).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export function createAuditSeed(now: Date): AuditLogEntry[] {
  return [
    {
      id: 'aud-9001',
      occurredAt: iso(now, -12 * MINUTE),
      actorId: 'u_8f2a1c9d',
      actorRole: 'counselor',
      anonymized: false,
      action: 'read',
      moduleId: 'wellbeing',
      targetType: 'appointment',
      targetId: 'appt-3301',
      sensitivity: 'critical',
      result: 'allowed',
      traceId: 'trc-9f31c2a4',
      ip: '10.20.3.14',
    },
    {
      id: 'aud-9002',
      occurredAt: iso(now, -48 * MINUTE),
      actorId: 'u_5b77e0aa',
      actorRole: 'student',
      anonymized: true,
      action: 'consent_granted',
      moduleId: 'dorm-harmony',
      targetType: 'consent',
      targetId: 'consent-dorm-2',
      sensitivity: 'high',
      result: 'allowed',
      traceId: 'trc-2b77aa10',
      ip: '10.20.7.88',
    },
    {
      id: 'aud-9003',
      occurredAt: iso(now, -2 * HOUR),
      actorId: 'u_1c33d4ef',
      actorRole: 'student',
      anonymized: false,
      action: 'read',
      moduleId: 'ai-portrait',
      targetType: 'portrait',
      targetId: 'portrait-self',
      sensitivity: 'high',
      result: 'denied',
      reason: '未授予二次同意（CONSENT_REQUIRED）',
      traceId: 'trc-77c1de03',
      ip: '10.20.9.31',
    },
    {
      id: 'aud-9004',
      occurredAt: iso(now, -5 * HOUR),
      actorId: 'u_admin_01',
      actorRole: 'admin',
      anonymized: false,
      action: 'module_toggled',
      moduleId: 'ai-portrait',
      targetType: 'module-switch',
      targetId: 'ai-portrait',
      sensitivity: 'high',
      result: 'allowed',
      reason: '默认关闭 AI 画像，等待合规评审',
      traceId: 'trc-51aa0bb2',
      ip: '10.20.1.5',
    },
    {
      id: 'aud-9005',
      occurredAt: iso(now, -26 * HOUR),
      actorId: 'u_9a10bb32',
      actorRole: 'student',
      anonymized: false,
      action: 'consent_revoked',
      moduleId: 'wellbeing',
      targetType: 'consent',
      targetId: 'consent-wb-7',
      sensitivity: 'critical',
      result: 'allowed',
      traceId: 'trc-0d92ff41',
      ip: '10.20.4.19',
    },
    {
      id: 'aud-9006',
      occurredAt: iso(now, -2 * 24 * HOUR),
      actorId: 'system',
      actorRole: 'system',
      anonymized: false,
      action: 'export',
      moduleId: 'takeout-guard',
      targetType: 'credit-record',
      targetId: 'batch-2026-10-14',
      sensitivity: 'medium',
      result: 'denied',
      reason: '导出需管理员双人复核',
      traceId: 'trc-33aa77c9',
    },
  ];
}

export function createModuleSwitchSeed(now: Date): ModuleSwitch[] {
  const updatedAt = iso(now, -5 * HOUR);
  return PORTAL_MODULES.map((module) => ({
    moduleId: module.id,
    // 合规默认：需要二次同意的模块与 AI 画像默认关闭
    enabled: !module.requiresConsent,
    updatedAt,
    updatedBy: 'u_admin_01',
    sensitivity: module.sensitivity,
    requiresConsent: module.requiresConsent,
  }));
}
