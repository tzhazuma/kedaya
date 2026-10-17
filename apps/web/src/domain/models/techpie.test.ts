/**
 * TechPie 领域模型测试 —— 覆盖契约 §11.18 的**硬约束**。
 *
 * 重点：
 * 1. 契约 §11.4 I1 的 8 个禁用凭证键名（负向断言）；
 * 2. 契约 §11.18-B 的**域名白名单 fail-closed**（https / 无 userinfo / 无 IP /
 *    无非默认端口 / **不允许通配子域**）；
 * 3. `CAMPUS_BINDING_REQUIRED` / `EXPIRED` 是**引导**而不是错误（ADR §5.4）；
 * 4. 契约 §11.10-B 的平台枚举逐字对齐。
 */
import { describe, expect, it } from 'vitest';

import {
  CAMPUS_PLATFORM_LABELS,
  CAMPUS_PLATFORM_PHASE,
  CAMPUS_PLATFORMS,
  CAMPUS_TARGET_ALLOWLIST,
  CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER,
  CAMPUS_TARGET_ALLOWLIST_NOTE,
  FORBIDDEN_CREDENTIAL_KEYS,
  PAYMENT_CODE_TTL_SEC,
  TECHPIE_BIND_HREF,
  boundPlatforms,
  capabilityGuidance,
  checkCampusTargetUrl,
  findForbiddenCredentialKeys,
  hasForbiddenCredentialKeys,
  isActiveLink,
  isAllowedCampusTargetUrl,
  isPaymentCodeExpired,
  isPhase0Platform,
  paymentCodeRemainingSec,
  type CampusBindingSummary,
  type TechpieCapability,
} from './techpie';

function makeCapability(overrides: Partial<TechpieCapability> = {}): TechpieCapability {
  return {
    id: 'ecard.balance',
    moduleId: 'campus-card',
    nameZh: '校园卡余额',
    summary: '一卡通余额。',
    phase: 'phase0',
    access: 'openid',
    platform: 'ecard',
    targetUrl: null,
    status: 'CAMPUS_BINDING_REQUIRED',
    guidance: null,
    ...overrides,
  };
}

describe('凭证键名禁令（契约 §11.4 I1）', () => {
  it('恰好是契约列出的 8 个键名', () => {
    expect([...FORBIDDEN_CREDENTIAL_KEYS].sort()).toEqual([
      'castgc',
      'cookie',
      'cookies',
      'session',
      'sessionToken',
      'tenant',
      'tgc',
      'ticket',
    ]);
    expect(FORBIDDEN_CREDENTIAL_KEYS).toHaveLength(8);
  });

  it('干净的绑定摘要零命中', () => {
    const summary: CampusBindingSummary = {
      id: 'lk-1',
      platform: 'ecard',
      status: 'LINKED',
      externalUserId: '2023XXXXXX',
      expiresAt: null,
      lastSyncAt: null,
    };
    expect(findForbiddenCredentialKeys(summary)).toEqual([]);
    expect(hasForbiddenCredentialKeys(summary)).toBe(false);
  });

  it('嵌套结构里的禁用键也能抓出来（大小写 / 下划线不敏感）', () => {
    const dirty = {
      items: [{ platform: 'cpdaily', meta: { session_token: 'x' } }],
      CASTGC: 'y',
      ticket: 'wvt_1',
    };
    expect(findForbiddenCredentialKeys(dirty)).toEqual(['castgc', 'sessionToken', 'ticket']);
    expect(hasForbiddenCredentialKeys(dirty)).toBe(true);
  });
});

