import { describe, expect, it } from 'vitest';
import {
  CAMPUS_WEB_ENTRY_TARGETS,
  PHASE2_BLOCKED_REASON,
  PHASE_BLOCKED_REASON,
  TECHPIE_CAPABILITIES,
  buildCapabilities,
  countUnbound,
  resolveCapabilityStatus,
} from './capabilities';

/**
 * 规格 §3.1（能力 → 模块映射）+ §8.1 端点 6（能力清单）
 * + 裁决 §11.18-C/D（诚实性）+ **§11.20-D / §11.21-F（键名收敛）**
 *
 * 这组测试盯住三件事：
 *   1. **不编造能力** —— 校园网（U1）与 Piazza/CourseBench（N3）**不得出现**；
 *   2. **不假装 Phase 1–3 只是"待接线"** —— 它们的阻塞原因必须明确可读；
 *   3. **一个字段只有一个名字** —— 加法兼容别名必须**不存在**。
 */

const EMPTY: readonly { provider: 'ecard' | 'cpdaily'; status: string }[] = [];

/** wire 条目上**允许出现**的键（§11.20-D / §11.21-F 收敛后的唯一集合） */
const ALLOWED_KEYS = new Set([
  'key',
  'moduleId',
  'nameZh',
  'summary',
  'phase',
  'access',
  'requiredProvider',
  'targetUrl',
  'available',
  'blockedReason',
]);

/** 本轮**删除**的加法兼容别名（§11.20-D 裁决：全部移除） */
const REMOVED_ALIASES = ['id', 'platform', 'status', 'guidance'] as const;

