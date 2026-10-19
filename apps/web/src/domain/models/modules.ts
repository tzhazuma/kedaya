/**
 * 门户模块注册表 —— 首页宫格的**唯一数据源**。
 *
 * 契约 §4 + §11.10-C：**20** 个模块（5 基础 + 15 业务）由 `@kedaya/contracts` 的 `MODULES` 冻结。
 * 本文件只补 UI 装饰，**不复制、不改写**契约内容。
 *
 * 依赖方向：domain → @kedaya/contracts（纯类型/常量包，零框架）。
 */
import { BUSINESS_MODULES, CORE_MODULES, MODULES } from '@kedaya/contracts';

import {
  auditedModules,
  consentGatedModules,
  decorateModule,
  groupModulesByCategory,
  type ModuleDecoration,
  type PortalModule,
} from './module';
import { deliveryOf, isDelivered, type ModuleDelivery } from './delivery';

/**
 * UI 装饰表：key = 冻结模块 id。
 * 缺失时 `decorateModule` 会走中性兜底（并在测试里被 `validateModuleRegistry` 抓出来）。
 */
const DECORATION: Readonly<Record<string, ModuleDecoration>> = {
  // ---- 基础模块 ----
  auth: { icon: 'key-round', accent: 'brand' },
  schedule: { icon: 'calendar-days', accent: 'info' },
  // 第 21 个模块：DDL 聚合。与 schedule 同属学业基础设施（core），
  // 但详情页在小程序（Web 暂无独立功能页），所以只剩装饰 + 交付状态两处需要登记。
  deadlines: { icon: 'calendar-days', accent: 'warning' },
  'campus-card': { icon: 'credit-card', accent: 'warning' },
  profile: { icon: 'user', accent: 'neutral' },
  notifications: { icon: 'bell', accent: 'info' },

  // ---- 业务模块 ----
  groupbuy: { icon: 'users', accent: 'brand' },
  'takeout-guard': { icon: 'shield-alert', accent: 'warning' },
  'flea-market': { icon: 'shopping-bag', accent: 'success' },
  'dorm-harmony': { icon: 'home', accent: 'danger' },
  errand: { icon: 'bike', accent: 'info' },
  buddy: { icon: 'user-search', accent: 'success' },
  'lost-found': { icon: 'search', accent: 'info' },
  canteen: { icon: 'utensils', accent: 'success' },
  forum: { icon: 'messages-square', accent: 'info' },
  'ai-portrait': { icon: 'sparkles', accent: 'danger' },
  wellbeing: { icon: 'heart-pulse', accent: 'danger' },
  faq: { icon: 'circle-help', accent: 'neutral' },
  techpie: { icon: 'plug', accent: 'info' },
  wildlife: { icon: 'bird', accent: 'success' },
  // 第 20 个模块（契约 §11.10-C 裁决 v1.2）：场馆预约，medium 敏感、无同意门
  facility: { icon: 'dumbbell', accent: 'success' },
};

/** 21 个模块，顺序 = 契约顺序（基础在前，业务在后） */
export const PORTAL_MODULES: readonly PortalModule[] = MODULES.map((m) =>
  decorateModule(m, DECORATION[m.id]),
);

/** 分组（首页宫格分区渲染） */
export const PORTAL_MODULE_GROUPS = groupModulesByCategory(PORTAL_MODULES);

/** 必须二次同意才能进入的模块（契约 §9：wellbeing / dorm-harmony / ai-portrait） */
export const CONSENT_GATED_MODULES: readonly PortalModule[] = consentGatedModules(PORTAL_MODULES);

/** 需要审计的模块（high + critical；注意 auth / campus-card 在列但**无同意门**） */
export const AUDITED_MODULES: readonly PortalModule[] = auditedModules(PORTAL_MODULES);

/** 模块总数 —— 与契约对齐（5 基础 + 15 业务 = 20，含 §11.10-C 新增的 facility） */
export const PORTAL_MODULE_COUNT = PORTAL_MODULES.length;

/** 契约原始条目（测试用，避免测试自己再 import 一次） */
export const CONTRACT_MODULES = MODULES;
export const CONTRACT_CORE_MODULES = CORE_MODULES;
export const CONTRACT_BUSINESS_MODULES = BUSINESS_MODULES;

/* ================================================================== *
 * 按交付阶段分组（首页「哪些模块已经能用」的三个卡片）
 *
 * ⚠️ 这四个是**派生量**，唯一真相是 `delivery.ts` 的 `DELIVERY` 表。
 * 合并同学分支时它们被丢过一次（`page.tsx` 与 `delivery.test.ts` 都 import 它们），
 * 于是 web 端 typecheck 直接红。**不要**在别处另写一份判断 ——
 * 那正是让「宫格角标」与「模块说明页」不一致的原因。
 * ================================================================== */

/** 一条「已交付」的记录：模块本身 + 它的交付信息 + 该去的链接 */
export interface DeliveredModuleLink {
  readonly id: string;
  readonly nameZh: string;
  readonly href: string;
  /** 交付元数据（stage / webHref / note）—— 由 `delivery.ts` 提供，不另写一份 */
  readonly delivery: ModuleDelivery;
}

/** 在浏览器里能直接用（有真实路由） */
export const WEB_READY_MODULES: readonly DeliveredModuleLink[] = PORTAL_MODULES.flatMap((mod) => {
  const delivery = deliveryOf(mod.id);
  if (delivery.stage !== 'web' || delivery.webHref === undefined) return [];
  return [{ id: mod.id, nameZh: mod.nameZh, href: delivery.webHref, delivery }];
});

/** 微信小程序端已上线（Web 还没有页面，所以 href 指向模块说明页） */
export const MINIAPP_MODULES: readonly DeliveredModuleLink[] = PORTAL_MODULES.flatMap((mod) => {
  const delivery = deliveryOf(mod.id);
  if (delivery.stage !== 'miniapp') return [];
  return [{ id: mod.id, nameZh: mod.nameZh, href: `/m/${mod.id}`, delivery }];
});

/** 任意一端已交付（= 不是 api-only） */
export const DELIVERED_MODULES: readonly PortalModule[] = PORTAL_MODULES.filter((mod) =>
  isDelivered(deliveryOf(mod.id)),
);

/** 只有后端接口、两端都还没有页面 */
export const API_ONLY_MODULES: readonly PortalModule[] = PORTAL_MODULES.filter(
  (mod) => deliveryOf(mod.id).stage === 'api-only',
);
