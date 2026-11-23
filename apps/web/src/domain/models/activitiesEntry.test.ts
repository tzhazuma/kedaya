import { describe, expect, it } from 'vitest';

import { deliveryOf } from './delivery';
import { ACTIVITIES_PORTAL_ENTRY, PORTAL_MODULES } from './modules';

/**
 * 校园活动是**独立功能域**（不与 deadlines 混表），但契约已把它登记为
 * 第 25 个模块。入口必须从注册表 / 交付状态 / 装饰表派生，不能在页面里硬编码。
 *
 * 特别注意：`activities` 仍然是独立域 —— 它不能把活动塞进课程 DDL 的
 * `deadlines` 模块，也不能绕过 candidate → confirmed 的确认门。
 */
describe('校园活动入口', () => {
  it('交付状态如实标注 Web + 小程序双端，并指向 /import 的活动区', () => {
    const delivery = deliveryOf('activities');
    expect(delivery.stage).toBe('web-and-miniapp');
    expect(delivery.webHref).toBe('/import#campus-activities');
    expect(delivery.note).toContain('导出');
    expect(delivery.note).toContain('不保存');
    expect(delivery.note).toContain('列表');
  });

  it('入口复用模块注册表的装饰（图标 / 强调色），落点与交付状态一致', () => {
    expect(ACTIVITIES_PORTAL_ENTRY.nameZh).toBe('校园活动');
    expect(ACTIVITIES_PORTAL_ENTRY.icon).toBe('calendar-days');
    expect(ACTIVITIES_PORTAL_ENTRY.accent).toBe('brand');
    expect(ACTIVITIES_PORTAL_ENTRY.href).toBe('/import#campus-activities');
    expect(ACTIVITIES_PORTAL_ENTRY.delivery).toEqual(deliveryOf('activities'));
  });

  it('已登记为契约模块，但不是 deadlines 的别名', () => {
    const entry = PORTAL_MODULES.find((candidate) => candidate.id === 'activities');
    expect(entry).toBeDefined();
    expect(entry?.nameZh).toBe('校园活动');
    expect(entry?.id).not.toBe('deadlines');
    expect(PORTAL_MODULES.find((candidate) => candidate.id === 'deadlines')).toBeDefined();
  });
});
