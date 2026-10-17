/**
 * 门户模块注册表 —— 首页宫格的**唯一数据源**。
 *
 * 契约登记 19 个能力，其中找搭子归入凑凑；首页展示 18 个一级入口。
 * 本文件只补 UI 装饰，**不复制、不改写**契约内容。
 *
 * 依赖方向：domain → @kedaya/contracts（纯类型/常量包，零框架）。
 */
import { BUSINESS_MODULES, CORE_MODULES, TOP_LEVEL_MODULES } from '@kedaya/contracts';

import {
  auditedModules,
  consentGatedModules,
  decorateModule,
  groupModulesByCategory,
  type ModuleDecoration,
  type PortalModule,
} from './module';

/**
 * UI 装饰表：key = 冻结模块 id。
 * 缺失时 `decorateModule` 会走中性兜底（并在测试里被 `validateModuleRegistry` 抓出来）。
 */
const DECORATION: Readonly<Record<string, ModuleDecoration>> = {
  // ---- 基础模块 ----
  auth: { icon: 'key-round', accent: 'brand' },
  schedule: { icon: 'calendar-days', accent: 'info' },
  'campus-card': { icon: 'credit-card', accent: 'warning' },
  profile: { icon: 'user', accent: 'neutral' },
  notifications: { icon: 'bell', accent: 'info' },

  // ---- 业务模块 ----
  groupbuy: { icon: 'users', accent: 'brand' },
  'takeout-guard': { icon: 'shield-alert', accent: 'warning' },
  'flea-market': { icon: 'shopping-bag', accent: 'success' },
  'dorm-harmony': { icon: 'home', accent: 'danger' },
  errand: { icon: 'bike', accent: 'info' },
  'lost-found': { icon: 'search', accent: 'info' },
  canteen: { icon: 'utensils', accent: 'success' },
  forum: { icon: 'messages-square', accent: 'info' },
  'ai-portrait': { icon: 'sparkles', accent: 'danger' },
  wellbeing: { icon: 'heart-pulse', accent: 'danger' },
  faq: { icon: 'circle-help', accent: 'neutral' },
  techpie: { icon: 'plug', accent: 'info' },
  wildlife: { icon: 'bird', accent: 'success' },
};

/** 18 个一级模块，顺序 = 契约顺序（基础在前，业务在后） */
export const PORTAL_MODULES: readonly PortalModule[] = TOP_LEVEL_MODULES.map((m) =>
  decorateModule(m, DECORATION[m.id]),
);

/** 分组（首页宫格分区渲染） */
export const PORTAL_MODULE_GROUPS = groupModulesByCategory(PORTAL_MODULES);

/** 必须二次同意才能进入的模块（契约 §9：wellbeing / dorm-harmony / ai-portrait） */
export const CONSENT_GATED_MODULES: readonly PortalModule[] = consentGatedModules(PORTAL_MODULES);

/** 需要审计的模块（high + critical；注意 auth / campus-card 在列但**无同意门**） */
export const AUDITED_MODULES: readonly PortalModule[] = auditedModules(PORTAL_MODULES);

/** 首页入口总数（5 基础 + 13 业务） */
export const PORTAL_MODULE_COUNT = PORTAL_MODULES.length;

/** 契约原始条目（测试用，避免测试自己再 import 一次） */
export const CONTRACT_MODULES = TOP_LEVEL_MODULES;
export const CONTRACT_CORE_MODULES = CORE_MODULES;
export const CONTRACT_BUSINESS_MODULES = BUSINESS_MODULES;
