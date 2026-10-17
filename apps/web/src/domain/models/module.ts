/**
 * 门户模块模型（domain 层，零框架依赖 —— 契约 §7）。
 *
 * 契约 §4 的模块表是**唯一真相**（`@kedaya/contracts` 的 `MODULES`）。
 * 本文件只负责"契约里没有、但 Web 门户 UI 需要"的那部分派生逻辑：
 * 路由、图标 key、强调色语义名、敏感级文案、同意门角标。
 *
 * ⚠️ 禁止在任何组件里硬编码模块清单；宫格必须遍历 `PORTAL_MODULES`。
 */
import type { KedayaModule, ModuleCategory, Sensitivity } from '@kedaya/contracts';

/** 宫格强调色 —— 只允许语义名，具体色值由 design-tokens 决定 */
export type ModuleAccent = 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

/** lucide 图标 key（presentation 层负责映射为具体图标组件，domain 不 import UI 库） */
export type ModuleIconKey =
  | 'users'
  | 'shield-alert'
  | 'shopping-bag'
  | 'home'
  | 'bike'
  | 'user-search'
  | 'search'
  | 'utensils'
  | 'messages-square'
  | 'sparkles'
  | 'heart-pulse'
  | 'circle-help'
  | 'plug'
  | 'bird'
  | 'key-round'
  | 'calendar-days'
  | 'credit-card'
  | 'user'
  | 'bell';

/** 门户里的模块条目 = 冻结契约条目 + 展示装饰 */
export interface PortalModule extends KedayaModule {
  /** App Router 路由（宫格点击目标） */
  href: string;
  icon: ModuleIconKey;
  accent: ModuleAccent;
  /** 是否展示"需二次同意"角标（契约 §9） */
  consentBadge: boolean;
  /** 是否属于审计范围（high / critical） */
  audited: boolean;
  /** 敏感级中文文案 */
  sensitivityLabel: string;
  /** 是否配置了 UI 装饰（icon/accent）。false = 走了兜底，测试会抓出来 */
  decorated: boolean;
}

const SENSITIVITY_LABELS: Record<Sensitivity, string> = {
  low: '低敏感',
  medium: '中敏感',
  high: '高敏感',
  critical: '最高敏感',
};

export function sensitivityLabel(sensitivity: Sensitivity): string {
  return SENSITIVITY_LABELS[sensitivity];
}

/** high + critical 必须审计 + 最小化采集（契约 §9） */
export function isAuditedSensitivity(sensitivity: Sensitivity): boolean {
  return sensitivity === 'high' || sensitivity === 'critical';
}

/** 已实现真实页面的模块；其余走 `/m/<id>` 建设中占位页 */
const IMPLEMENTED_ROUTES: Readonly<Record<string, string>> = {
  groupbuy: '/groupbuy',
  wildlife: '/wildlife',
};

export function moduleHref(id: string): string {
  return IMPLEMENTED_ROUTES[id] ?? `/m/${id}`;
}

export interface ModuleDecoration {
  icon: ModuleIconKey;
  accent: ModuleAccent;
}

/**
 * 把契约条目装饰成门户条目。
 * `decoration` 缺失时使用中性兜底 —— **新增模块不会让首页崩溃**。
 */
export function decorateModule(module: KedayaModule, decoration?: ModuleDecoration): PortalModule {
  return {
    ...module,
    href: moduleHref(module.id),
    icon: decoration?.icon ?? 'circle-help',
    accent: decoration?.accent ?? 'neutral',
    consentBadge: module.requiresConsent,
    audited: isAuditedSensitivity(module.sensitivity),
    sensitivityLabel: sensitivityLabel(module.sensitivity),
    decorated: decoration !== undefined,
  };
}

export interface ModuleGroups {
  core: PortalModule[];
  business: PortalModule[];
}

export function groupModulesByCategory(modules: readonly PortalModule[]): ModuleGroups {
  const groups: ModuleGroups = { core: [], business: [] };
  for (const m of modules) {
    groups[m.category].push(m);
  }
  return groups;
}

export function consentGatedModules(modules: readonly PortalModule[]): PortalModule[] {
  return modules.filter((m) => m.consentBadge);
}

export function auditedModules(modules: readonly PortalModule[]): PortalModule[] {
  return modules.filter((m) => m.audited);
}

export function findPortalModule(
  modules: readonly PortalModule[],
  id: string,
): PortalModule | undefined {
  return modules.find((m) => m.id === id);
}

/** 分类中文名 */
export function categoryLabel(category: ModuleCategory): string {
  return category === 'core' ? '基础能力' : '校园服务';
}

/**
 * 注册表自检（纯函数，测试用）。
 * 返回问题清单；空数组 = 注册表健康。
 *
 * 这是"首页宫格由数据驱动"这条规则的守卫：一旦有人硬编码/漏装饰，
 * 测试会立刻失败，而不是等页面渲染出空洞。
 */
export function validateModuleRegistry(
  registry: readonly PortalModule[],
  contractModules: readonly KedayaModule[],
): string[] {
  const problems: string[] = [];

  const contractIds = contractModules.map((m) => m.id);
  const registryIds = registry.map((m) => m.id);

  if (registryIds.length !== contractIds.length) {
    problems.push(`模块数量不一致：注册表 ${registryIds.length}，契约 ${contractIds.length}`);
  }

  const seen = new Set<string>();
  for (const id of registryIds) {
    if (seen.has(id)) problems.push(`重复模块 id：${id}`);
    seen.add(id);
  }

  for (const id of contractIds) {
    if (!seen.has(id)) problems.push(`契约模块未进入注册表：${id}`);
  }

  for (const m of registry) {
    if (!m.href.startsWith('/')) problems.push(`模块 ${m.id} 的 href 非法：${m.href}`);
    if (!m.icon) problems.push(`模块 ${m.id} 缺少 icon`);
    if (!m.decorated) {
      problems.push(`模块 ${m.id} 未配置 UI 装饰（icon/accent 走了兜底）`);
    }
    if (m.requiresConsent !== m.consentBadge) {
      problems.push(`模块 ${m.id} 的同意门角标与契约不一致`);
    }
    if (isAuditedSensitivity(m.sensitivity) !== m.audited) {
      problems.push(`模块 ${m.id} 的审计标记与敏感级不一致`);
    }
  }

  return problems;
}