describe('能力清单（规格 §3.1 / §8.1 端点 6 / §11.20-D 收敛）', () => {
  it('不编造"校园网"能力（U1：当前 clone 的 TechPie master 上没有）', () => {
    const text = JSON.stringify(TECHPIE_CAPABILITIES);
    expect(text).not.toContain('校园网');
    expect(text).not.toContain('srun');
    expect(text).not.toContain('drcom');
  });

  it('不出现 TechPie 自身未实现的能力（N3：Piazza / CourseBench / elearning）', () => {
    const keys = TECHPIE_CAPABILITIES.map((item) => item.key).join('|');
    expect(keys).not.toMatch(/piazza|coursebench|elearning|gradescope|hydro/i);
  });

  it('不出现 gradescope / hydro（U13 建议 M4 再评估，且不在 §11.20-C 枚举里）', () => {
    for (const item of TECHPIE_CAPABILITIES) {
      expect(['cas', 'egate', 'cpdaily', 'jwc', 'ecard', 'techpie', null]).toContain(
        item.requiredProvider,
      );
    }
  });

  it('每条能力都归到某个契约模块 id（不留悬空）', () => {
    const known = new Set([
      'campus-card',
      'schedule',
      'techpie',
      'facility',
      'auth',
      'profile',
      'forum',
    ]);
    for (const item of TECHPIE_CAPABILITIES) {
      expect(known.has(item.moduleId)).toBe(true);
    }
  });

  it('能力 key 唯一（避免客户端按 key 索引时撞车）', () => {
    const keys = TECHPIE_CAPABILITIES.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /* ---------------- 状态推导 ---------------- */

  it('Phase 0 + 需要绑定 + 未绑定 → CAMPUS_BINDING_REQUIRED（**不是错误**）', () => {
    expect(resolveCapabilityStatus({ phase: 'phase0', requiredProvider: 'ecard' }, EMPTY)).toBe(
      'CAMPUS_BINDING_REQUIRED',
    );
  });

  it('Phase 0 + 已绑定（ACTIVE）→ AVAILABLE', () => {
    expect(
      resolveCapabilityStatus({ phase: 'phase0', requiredProvider: 'ecard' }, [
        { provider: 'ecard', status: 'ACTIVE' },
      ]),
    ).toBe('AVAILABLE');
  });

  it('Phase 0 + 绑定非 ACTIVE（§11.19-A 的其余四态）→ EXPIRED（引导重绑，**不导致登出**）', () => {
    for (const status of ['EXPIRED', 'REVOKED', 'PENDING', 'FAILED']) {
      expect(
        resolveCapabilityStatus({ phase: 'phase0', requiredProvider: 'ecard' }, [
          { provider: 'ecard', status },
        ]),
      ).toBe('EXPIRED');
    }
  });

  it('不需要绑定的 Phase 0 能力（WebView 直连）→ AVAILABLE', () => {
    expect(resolveCapabilityStatus({ phase: 'phase0', requiredProvider: null }, EMPTY)).toBe(
      'AVAILABLE',
    );
  });

  it('Phase 1/2 → PHASE_BLOCKED，且**优先于**绑定判定（未开放的能力不该提示去绑定）', () => {
    expect(resolveCapabilityStatus({ phase: 'phase1', requiredProvider: 'cpdaily' }, EMPTY)).toBe(
      'PHASE_BLOCKED',
    );
    // 即使"已绑定"也仍然阻塞 —— 因为该通道根本不存在
    expect(
      resolveCapabilityStatus({ phase: 'phase2', requiredProvider: 'cpdaily' }, [
        { provider: 'cpdaily', status: 'ACTIVE' },
      ]),
    ).toBe('PHASE_BLOCKED');
  });

  /* ---------------- 投影 ---------------- */

  it('未绑定时：`available: false` + 引导文案（是"下一步做什么"，不是报错信息）', () => {
    const items = buildCapabilities(TECHPIE_CAPABILITIES, EMPTY);
    const balance = items.find((item) => item.key === 'ecard.balance')!;

    expect(balance.available).toBe(false);
    expect(balance.blockedReason).toContain('校园一卡通');
    expect(balance.blockedReason).toContain('可选');
    expect(balance.blockedReason).not.toMatch(/错误|失败|异常/);
  });

  it('已过期时：引导文案明确说明**登录状态不受影响**（失败模式 F2）', () => {
    const items = buildCapabilities(TECHPIE_CAPABILITIES, [{ provider: 'ecard', status: 'EXPIRED' }]);
    const balance = items.find((item) => item.key === 'ecard.balance')!;

    expect(balance.available).toBe(false);
    expect(balance.blockedReason).toContain('登录状态不受影响');
  });

  it('被阻塞的能力带**明确**的阻塞原因，不含糊成"暂不可用"', () => {
    const items = buildCapabilities(TECHPIE_CAPABILITIES, EMPTY);
    const blocked = items.filter((item) => item.phase !== 'phase0');

    expect(blocked.length).toBeGreaterThan(0);
    for (const item of blocked) {
      expect(item.available).toBe(false);
      expect(item.blockedReason).toContain('书面');
      expect(item.blockedReason).not.toMatch(/暂不可用|敬请期待|维护中/);
    }
    expect(blocked.some((item) => item.blockedReason === PHASE_BLOCKED_REASON)).toBe(true);
    expect(blocked.some((item) => item.blockedReason === PHASE2_BLOCKED_REASON)).toBe(true);
  });

  /* ---------------- §11.20-D / §11.21-F：别名必须消失 ---------------- */

  it('加法兼容别名**一个都不存在**（`id` / `platform` / `status` / `guidance`）', () => {
    const items = buildCapabilities(TECHPIE_CAPABILITIES, EMPTY);
    for (const item of items) {
      for (const alias of REMOVED_ALIASES) {
        expect(Object.keys(item)).not.toContain(alias);
      }
    }
  });

  it('条目上只出现收敛后的键（没有第五种拼法偷偷加进来）', () => {
    const items = buildCapabilities(TECHPIE_CAPABILITIES, EMPTY);
    for (const item of items) {
      for (const key of Object.keys(item)) {
        expect(ALLOWED_KEYS.has(key)).toBe(true);
      }
    }
  });

  it('§11.22-D：可空的可选字段为空时**省略键**，不下发 `null`', () => {
    const items = buildCapabilities(TECHPIE_CAPABILITIES, EMPTY);
    for (const item of items) {
      // 不出现 `null` 值
      for (const value of Object.values(item)) {
        expect(value).not.toBeNull();
      }
      // WebView 条目不需要绑定 → `requiredProvider` 整个键不出现
      if (item.access === 'webview') expect('requiredProvider' in item).toBe(false);
      // 可用的条目没有阻塞原因 → `blockedReason` 整个键不出现
      if (item.available) expect('blockedReason' in item).toBe(false);
    }
  });

  it('`countUnbound` 与条目上的 `available: false` + 需要绑定一致', () => {
    const items = buildCapabilities(TECHPIE_CAPABILITIES, EMPTY);
    const needsBinding = items.filter(
      (item) => !item.available && item.requiredProvider !== undefined && item.phase === 'phase0',
    ).length;
    expect(countUnbound(TECHPIE_CAPABILITIES, EMPTY)).toBe(needsBinding);
    expect(countUnbound(TECHPIE_CAPABILITIES, EMPTY)).toBeGreaterThan(0);
  });

  it('WebView 能力都带 targetUrl，且**都来自白名单**（由 target-url.spec 双向校验）', () => {
    const webviews = TECHPIE_CAPABILITIES.filter((item) => item.access === 'webview');
    expect(webviews.length).toBeGreaterThanOrEqual(4);
    for (const item of webviews) {
      expect(item.targetUrl).toBeTruthy();
      expect(item.targetUrl!.startsWith('https://')).toBe(true);
      expect(Object.values(CAMPUS_WEB_ENTRY_TARGETS)).toContain(item.targetUrl);
    }
  });

  it('能力清单**不含任何凭证键名**（I1 的镜像：它也会被序列化给客户端）', () => {
    const items = buildCapabilities(TECHPIE_CAPABILITIES, EMPTY);
    const keys = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        for (const [key, child] of Object.entries(node)) {
          keys.add(key.toLowerCase());
          walk(child);
        }
      }
    };
    walk(items);

    for (const forbidden of ['cookie', 'cookies', 'session', 'sessiontoken', 'tgc', 'castgc', 'ticket', 'tenant']) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });
});
