import { describe, expect, it } from 'vitest';
import {
  CAMPUS_WEB_ENTRY_TARGETS,
  PHASE2_BLOCKED_REASON,
  PHASE_BLOCKED_REASON,
  TECHPIE_CAPABILITIES,
  buildCapabilities,
  resolveCapabilityStatus,
} from './capabilities';

/**
 * 规格 §3.1（能力 → 模块映射）+ §8.1 端点 6（能力清单）+ 裁决 §11.18-C/D
 *
 * 这组测试盯住两件**诚实性**要求：
 *   1. **不编造能力** —— 校园网（U1）与 Piazza/CourseBench（N3）**不得出现**；
 *   2. **不假装 Phase 1–3 只是"待接线"** —— 它们的阻塞原因必须明确可读。
 */

const EMPTY: readonly { platform: 'ecard' | 'cpdaily'; status: string }[] = [];

describe('能力清单（规格 §3.1 / §8.1 端点 6）', () => {
  it('不编造"校园网"能力（U1：当前 clone 的 TechPie master 上没有）', () => {
    const text = JSON.stringify(TECHPIE_CAPABILITIES);
    expect(text).not.toContain('校园网');
    expect(text).not.toContain('srun');
    expect(text).not.toContain('drcom');
  });

  it('不出现 TechPie 自身未实现的能力（N3：Piazza / CourseBench / elearning）', () => {
    const ids = TECHPIE_CAPABILITIES.map((item) => item.id).join('|');
    expect(ids).not.toMatch(/piazza|coursebench|elearning|gradescope|hydro/i);
  });

  it('不出现 gradescope / hydro（U13 建议 M4 再评估，且不在 §11.10-B 冻结枚举里）', () => {
    for (const item of TECHPIE_CAPABILITIES) {
      expect(['cas', 'egate', 'cpdaily', 'ecard', 'techpie', null]).toContain(item.platform);
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

  it('能力 id 唯一（避免客户端按 id 索引时撞车）', () => {
    const ids = TECHPIE_CAPABILITIES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /* ---------------- 状态推导 ---------------- */

  it('Phase 0 + 需要绑定 + 未绑定 → CAMPUS_BINDING_REQUIRED（**不是错误**）', () => {
    expect(resolveCapabilityStatus({ phase: 'phase0', platform: 'ecard' }, EMPTY)).toBe(
      'CAMPUS_BINDING_REQUIRED',
    );
  });

  it('Phase 0 + 已绑定 → AVAILABLE', () => {
    expect(
      resolveCapabilityStatus({ phase: 'phase0', platform: 'ecard' }, [
        { platform: 'ecard', status: 'LINKED' },
      ]),
    ).toBe('AVAILABLE');
  });

  it('Phase 0 + 绑定已过期 / 已解绑 → EXPIRED（引导重绑，**不导致登出**）', () => {
    for (const status of ['EXPIRED', 'REVOKED', 'UNLINKED', 'LINKING']) {
      expect(resolveCapabilityStatus({ phase: 'phase0', platform: 'ecard' }, [{ platform: 'ecard', status }])).toBe(
        'EXPIRED',
      );
    }
  });

  it('不需要绑定的 Phase 0 能力（WebView 直连）→ AVAILABLE', () => {
    expect(resolveCapabilityStatus({ phase: 'phase0', platform: null }, EMPTY)).toBe('AVAILABLE');
  });

  it('Phase 1/2 → PHASE_BLOCKED，且**优先于**绑定判定（未开放的能力不该提示去绑定）', () => {
    expect(resolveCapabilityStatus({ phase: 'phase1', platform: 'cpdaily' }, EMPTY)).toBe('PHASE_BLOCKED');
    // 即使"已绑定"也仍然阻塞 —— 因为该通道根本不存在
    expect(
      resolveCapabilityStatus({ phase: 'phase2', platform: 'cpdaily' }, [
        { platform: 'cpdaily', status: 'LINKED' },
      ]),
    ).toBe('PHASE_BLOCKED');
  });

  /* ---------------- 投影 ---------------- */

  it('未绑定时：状态 + 引导文案（是"下一步做什么"，不是报错信息）', () => {
    const items = buildCapabilities(TECHPIE_CAPABILITIES, EMPTY);
    const balance = items.find((item) => item.id === 'ecard.balance')!;

    expect(balance.status).toBe('CAMPUS_BINDING_REQUIRED');
    expect(balance.available).toBe(false);
    expect(balance.guidance).toContain('校园一卡通');
    expect(balance.guidance).toContain('可选');
    expect(balance.guidance).not.toMatch(/错误|失败|异常/);
  });

  it('已过期时：引导文案明确说明**登录状态不受影响**（失败模式 F2）', () => {
    const items = buildCapabilities(TECHPIE_CAPABILITIES, [{ platform: 'ecard', status: 'EXPIRED' }]);
    const balance = items.find((item) => item.id === 'ecard.balance')!;

    expect(balance.status).toBe('EXPIRED');
    expect(balance.guidance).toContain('登录状态不受影响');
  });

  it('被阻塞的能力带**明确**的阻塞原因，不含糊成"暂不可用"', () => {
    const items = buildCapabilities(TECHPIE_CAPABILITIES, EMPTY);
    const blocked = items.filter((item) => item.status === 'PHASE_BLOCKED');

    expect(blocked.length).toBeGreaterThan(0);
    for (const item of blocked) {
      expect(item.available).toBe(false);
      expect(item.guidance).toBe(item.blockedReason);
      expect(item.guidance).toContain('书面');
      expect(item.guidance).not.toMatch(/暂不可用|敬请期待|维护中/);
    }
    expect(blocked.some((item) => item.blockedReason === PHASE_BLOCKED_REASON)).toBe(true);
    expect(blocked.some((item) => item.blockedReason === PHASE2_BLOCKED_REASON)).toBe(true);
  });

  it('两套客户端字段形状都齐（并集：id/key、platform/requiredProvider、status/available）', () => {
    const items = buildCapabilities(TECHPIE_CAPABILITIES, EMPTY);
    for (const item of items) {
      expect(item.key).toBe(item.id);
      expect(item.requiredProvider).toBe(item.platform);
      expect(item.available).toBe(item.status === 'AVAILABLE');
      expect(item.blockedReason).toBe(item.guidance);
    }
  });

  it('WebView 能力都带 targetUrl，且**都来自白名单**（由 target-url.spec 双向校验）', () => {
    const webviews = TECHPIE_CAPABILITIES.filter((item) => item.access === 'webview');
    expect(webviews.length).toBeGreaterThanOrEqual(4);
    for (const item of webviews) {
      expect(item.targetUrl).not.toBeNull();
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
