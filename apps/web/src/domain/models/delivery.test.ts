import { describe, expect, it } from 'vitest';

import { MODULES } from '@kedaya/contracts';

import { DEFAULT_DELIVERY, deliveryOf, deliveryStageLabel, isDelivered } from './delivery';
import { decorateModule, validateModuleRegistry } from './module';
import {
  API_ONLY_MODULES,
  DELIVERED_MODULES,
  MINIAPP_MODULES,
  PORTAL_MODULES,
  WEB_READY_MODULES,
} from './modules';

/**
 * 交付状态规格。
 *
 * 这组断言锁的不是"代码能跑"，而是**门户有没有说真话**：
 * 标了 Web 已上线就得真有页面，标了小程序已上线的就得真在小程序里交付过。
 * 交付了新模块没更新 `delivery.ts`，这里会红 —— 这是刻意的。
 */
describe('模块交付状态', () => {
  it('Web 已上线的模块必须有真实路由，且 href 指向它', () => {
    expect(WEB_READY_MODULES.map((m) => m.id)).toEqual(['groupbuy']);
    for (const mod of WEB_READY_MODULES) {
      expect(mod.delivery.webHref).toBeDefined();
      expect(mod.href).toBe(mod.delivery.webHref);
      expect(mod.delivery.note).toBeTruthy();
    }
  });

  it('小程序已上线的模块 = 20 个契约模块里除 facility / groupbuy 之外的 18 个', () => {
    // 这份清单必须与小程序 `MODULE_ENTRY_PATHS`（真实有页面的模块）逐条对齐：
    // 端上真的做了才列进来，没做就老实留在 api-only —— 端上页面数对不上这里会红。
    expect(MINIAPP_MODULES.map((m) => m.id).sort()).toEqual([
      'ai-portrait',
      'auth',
      'buddy',
      'campus-card',
      'canteen',
      'dorm-harmony',
      'errand',
      'faq',
      'flea-market',
      'forum',
      'lost-found',
      'notifications',
      'profile',
      'schedule',
      'takeout-guard',
      'techpie',
      'wellbeing',
      'wildlife',
    ]);
    for (const mod of MINIAPP_MODULES) {
      // 小程序模块在 Web 上没有页面，必须去说明页
      expect(mod.href).toBe(`/m/${mod.id}`);
      expect(mod.delivery.webHref).toBeUndefined();
      expect(mod.delivery.note).toBeTruthy();
    }
  });

  it('只剩 facility（场馆预约）没有端上页面，仍如实标为 api-only', () => {
    expect(API_ONLY_MODULES).toHaveLength(MODULES.length - DELIVERED_MODULES.length);
    expect(API_ONLY_MODULES.map((m) => m.id)).toEqual(['facility']);
    for (const mod of API_ONLY_MODULES) {
      expect(mod.delivery.stage).toBe('api-only');
      expect(mod.href).toBe(`/m/${mod.id}`);
      expect(isDelivered(mod.delivery)).toBe(false);
    }
  });

  it('未登记的模块走 api-only 兜底（新增模块不会让首页崩溃）', () => {
    expect(deliveryOf('brand-new')).toEqual(DEFAULT_DELIVERY);
    expect(deliveryOf('brand-new').stage).toBe('api-only');
    expect(deliveryOf('brand-new').webHref).toBeUndefined();
  });

  it('状态文案', () => {
    expect(deliveryStageLabel('web')).toBe('Web 已上线');
    expect(deliveryStageLabel('miniapp')).toBe('小程序已上线');
    expect(deliveryStageLabel('api-only')).toBe('接口就绪');
  });

  it('注册表整体自洽（含交付状态与 href 的一致性）', () => {
    expect(validateModuleRegistry(PORTAL_MODULES, MODULES)).toEqual([]);
  });

  it('validateModuleRegistry 能抓出"标了 Web 已上线却没有页面"', () => {
    const lying = [decorateModule({ ...MODULES[0]! })];
    // 伪造一条声称 Web 已上线、但 webHref 与 href 对不上的条目
    lying[0] = {
      ...lying[0]!,
      delivery: { stage: 'web', note: '假装可用' },
    };
    const problems = validateModuleRegistry(lying, MODULES);
    expect(problems.some((p) => p.includes('却没有 webHref'))).toBe(true);
  });
});