describe('平台枚举（契约 §11.10-B 逐字冻结）', () => {
  it('取值集合与契约一致', () => {
    expect([...CAMPUS_PLATFORMS].sort()).toEqual(['cas', 'cpdaily', 'ecard', 'egate', 'techpie']);
  });

  it('每个平台都有中文名与阶段', () => {
    for (const platform of CAMPUS_PLATFORMS) {
      expect(CAMPUS_PLATFORM_LABELS[platform].length).toBeGreaterThan(0);
      expect(['phase0', 'phase1', 'phase2']).toContain(CAMPUS_PLATFORM_PHASE[platform]);
    }
  });

  it('Phase 0 只有校园卡（走独立 OPENID 通道）', () => {
    expect(isPhase0Platform('ecard')).toBe(true);
    expect(isPhase0Platform('egate')).toBe(false);
    expect(isPhase0Platform('cpdaily')).toBe(false);
    expect(isPhase0Platform('cas')).toBe(false);
    expect(isPhase0Platform('techpie')).toBe(false);
  });

  it('规格 §4.3 的 gradescope / hydro **不在**冻结枚举里（不得私自扩枚举）', () => {
    expect(CAMPUS_PLATFORMS as readonly string[]).not.toContain('gradescope');
    expect(CAMPUS_PLATFORMS as readonly string[]).not.toContain('hydro');
  });
});

describe('校园域名白名单 fail-closed（契约 §11.18-B）', () => {
  it('白名单内容标注为占位，且机器可见', () => {
    expect(CAMPUS_TARGET_ALLOWLIST_IS_PLACEHOLDER).toBe(true);
    expect(CAMPUS_TARGET_ALLOWLIST_NOTE).toContain('占位');
    expect(CAMPUS_TARGET_ALLOWLIST.length).toBeGreaterThan(0);
  });

  it('白名单里的域名本身都能通过校验', () => {
    for (const host of CAMPUS_TARGET_ALLOWLIST) {
      expect(checkCampusTargetUrl(`https://${host}/`)).toEqual({ allowed: true, reason: 'OK' });
    }
  });

  it('只允许 https', () => {
    expect(checkCampusTargetUrl('http://ecourse.shanghaitech.edu.cn/').reason).toBe('NOT_HTTPS');
    expect(checkCampusTargetUrl('javascript:alert(1)').reason).toBe('NOT_HTTPS');
  });

  it('拒绝 @ 形式的 userinfo（经典绕过）', () => {
    expect(checkCampusTargetUrl('https://shanghaitech.edu.cn@evil.com/').reason).toBe('HAS_USERINFO');
    expect(checkCampusTargetUrl('https://ecourse.shanghaitech.edu.cn@evil.com/').reason).toBe(
      'HAS_USERINFO',
    );
  });

  it('拒绝 IP 字面量与非默认端口', () => {
    expect(checkCampusTargetUrl('https://10.0.0.1/').reason).toBe('IP_LITERAL');
    expect(checkCampusTargetUrl('https://127.0.0.1/').reason).toBe('IP_LITERAL');
    expect(checkCampusTargetUrl('https://ecourse.shanghaitech.edu.cn:8443/').reason).toBe(
      'NON_DEFAULT_PORT',
    );
  });

  it('**不允许通配整个 shanghaitech.edu.cn**（会放行任意子域）', () => {
    expect(checkCampusTargetUrl('https://shanghaitech.edu.cn/').reason).toBe('NOT_ALLOWLISTED');
    expect(checkCampusTargetUrl('https://attacker.shanghaitech.edu.cn/').reason).toBe(
      'NOT_ALLOWLISTED',
    );
    expect(checkCampusTargetUrl('https://evil.com/').reason).toBe('NOT_ALLOWLISTED');
    // 前缀混淆也不行
    expect(checkCampusTargetUrl('https://ecourse.shanghaitech.edu.cn.evil.com/').reason).toBe(
      'NOT_ALLOWLISTED',
    );
  });

  it('畸形输入一律拒绝（不抛异常）', () => {
    expect(checkCampusTargetUrl('').reason).toBe('MALFORMED');
    expect(checkCampusTargetUrl('not a url').reason).toBe('MALFORMED');
    expect(isAllowedCampusTargetUrl('   ')).toBe(false);
  });

  it('带路径 / 查询串的白名单域名仍然放行（路径不是白名单的判定依据）', () => {
    expect(isAllowedCampusTargetUrl('https://oa.shanghaitech.edu.cn/activity?x=1')).toBe(true);
  });
});

