import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_SCOPES,
  CAPABILITY_SCOPE_LABELS,
  TRUST_BOUNDARY_DESCRIPTIONS,
  TRUST_CAPABILITY_MATRIX,
  TRUST_LEVELS,
  TRUST_LEVEL_LABELS,
  allowedCapabilitiesFor,
  assertCapabilityAllowed,
  describeTrustBoundary,
  isCapabilityAllowed,
  isCapabilityScope,
  isTrustLevel,
  validateServiceCapabilities,
  type CapabilityScope,
  type TrustLevel,
} from './campus-service-trust';
import { isCapabilityAllowed as isCapabilityAllowedViaIndex } from './index';

/**
 * 预期的「信任 × 能力」判定表。
 *
 * ⚠️ 这张表是**独立手写**的，不是从 `TRUST_CAPABILITY_MATRIX` 反推的：
 * 如果测试直接读实现里的矩阵，那么把某一格误改成 `true` 时测试也会跟着变，
 * 等于没有测试。下面这 20 格是政策本身。
 */
const EXPECTED_ALLOWED: Readonly<Record<TrustLevel, readonly CapabilityScope[]>> = {
  'first-party': ['read-public', 'read-personal', 'write-personal'],
  'audited-third-party': ['read-public'],
  unverified: [],
  blocked: [],
};

const MATRIX_CASES = TRUST_LEVELS.flatMap((trust) =>
  CAPABILITY_SCOPES.map((capability) => ({
    trust,
    capability,
    allowed: EXPECTED_ALLOWED[trust].includes(capability),
  })),
);

/** 内部枚举名、英文标识与技术黑话都不该出现在给用户看的文案里 */
const TECH_JARGON = /[A-Za-z]|信任等级|能力|权限|矩阵|凭据|范围|插件|字段/;

describe('TrustLevel / CapabilityScope 枚举', () => {
  it('信任等级恰好四个，能力恰好五项', () => {
    expect([...TRUST_LEVELS]).toEqual([
      'first-party',
      'audited-third-party',
      'unverified',
      'blocked',
    ]);
    expect([...CAPABILITY_SCOPES]).toEqual([
      'read-public',
      'read-personal',
      'write-personal',
      'network-egress',
      'credential-access',
    ]);
  });

  it('每个取值都有中文标签，且标签不含内部标识', () => {
    expect(Object.keys(TRUST_LEVEL_LABELS).sort()).toEqual([...TRUST_LEVELS].sort());
    expect(Object.keys(CAPABILITY_SCOPE_LABELS).sort()).toEqual([...CAPABILITY_SCOPES].sort());

    for (const label of [
      ...Object.values(TRUST_LEVEL_LABELS),
      ...Object.values(CAPABILITY_SCOPE_LABELS),
    ]) {
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(TECH_JARGON);
    }
  });

  it('运行时类型守卫会拒绝未知取值', () => {
    expect(isTrustLevel('first-party')).toBe(true);
    expect(isTrustLevel('first_party')).toBe(false);
    expect(isTrustLevel(null)).toBe(false);
    expect(isCapabilityScope('read-public')).toBe(true);
    expect(isCapabilityScope('read_public')).toBe(false);
    expect(isCapabilityScope(42)).toBe(false);
  });
});

describe('判定矩阵的每一个格子（4 × 5 = 20）', () => {
  it('矩阵结构完整，没有漏格或多格', () => {
    expect(Object.keys(TRUST_CAPABILITY_MATRIX).sort()).toEqual([...TRUST_LEVELS].sort());
    for (const trust of TRUST_LEVELS) {
      expect(Object.keys(TRUST_CAPABILITY_MATRIX[trust]).sort()).toEqual(
        [...CAPABILITY_SCOPES].sort(),
      );
      for (const capability of CAPABILITY_SCOPES) {
        expect(typeof TRUST_CAPABILITY_MATRIX[trust][capability]).toBe('boolean');
      }
    }
    expect(MATRIX_CASES).toHaveLength(20);
  });

  it.each(MATRIX_CASES)(
    '$trust × $capability → $allowed',
    ({ trust, capability, allowed }) => {
      expect(isCapabilityAllowed(trust, capability)).toBe(allowed);
    },
  );

  it('未知的来源或未知的能力一律拒绝（fail closed）', () => {
    expect(isCapabilityAllowed('root' as TrustLevel, 'read-public')).toBe(false);
    expect(isCapabilityAllowed(undefined as unknown as TrustLevel, 'read-public')).toBe(false);
    expect(isCapabilityAllowed('first-party', 'read-everything' as CapabilityScope)).toBe(false);
    expect(isCapabilityAllowed('first-party', null as unknown as CapabilityScope)).toBe(false);
  });

  it('allowedCapabilitiesFor 与矩阵一致', () => {
    for (const trust of TRUST_LEVELS) {
      expect([...allowedCapabilitiesFor(trust)]).toEqual([...EXPECTED_ALLOWED[trust]]);
    }
    expect(allowedCapabilitiesFor('nobody' as TrustLevel)).toEqual([]);
  });
});

