import { describe, expect, it } from 'vitest';

import {
  allCampusServicesCapabilityClean,
  CAMPUS_SERVICES,
  campusServiceCapabilityAudit,
} from './campus-services';
import { isCapabilityAllowed } from './campus-service-trust';

/**
 * `campus-services.ts` 接上「信任 × 能力」矩阵后的护栏。
 *
 * 这些断言的意义不在于"现在全绿"，而在于**把现状钉住**：
 * 6 个校园服务都还没有书面授权、没有真实对接，所以它们必须全是 `unverified`，
 * 审计必须**如实报出**「需要读个人数据但未获准」。哪天有人悄悄把某个服务的
 * trust 提到 `first-party` 让自己看起来"已接通"，这里会红。
 */
describe('校园服务的信任 × 能力', () => {
  it('6 个服务都有 trust 与 declaredCapabilities', () => {
    expect(CAMPUS_SERVICES).toHaveLength(6);
    for (const service of CAMPUS_SERVICES) {
      expect(service.trust, service.platform).toBeTruthy();
      expect(Array.isArray(service.declaredCapabilities), service.platform).toBe(true);
    }
  });

  it('⚠️ 当前**全部**是 unverified —— 没有书面授权、没有真实对接', () => {
    for (const service of CAMPUS_SERVICES) {
      expect(service.trust, `${service.platform} 不该被标成可信`).toBe('unverified');
    }
  });

  it('⚠️ 没有任何服务声明 credential-access（凭据只能留在用户设备上）', () => {
    for (const service of CAMPUS_SERVICES) {
      expect(service.declaredCapabilities, service.platform).not.toContain('credential-access');
    }
    for (const row of campusServiceCapabilityAudit()) {
      expect(row.declaresCredentialAccess, row.platform).toBe(false);
    }
  });

  it('审计如实报出「需要读个人数据但未获准」—— 6 个都是', () => {
    const audit = campusServiceCapabilityAudit();
    expect(audit).toHaveLength(6);
    for (const row of audit) {
      expect(row.trust).toBe('unverified');
      expect(row.blockedCapabilities, row.platform).toContain('read-personal');
      expect(row.note.length).toBeGreaterThan(0);
    }
  });

  it('⚠️ 全体未通过是**正确的现状**，不是 bug', () => {
    // 这条断言读起来像"故意让它红"。它的作用是把"还没接通"这件事
    // 变成机器可见的事实：哪天有人误以为 6 个服务都好了，这里会提醒他。
    expect(allCampusServicesCapabilityClean()).toBe(false);
  });

  it('矩阵本身：unverified 一个能力都不允许', () => {
    for (const capability of ['read-public', 'read-personal', 'write-personal'] as const) {
      expect(isCapabilityAllowed('unverified', capability)).toBe(false);
    }
  });

  it('矩阵本身：credential-access 对 first-party 也不允许', () => {
    expect(isCapabilityAllowed('first-party', 'credential-access')).toBe(false);
  });
});