describe('绑定状态与能力引导（契约 §5 硬规则 3 / ADR §5.4）', () => {
  it('只有 LINKED 算"可用绑定"', () => {
    expect(isActiveLink({ status: 'LINKED' })).toBe(true);
    expect(isActiveLink({ status: 'LINKING' })).toBe(false);
    expect(isActiveLink({ status: 'EXPIRED' })).toBe(false);
  });

  it('boundPlatforms 把 LINKING 也算进来（绑定中不该再发起一次）', () => {
    const bound = boundPlatforms([
      { id: 'a', platform: 'ecard', status: 'LINKED', externalUserId: null, expiresAt: null, lastSyncAt: null },
      { id: 'b', platform: 'cpdaily', status: 'LINKING', externalUserId: null, expiresAt: null, lastSyncAt: null },
      { id: 'c', platform: 'egate', status: 'EXPIRED', externalUserId: null, expiresAt: null, lastSyncAt: null },
    ]);
    expect([...bound].sort()).toEqual(['cpdaily', 'ecard']);
  });

  it('CAMPUS_BINDING_REQUIRED → 引导（needsBinding + 去绑定），不是错误', () => {
    const guidance = capabilityGuidance(makeCapability());
    expect(guidance.needsBinding).toBe(true);
    expect(guidance.bindHref).toBe(TECHPIE_BIND_HREF);
    expect(guidance.text).toContain('绑定');
    expect(guidance.text).not.toContain('失败');
    expect(guidance.text).not.toContain('错误');
  });

  it('EXPIRED → 明确说明"登录不受影响"（校园会话失效 ≠ 登录过期）', () => {
    const guidance = capabilityGuidance(makeCapability({ status: 'EXPIRED' }));
    expect(guidance.needsBinding).toBe(true);
    expect(guidance.text).toContain('登录状态不受影响');
  });

  it('PHASE_BLOCKED → 如实说明阻塞于书面回复，且不给绑定入口', () => {
    const guidance = capabilityGuidance(
      makeCapability({ phase: 'phase1', status: 'PHASE_BLOCKED', platform: 'cpdaily' }),
    );
    expect(guidance.needsBinding).toBe(false);
    expect(guidance.bindHref).toBeNull();
    expect(guidance.text).toContain('信息办');
    expect(guidance.text).toContain('书面');
  });

  it('UPSTREAM_UNAVAILABLE → 不谎称数据是最新的', () => {
    const guidance = capabilityGuidance(makeCapability({ status: 'UPSTREAM_UNAVAILABLE' }));
    expect(guidance.needsBinding).toBe(false);
    expect(guidance.text).toContain('不会谎称');
  });
});

describe('付款码 TTL（规格 §3.3 / 06-roadmap A1.6）', () => {
  const now = new Date('2026-10-17T10:00:00.000Z');
  const code = {
    expiresAt: new Date(now.getTime() + PAYMENT_CODE_TTL_SEC * 1000).toISOString(),
  };

  it('TTL 是 60 秒', () => {
    expect(PAYMENT_CODE_TTL_SEC).toBe(60);
  });

  it('未到期时给出剩余秒数', () => {
    expect(paymentCodeRemainingSec(code, now)).toBe(60);
    expect(isPaymentCodeExpired(code, now)).toBe(false);
  });

  it('到期后剩余 0 秒且判定为已过期', () => {
    const later = new Date(now.getTime() + 61_000);
    expect(paymentCodeRemainingSec(code, later)).toBe(0);
    expect(isPaymentCodeExpired(code, later)).toBe(true);
  });

  it('非法时间视为已过期（fail-closed，不把坏数据当有效码）', () => {
    expect(isPaymentCodeExpired({ expiresAt: 'not-a-date' }, now)).toBe(true);
    expect(paymentCodeRemainingSec({ expiresAt: 'not-a-date' }, now)).toBe(0);
  });
});