describe('🔒 credential-access：无论多信任都不允许', () => {
  it.each(TRUST_LEVELS)('%s 也不能接触校园账号密码', (trust) => {
    expect(isCapabilityAllowed(trust, 'credential-access')).toBe(false);
    expect(() => assertCapabilityAllowed(trust, 'credential-access')).toThrow(
      /校园账号密码/,
    );
  });

  it('第一方也不例外，错误信息说明凭据只能留在用户设备上', () => {
    expect(isCapabilityAllowed('first-party', 'credential-access')).toBe(false);
    expect(() => assertCapabilityAllowed('first-party', 'credential-access')).toThrow(
      /只能留在你自己的设备上/,
    );
  });

  it('凭据违规在列表里单列一个错误码，便于界面强调', () => {
    const result = validateServiceCapabilities({
      trust: 'first-party',
      capabilities: ['credential-access'],
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      code: 'credential-access-forbidden',
      capability: 'credential-access',
    });
  });
});

describe('assertCapabilityAllowed', () => {
  it('允许的组合不抛错', () => {
    expect(() => assertCapabilityAllowed('first-party', 'read-public')).not.toThrow();
    expect(() => assertCapabilityAllowed('first-party', 'read-personal')).not.toThrow();
    expect(() => assertCapabilityAllowed('first-party', 'write-personal')).not.toThrow();
    expect(() => assertCapabilityAllowed('audited-third-party', 'read-public')).not.toThrow();
  });

  it('拒绝时错误信息说清「谁不能做什么」', () => {
    const error = (() => {
      try {
        assertCapabilityAllowed('audited-third-party', 'read-personal');
        return null;
      } catch (caught) {
        return caught as Error;
      }
    })();

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('查看你的个人数据');
    expect(error?.message).toContain('已经通过安全检查的外部代码');
  });

  it('未审核 / 被禁止的来源，错误信息给出下一步', () => {
    expect(() => assertCapabilityAllowed('unverified', 'read-public')).toThrow(/请先完成检查/);
    expect(() => assertCapabilityAllowed('blocked', 'read-public')).toThrow(/禁止使用/);
  });

  it('网络出口不会因为信任而顺带获得', () => {
    expect(() => assertCapabilityAllowed('first-party', 'network-egress')).toThrow(
      /需要单独征得你的同意/,
    );
  });

  it('未知取值给出明确的「未知」错误，而不是静默放行', () => {
    expect(() =>
      assertCapabilityAllowed('root' as TrustLevel, 'read-public'),
    ).toThrow(/未知的来源可信度/);
    expect(() =>
      assertCapabilityAllowed('first-party', 'root' as CapabilityScope),
    ).toThrow(/未知的能力/);
  });
});

