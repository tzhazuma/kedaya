/**
 * 用例：校园能力清单（契约 §7：application 层编排）。
 *
 * 规格 §8.1 端点 6：「当前用户可用的校园能力清单（含未绑定项的
 * `CAMPUS_BINDING_REQUIRED` 提示）」。
 *
 * ⚠️ **本文件最重要的一条规则**（契约 §5 硬规则 3 / ADR §5.4）：
 * `CAMPUS_BINDING_REQUIRED` 与 `EXPIRED` **不是错误**，而是"已登录但未绑定"
 * 这一**合法状态**的呈现 —— UI 必须给**引导**（下一步去哪、点什么），
 * 不能给红色报错。`deriveCapabilityGroups` 因此把它们单独分组。
 */
import type { ApiError } from '@kedaya/contracts';
import { err, ok, type Result } from '@kedaya/shared';

import { findPortalModule } from '@/domain/models/module';
import { PORTAL_MODULES } from '@/domain/models/modules';
import {
  CAMPUS_PLATFORM_LABELS,
  PHASE_LABELS,
  TECHPIE_CAPABILITY_STATUS_LABELS,
  capabilityGuidance,
  type TechpieCapabilitiesResponse,
  type TechpieCapability,
  type TechpieCapabilityStatus,
  type TechpiePhase,
} from '@/domain/models/techpie';
import type { TechpieRepository } from '@/domain/ports/techpie';

import { deriveViewState, type ViewState } from '../viewState';

/** 状态 → 徽章语义色（**不是**错误等级：`CAMPUS_BINDING_REQUIRED` 用 info 而不是 danger） */
const STATUS_TONES: Record<
  TechpieCapabilityStatus,
  'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger'
> = {
  AVAILABLE: 'success',
  // 引导，不是错误 —— 用 info/warning，绝不用 danger
  CAMPUS_BINDING_REQUIRED: 'info',
  EXPIRED: 'warning',
  PHASE_BLOCKED: 'neutral',
  UPSTREAM_UNAVAILABLE: 'warning',
};

export interface CapabilityVM {
  id: string;
  moduleId: string;
  /** 归属模块的中文名（来自冻结模块注册表；找不到时回落为 moduleId） */
  moduleLabel: string;
  nameZh: string;
  summary: string;
  phase: TechpiePhase;
  phaseLabel: string;
  access: TechpieCapability['access'];
  platform: TechpieCapability['platform'];
  platformLabel: string | null;
  /** ⚠️ 服务端下发的目标地址（白名单内）；客户端**不得**改写或拼接 */
  targetUrl: string | null;
  status: TechpieCapabilityStatus;
  statusLabel: string;
  statusTone: 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';
  /** 引导（需要绑定时给"去绑定"，阻塞时给原因） */
  guidance: string;
  needsBinding: boolean;
  bindHref: string | null;
  /** 本轮是否可用（点得动） */
  usable: boolean;
  /** 打开方式：WebView 直连 / 站内页面 / 尚不可用 */
  entryHref: string | null;
}

export interface CapabilityGroups {
  /** 可用 */
  available: CapabilityVM[];
  /** 需要先去绑定（**引导**，不是错误） */
  needsBinding: CapabilityVM[];
  /** 尚未开放（Phase 1+，阻塞于书面回复） */
  blocked: CapabilityVM[];
}

export interface TechpieCapabilityListVM {
  items: CapabilityVM[];
  groups: CapabilityGroups;
  /** §11.18-B 第 2 条：白名单内容为占位，UI 必须如实说明 */
  allowlistPlaceholder: boolean;
  isEmpty: boolean;
  state: ViewState;
}

export function toCapabilityVM(capability: TechpieCapability): CapabilityVM {
  const guidance = capabilityGuidance(capability);
  const moduleLabel = findPortalModule(PORTAL_MODULES, capability.moduleId)?.nameZh;
  const usable = capability.status === 'AVAILABLE';

  let entryHref: string | null = null;
  if (usable && capability.access === 'webview') entryHref = '/techpie/webview';
  else if (usable && capability.moduleId === 'campus-card') entryHref = '/campus-card';

  return {
    id: capability.id,
    moduleId: capability.moduleId,
    moduleLabel: moduleLabel ?? capability.moduleId,
    nameZh: capability.nameZh,
    summary: capability.summary,
    phase: capability.phase,
    phaseLabel: PHASE_LABELS[capability.phase],
    access: capability.access,
    platform: capability.platform,
    platformLabel: capability.platform ? CAMPUS_PLATFORM_LABELS[capability.platform] : null,
    targetUrl: capability.targetUrl,
    status: capability.status,
    statusLabel: TECHPIE_CAPABILITY_STATUS_LABELS[capability.status],
    statusTone: STATUS_TONES[capability.status],
    guidance: guidance.text,
    needsBinding: guidance.needsBinding,
    bindHref: guidance.bindHref,
    usable,
    entryHref,
  };
}

export function deriveCapabilityGroups(items: readonly CapabilityVM[]): CapabilityGroups {
  return {
    available: items.filter((item) => item.status === 'AVAILABLE'),
    needsBinding: items.filter(
      (item) => item.status === 'CAMPUS_BINDING_REQUIRED' || item.status === 'EXPIRED',
    ),
    blocked: items.filter(
      (item) => item.status === 'PHASE_BLOCKED' || item.status === 'UPSTREAM_UNAVAILABLE',
    ),
  };
}

export function toCapabilityListVM(
  response: TechpieCapabilitiesResponse,
  options: { state?: ViewState } = {},
): TechpieCapabilityListVM {
  const items = response.items.map(toCapabilityVM);
  return {
    items,
    groups: deriveCapabilityGroups(items),
    allowlistPlaceholder: response.allowlistPlaceholder,
    isEmpty: items.length === 0,
    state:
      options.state ??
      deriveViewState({ isPending: false, isError: false, isEmpty: items.length === 0 }),
  };
}

export async function loadCapabilities(
  repository: TechpieRepository,
): Promise<Result<TechpieCapabilityListVM, ApiError>> {
  const result = await repository.listCapabilities();
  if (!result.ok) return err(result.error);
  return ok(toCapabilityListVM(result.value));
}

export function capabilityListState(input: {
  isPending: boolean;
  isError: boolean;
  itemCount: number;
}): ViewState {
  return deriveViewState({
    isPending: input.isPending,
    isError: input.isError,
    isEmpty: input.itemCount === 0,
  });
}

/**
 * 从服务端下发的能力清单里**按 id**取出目标地址。
 *
 * 这是"`targetUrl` 只能来自服务端白名单"的落地方式（契约 §11.18-B）：
 * 调用方**无法**传入一个 URL —— 它只能给一个能力 id，
 * 地址本身由服务端下发（并且还要再过一次 `checkCampusTargetUrl`）。
 */
export function webviewTargetFor(
  capabilities: readonly TechpieCapability[],
  capabilityId: string,
): TechpieCapability | null {
  const found = capabilities.find((item) => item.id === capabilityId);
  if (!found) return null;
  if (found.access !== 'webview') return null;
  if (!found.targetUrl) return null;
  return found;
}
