import { describe, expect, it } from 'vitest';

import { BUSINESS_MODULES, CORE_MODULES, MODULES } from '@kedaya/contracts';

import {
  categoryLabel,
  decorateModule,
  findPortalModule,
  groupModulesByCategory,
  isAuditedSensitivity,
  moduleHref,
  sensitivityLabel,
  validateModuleRegistry,
} from './module';
import {
  AUDITED_MODULES,
  CONSENT_GATED_MODULES,
  PORTAL_MODULES,
  PORTAL_MODULE_COUNT,
  PORTAL_MODULE_GROUPS,
} from './modules';

describe('模块注册表（契约 §4 数据驱动）', () => {
  it('注册表与契约模块表一一对应', () => {
    // 契约 v1.2 §11.10-C 新增第 20 个模块 facility（场馆预约）
    // 之后新增第 21 个 deadlines（DDL 聚合），与 schedule 同属核心学业基础设施
    // 第 21 个 deadlines、第 22 个 campus-map 归核心模块；
    // 第 23 个 petition（众筹诉求）是业务模块。
    expect(PORTAL_MODULE_COUNT).toBe(23);
    expect(PORTAL_MODULES).toHaveLength(MODULES.length);
    expect(PORTAL_MODULES.map((m) => m.id)).toEqual(MODULES.map((m) => m.id));
  });

  it('validateModuleRegistry 报告零问题（无硬编码遗漏 / 无重复 / 无兜底装饰）', () => {
    expect(validateModuleRegistry(PORTAL_MODULES, MODULES)).toEqual([]);
  });

  it('模块 id 唯一，且覆盖全部 7 基础 + 16 业务', () => {
    const ids = PORTAL_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const mod of [...CORE_MODULES, ...BUSINESS_MODULES]) {
      expect(ids).toContain(mod.id);
    }
  });

  it('分类分组：7 基础 + 16 业务', () => {
    expect(PORTAL_MODULE_GROUPS.core).toHaveLength(7);
    expect(PORTAL_MODULE_GROUPS.business).toHaveLength(16);
    expect(groupModulesByCategory(PORTAL_MODULES).business).toHaveLength(16);
  });

  it('每个模块都有可用的门户路由与图标', () => {
    for (const mod of PORTAL_MODULES) {
      expect(mod.href.startsWith('/')).toBe(true);
      expect(mod.icon.length).toBeGreaterThan(0);
    }
    expect(findPortalModule(PORTAL_MODULES, 'groupbuy')?.href).toBe('/groupbuy');
    expect(moduleHref('forum')).toBe('/m/forum');
  });
});

describe('敏感级与同意门（契约 §9）', () => {
  it('需要二次同意的恰好是 wellbeing / dorm-harmony / ai-portrait', () => {
    expect(CONSENT_GATED_MODULES.map((m) => m.id).sort()).toEqual([
      'ai-portrait',
      'dorm-harmony',
      'wellbeing',
    ]);
  });

  it('auth / campus-card 属高敏感但**不设同意门**', () => {
    const auth = findPortalModule(PORTAL_MODULES, 'auth');
    const card = findPortalModule(PORTAL_MODULES, 'campus-card');
    expect(auth?.sensitivity).toBe('high');
    expect(auth?.requiresConsent).toBe(false);
    expect(card?.sensitivity).toBe('high');
    expect(card?.requiresConsent).toBe(false);
    expect(AUDITED_MODULES.map((m) => m.id)).toContain('auth');
    expect(CONSENT_GATED_MODULES.map((m) => m.id)).not.toContain('auth');
  });

  it('审计范围 = high + critical', () => {
    for (const mod of PORTAL_MODULES) {
      expect(mod.audited).toBe(mod.sensitivity === 'high' || mod.sensitivity === 'critical');
    }
    expect(isAuditedSensitivity('critical')).toBe(true);
    expect(isAuditedSensitivity('medium')).toBe(false);
  });

  it('敏感级文案完整', () => {
    expect(sensitivityLabel('low')).toBe('低敏感');
    expect(sensitivityLabel('medium')).toBe('中敏感');
    expect(sensitivityLabel('high')).toBe('高敏感');
    expect(sensitivityLabel('critical')).toBe('最高敏感');
  });
});

describe('装饰与兜底', () => {
  it('未知装饰时走中性兜底（新增模块不会让首页崩溃）', () => {
    const decorated = decorateModule(
      {
        id: 'brand-new',
        nameZh: '新模块',
        nameEn: 'Brand New',
        summary: '还没配装饰',
        category: 'business',
        sensitivity: 'low',
        requiresConsent: false,
        route: 'brand-new',
      },
      undefined,
    );
    expect(decorated.icon).toBe('circle-help');
    expect(decorated.accent).toBe('neutral');
    expect(decorated.href).toBe('/m/brand-new');
    expect(decorated.audited).toBe(false);
    expect(decorated.decorated).toBe(false);
  });

  it('validateModuleRegistry 能抓出缺装饰的模块', () => {
    const broken = [decorateModule({ ...MODULES[0]!, sensitivity: 'high' }, undefined)];
    const problems = validateModuleRegistry(broken, MODULES);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes('模块数量不一致'))).toBe(true);
    expect(problems.some((p) => p.includes('未配置 UI 装饰'))).toBe(true);
  });

  it('分类文案', () => {
    expect(categoryLabel('core')).toBe('基础能力');
    expect(categoryLabel('business')).toBe('校园服务');
  });
});
