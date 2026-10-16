import { describe, expect, it } from 'vitest';

import {
  auditSummary,
  canToggleModule,
  enabledModuleIds,
  filterAuditLog,
  groupAuditByModule,
  maskActorId,
  sortAuditDesc,
  toggleModule,
  type AuditLogEntry,
  type ModuleSwitch,
} from './audit';

const NOW = new Date('2026-10-16T10:00:00.000Z');

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 'aud-1',
    occurredAt: '2026-10-16T09:00:00.000Z',
    actorId: 'u_8f2a1c9d',
    actorRole: 'student',
    anonymized: false,
    action: 'read',
    moduleId: 'wellbeing',
    targetType: 'appointment',
    targetId: 'appt-1',
    sensitivity: 'critical',
    result: 'allowed',
    traceId: 'trc-1',
    ...overrides,
  };
}

function makeSwitch(overrides: Partial<ModuleSwitch> = {}): ModuleSwitch {
  return {
    moduleId: 'ai-portrait',
    enabled: true,
    updatedAt: '2026-10-16T09:00:00.000Z',
    updatedBy: 'u_admin_01',
    sensitivity: 'high',
    requiresConsent: true,
    ...overrides,
  };
}

describe('审计记录（契约 §9：谁 / 何时 / 对哪条记录 / 什么动作）', () => {
  it('maskActorId 脱敏主体标识', () => {
    expect(maskActorId('u_8f2a1c9d')).toBe('u_8f****9d');
    expect(maskActorId('abc')).toBe('***');
  });

  it('auditSummary 覆盖四个要素', () => {
    const summary = auditSummary(makeEntry());
    expect(summary).toContain('wellbeing/appointment#appt-1');
    expect(summary).toContain('读取');
    expect(summary).toContain('允许');
    expect(summary).toContain('2026-10-16T09:00:00.000Z');
  });

  it('匿名主体在摘要里标注「匿名」', () => {
    expect(auditSummary(makeEntry({ anonymized: true }))).toContain('匿名');
  });

  it('filterAuditLog 支持模块 / 角色 / 仅拒绝 / 仅同意', () => {
    const entries = [
      makeEntry({ id: 'a', moduleId: 'wellbeing', result: 'allowed' }),
      makeEntry({ id: 'b', moduleId: 'ai-portrait', result: 'denied' }),
      makeEntry({
        id: 'c',
        moduleId: 'dorm-harmony',
        action: 'consent_granted',
        actorRole: 'counselor',
      }),
    ];
    expect(filterAuditLog(entries, { moduleId: 'ai-portrait' }).map((e) => e.id)).toEqual(['b']);
    expect(filterAuditLog(entries, { onlyDenied: true }).map((e) => e.id)).toEqual(['b']);
    expect(filterAuditLog(entries, { actorRole: 'counselor' }).map((e) => e.id)).toEqual(['c']);
    expect(filterAuditLog(entries, { onlyConsent: true }).map((e) => e.id)).toEqual(['c']);
  });

  it('groupAuditByModule 按模块聚合', () => {
    const grouped = groupAuditByModule([
      makeEntry({ id: 'a', moduleId: 'wellbeing' }),
      makeEntry({ id: 'b', moduleId: 'wellbeing' }),
      makeEntry({ id: 'c', moduleId: 'forum' }),
    ]);
    expect(grouped.wellbeing).toHaveLength(2);
    expect(grouped.forum).toHaveLength(1);
  });

  it('sortAuditDesc 最新在前', () => {
    const sorted = sortAuditDesc([
      makeEntry({ id: 'old', occurredAt: '2026-10-14T09:00:00.000Z' }),
      makeEntry({ id: 'new', occurredAt: '2026-10-16T09:00:00.000Z' }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['new', 'old']);
  });
});

describe('模块开关权限（契约 §9：敏感模块仅管理员可改）', () => {
  it('管理员可改任意敏感级', () => {
    expect(canToggleModule('admin', 'critical')).toBe(true);
    expect(canToggleModule('admin', 'low')).toBe(true);
  });

  it('学生只能改低/中敏感模块', () => {
    expect(canToggleModule('student', 'low')).toBe(true);
    expect(canToggleModule('student', 'medium')).toBe(true);
    expect(canToggleModule('student', 'high')).toBe(false);
    expect(canToggleModule('student', 'critical')).toBe(false);
  });

  it('系统主体不能改开关', () => {
    expect(canToggleModule('system', 'low')).toBe(false);
  });
});

describe('toggleModule 纯函数', () => {
  it('管理员切换成功并写入 updatedAt / updatedBy（不可变）', () => {
    const before = [makeSwitch()];
    const outcome = toggleModule(before, 'ai-portrait', false, { id: 'u_admin_02', role: 'admin' }, NOW);
    expect(outcome.changed).toBe(true);
    expect(outcome.switches[0]?.enabled).toBe(false);
    expect(outcome.switches[0]?.updatedAt).toBe(NOW.toISOString());
    expect(outcome.switches[0]?.updatedBy).toBe('u_admin_02');
    expect(before[0]?.enabled).toBe(true);
  });

  it('学生改高敏感模块被拒，原状态不变', () => {
    const before = [makeSwitch()];
    const outcome = toggleModule(before, 'ai-portrait', false, { id: 'u_stu', role: 'student' }, NOW);
    expect(outcome.changed).toBe(false);
    expect(outcome.deniedReason).toContain('仅管理员');
    expect(outcome.switches[0]?.enabled).toBe(true);
  });

  it('值未变化时 changed=false', () => {
    const outcome = toggleModule([makeSwitch()], 'ai-portrait', true, { id: 'u_admin', role: 'admin' }, NOW);
    expect(outcome.changed).toBe(false);
    expect(outcome.deniedReason).toBeUndefined();
  });

  it('未知模块返回拒绝原因', () => {
    const outcome = toggleModule([makeSwitch()], 'nope', true, { id: 'u_admin', role: 'admin' }, NOW);
    expect(outcome.changed).toBe(false);
    expect(outcome.deniedReason).toContain('未知模块');
  });

  it('enabledModuleIds 过滤已启用', () => {
    expect(
      enabledModuleIds([
        makeSwitch({ moduleId: 'a', enabled: true }),
        makeSwitch({ moduleId: 'b', enabled: false }),
      ]),
    ).toEqual(['a']);
  });
});