describe('validateServiceCapabilities：返回列表，不抛异常', () => {
  it('全部允许时 ok: true、违规为空', () => {
    const result = validateServiceCapabilities({
      trust: 'first-party',
      capabilities: ['read-public', 'read-personal', 'write-personal'],
    });
    expect(result).toEqual({ ok: true, violations: [] });
  });

  it('空能力申报总是通过（不申报就不授予）', () => {
    for (const trust of TRUST_LEVELS) {
      expect(validateServiceCapabilities({ trust, capabilities: [] })).toEqual({
        ok: true,
        violations: [],
      });
    }
  });

  it('⚠️ 能同时报出多条违规，并保持申报顺序', () => {
    const result = validateServiceCapabilities({
      trust: 'audited-third-party',
      capabilities: [
        'read-public',
        'read-personal',
        'network-egress',
        'credential-access',
        'write-personal',
      ],
    });

    expect(result.ok).toBe(false);
    // read-public 合法，其余四项违规（其中 credential 单独成码）。
    expect(result.violations.map((item) => item.capability)).toEqual([
      'read-personal',
      'network-egress',
      'credential-access',
      'write-personal',
    ]);
    expect(result.violations.map((item) => item.code)).toEqual([
      'capability-denied',
      'capability-denied',
      'credential-access-forbidden',
      'capability-denied',
    ]);
    // 每条文案都不同：调用方可以逐条展示，而不是重复同一句。
    expect(new Set(result.violations.map((item) => item.message)).size).toBe(4);
  });

  it('未审核来源申报多项能力 → 全部列为违规', () => {
    const capabilities: readonly CapabilityScope[] = [
      'read-public',
      'read-personal',
      'write-personal',
      'network-egress',
      'credential-access',
    ];
    const result = validateServiceCapabilities({ trust: 'unverified', capabilities });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(capabilities.length);
  });

  it('被禁止的来源申报任何能力都不通过', () => {
    const result = validateServiceCapabilities({
      trust: 'blocked',
      capabilities: ['read-public'],
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatchObject({ code: 'capability-denied' });
  });

  it('校验本身不抛异常（调用方负责展示违规）', () => {
    expect(() =>
      validateServiceCapabilities({
        trust: 'unverified',
        capabilities: ['read-personal', 'credential-access'],
      }),
    ).not.toThrow();
  });
});

describe('中文文案面向用户，不含技术黑话', () => {
  it.each(TRUST_LEVELS)('%s 的来源描述是一句人话', (trust) => {
    const text = describeTrustBoundary(trust);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(TECH_JARGON);
    expect(text.endsWith('。')).toBe(true);
    // 「来自哪里、能碰什么」两件事都要说到。
    expect(text).toContain('这段代码');
    expect(text).toContain('校园账号密码');
  });

  it('允许的能力要在描述里说，禁止的也要说', () => {
    const first = describeTrustBoundary('first-party');
    expect(first).toContain('公开信息');
    expect(first).toContain('个人数据');
    expect(first).toContain('不会把数据发到校外');

    const audited = describeTrustBoundary('audited-third-party');
    expect(audited).toContain('只能查看公开信息');
    expect(audited).toContain('不能查看或修改你的个人数据');

    for (const trust of ['unverified', 'blocked'] as const) {
      expect(describeTrustBoundary(trust)).toContain('不能查看或修改');
    }
  });

  it('未知信任等级按最严格的描述处理（fail closed）', () => {
    expect(describeTrustBoundary('nobody' as TrustLevel)).toBe(
      TRUST_BOUNDARY_DESCRIPTIONS.blocked,
    );
  });

  it.each(TRUST_LEVELS)('%s 的每条违规文案都是中文人话', (trust) => {
    const result = validateServiceCapabilities({
      trust,
      capabilities: ['read-personal', 'write-personal', 'network-egress', 'credential-access'],
    });
    for (const violation of result.violations) {
      expect(violation.message).not.toMatch(TECH_JARGON);
      expect(violation.message.endsWith('。')).toBe(true);
    }
  });

  it('凭据违规文案解释「为什么永远不行」', () => {
    const result = validateServiceCapabilities({
      trust: 'first-party',
      capabilities: ['credential-access'],
    });
    const message = result.violations[0]?.message ?? '';
    expect(message).toContain('永远不能');
    expect(message).toContain('设备');
  });
});

describe('从 index 导出（三端共用的唯一入口）', () => {
  it('isCapabilityAllowed 可以从 @kedaya/contracts 根导入', () => {
    expect(isCapabilityAllowedViaIndex).toBe(isCapabilityAllowed);
    expect(isCapabilityAllowedViaIndex('first-party', 'read-public')).toBe(true);
    expect(isCapabilityAllowedViaIndex('first-party', 'credential-access')).toBe(false);
  });
});
