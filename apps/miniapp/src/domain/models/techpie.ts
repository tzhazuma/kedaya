/**
 * TechPie 整合 —— 客户端领域模型（规格 `docs/features/techpie-integration.md`，契约 §11.18）。
 *
 * ⚠️ **本文件描述的是「能力层」（第二级身份）**，不是身份层。
 * 校园系统的 cookie / CASTGC **永远不进入本文件**，也不进入任何客户端状态 ——
 * 契约 §11.4 的 I1/I2 在这里体现为：
 *
 * 1. `CampusBindingSummary` 的类型里**没有**任何凭证字段；
 * 2. `normalizeCampusBindingSummary()` 会把「响应里夹带了凭证键」的条目**直接拒绝**
 *    （不是静默忽略 —— 静默忽略等于让后端有机会偷偷把凭证下发给客户端）。
 *
 * ## 关键平台约束（契约 §11.10-F，必须先读）
 *
 * 微信小程序的 `web-view` **无法注入 cookie、无法自定义请求头**，
 * 因此契约不变式 **I3 在小程序端没有出口**。小程序端走 **W4**：
 * 用户在校园系统页面里**自己登录**，我们不接触 cookie。
 * `CAMPUS_WEBVIEW_LOGIN_NOTICE` 就是必须在 UI 上如实告诉用户的那句话。
 */

import {
  CREDENTIAL_FORBIDDEN_KEYS,
  findForbiddenCredentialKeys,
  isForbiddenCredentialKey,
} from './credentials'

/* ------------------------------------------------------------------ *
 * 校园平台（契约 §11.10-B 裁决的枚举）
 * ------------------------------------------------------------------ */

/**
 * `provider` 枚举 —— 契约 §11.10-B 把 `TechpieLink.provider` 改为与
 * `CampusBinding.platform` **同一套**校园平台标识。
 */
export const CAMPUS_PLATFORMS = ['cas', 'egate', 'cpdaily', 'ecard', 'techpie'] as const

export type CampusPlatform = (typeof CAMPUS_PLATFORMS)[number]

export const CAMPUS_PLATFORM_LABELS: Readonly<Record<CampusPlatform, string>> = {
  cas: '学校统一身份认证',
  egate: 'eGate 门户',
  cpdaily: 'CpDaily（今日校园）',
  ecard: '校园卡（eCard）',
  techpie: 'GeekPie / TechPie 体系',
}

export function isCampusPlatform(value: unknown): value is CampusPlatform {
  return typeof value === 'string' && (CAMPUS_PLATFORMS as readonly string[]).includes(value)
}

/**
 * **Phase 0 唯一允许发起的绑定平台**。
 *
 * 校园卡走独立的 **OPENID 通道**（规格 §2.5），与 CASTGC 完全解耦 ——
 * 这是 Phase 0 可以零合规风险开工的原因。
 *
 * 其余平台（`cas` / `egate` / `cpdaily` / `techpie`）的绑定需要校园会话代持，
 * **阻塞于信息办对「学校是否允许第三方代持校园会话」的书面回复**
 * （契约 §11.9 第 1 项 / 规格 U7）。在拿到回复前**不实现该路径** ——
 * 契约 §11.18-D 的原话：不是"先做着等批准"，而是**根本不做**。
 */
export const PHASE0_BINDABLE_PLATFORMS: readonly CampusPlatform[] = ['ecard']

export function isPhase0Bindable(platform: CampusPlatform): boolean {
  return PHASE0_BINDABLE_PLATFORMS.includes(platform)
}

/** Phase 1+ 平台的诚实说明（UI 必须原样展示，不得含糊成「暂不可用」） */
export const PHASE1_BINDING_BLOCKED_REASON =
  '该平台的绑定需要代持校园会话（CASTGC），正在等待学校信息办的书面回复（契约 §11.9 第 1 项）。在回复到达之前，可达鸭不会建立任何校园会话副本。'

/* ------------------------------------------------------------------ *
 * 绑定摘要（**不含凭证**）
 * ------------------------------------------------------------------ */

/**
 * 绑定状态。
 *
 * 前 5 个来自冻结的 OpenAPI `TechpieLink.status`（**权威**）；
 * 后 3 个是规格 §8.3 示例里的历史写法，保留仅为**兼容读取**
 * （`normalizeBindingStatus` 会把 `LINKING` / `LINKED` 归一化）。
 * 两种写法并存是已登记的真实契约缺口，见交付说明的未决问题。
 */
export type CampusBindingStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'REVOKED'
  | 'FAILED'
  | 'UNLINKED'
  | 'LINKING'
  | 'LINKED'

const BINDING_STATUS_ALIASES: Readonly<Record<string, CampusBindingStatus>> = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  FAILED: 'FAILED',
  UNLINKED: 'UNLINKED',
  LINKING: 'PENDING',
  LINKED: 'ACTIVE',
}

export function normalizeBindingStatus(raw: unknown): CampusBindingStatus | null {
  if (typeof raw !== 'string') return null
  return BINDING_STATUS_ALIASES[raw.toUpperCase()] ?? null
}

export const CAMPUS_BINDING_STATUS_LABELS: Readonly<Record<CampusBindingStatus, string>> = {
  PENDING: '绑定中',
  ACTIVE: '已绑定',
  EXPIRED: '已过期',
  REVOKED: '已解绑',
  FAILED: '绑定失败',
  UNLINKED: '未绑定',
  LINKING: '绑定中',
  LINKED: '已绑定',
}

/** 该状态下的绑定是否真的可用（`ACTIVE` / `LINKED` 才算） */
export function isBindingUsable(status: CampusBindingStatus): boolean {
  return status === 'ACTIVE' || status === 'LINKED'
}

/** 需要用户「重新绑定」的状态（过期 / 失败 / 已吊销 / 未绑定） */
export function needsRebind(status: CampusBindingStatus): boolean {
  return !isBindingUsable(status)
}

/** 绑定阶段（OpenAPI `phase`）。`phase1` 在信息办回复前不可用 */
export type CampusBindingPhase = 'phase0' | 'phase1'

/**
 * 一条绑定的**摘要** —— 这是业务层唯一能拿到的形状（规格 §4.3）。
 *
 * ```
 * 严禁出现：cookie / cookies / session / sessionToken / tgc / castgc / ticket / tenant
 * ```
 *
 * 字段名以冻结的 OpenAPI `TechpieLink` 为准（`provider` / `displayName`），
 * 同时**兼容读取**规格 §8.3 示例里的 `platform` / `externalUserId`
 * （见 `normalizeCampusBindingSummary`）。
 */
export interface CampusBindingSummary {
  id: string
  provider: CampusPlatform
  status: CampusBindingStatus
  /** 对端展示名（规格 §8.3 叫 `externalUserId`，如学号）；可能为空 */
  displayName: string | null
  /** ISO-8601 */
  boundAt: string | null
  expiresAt: string | null
  lastSyncAt: string | null
  phase: CampusBindingPhase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 把服务端返回的原始条目收敛成 `CampusBindingSummary`。
 *
 * 返回 `null` 表示**拒绝该条目**，有三种情况：
 * 1. 形状不合法（缺 `id` / `provider` / `status`）；
 * 2. `provider` 不在冻结枚举内；
 * 3. **条目里出现了 8 个禁用凭证键中的任意一个**。
 *
 * 第 3 条是刻意的「fail-closed」：契约 §8.3 明确写了响应中严禁出现这些键。
 * 如果后端下发了 `castgc`，我们**不能**「假装没看见然后继续用」——
 * 那等于把凭证带进了客户端状态。宁可让这一条消失并在日志里记一次契约违规。
 */
export function normalizeCampusBindingSummary(raw: unknown): CampusBindingSummary | null {
  if (!isRecord(raw)) return null

  // 契约 I1 的镜像断言：先扫禁用键，再谈形状
  if (findForbiddenCredentialKeys(raw).length > 0) return null

  const id = readNullableString(raw.id)
  if (id === null) return null

  // `provider` 是权威字段；`platform` 是规格 §8.3 的历史写法，兼容读取
  const provider = isCampusPlatform(raw.provider)
    ? raw.provider
    : isCampusPlatform(raw.platform)
      ? raw.platform
      : null
  if (provider === null) return null

  const status = normalizeBindingStatus(raw.status)
  if (status === null) return null

  const phase = raw.phase === 'phase1' ? 'phase1' : 'phase0'

  return {
    id,
    provider,
    status,
    // `displayName`（OpenAPI）与 `externalUserId`（规格 §8.3）语义相同：对端标识
    displayName: readNullableString(raw.displayName) ?? readNullableString(raw.externalUserId),
    boundAt: readNullableString(raw.boundAt),
    expiresAt: readNullableString(raw.expiresAt),
    lastSyncAt: readNullableString(raw.lastSyncAt),
    phase,
  }
}

export function normalizeCampusBindingSummaries(raw: unknown): CampusBindingSummary[] {
  if (!Array.isArray(raw)) return []
  const out: CampusBindingSummary[] = []
  for (const item of raw) {
    const normalized = normalizeCampusBindingSummary(item)
    if (normalized !== null) out.push(normalized)
  }
  return out
}

/**
 * 开发期自检：断言 `CampusBindingSummary` 的键名集合与 I1 的禁用键**不相交**。
 *
 * 类型系统只能保证「当前代码里没有」，这个函数让测试可以在**运行期**再确认一次
 * （例如有人给接口加了字段但忘了跑类型断言时）。
 */
export function bindingSummaryForbiddenKeys(
  summary: CampusBindingSummary,
): string[] {
  return Object.keys(summary).filter(isForbiddenCredentialKey)
}

/** 契约 §11.4 I1 的 8 个禁用键（供测试断言，避免测试里再抄一遍字面量） */
export const CONTRACT_FORBIDDEN_CREDENTIAL_KEYS = CREDENTIAL_FORBIDDEN_KEYS

/* ------------------------------------------------------------------ *
 * 能力清单（GET /techpie/capabilities）
 * ------------------------------------------------------------------ */

export type CampusCapabilityPhase = 'phase0' | 'phase1' | 'phase2' | 'phase3'

/**
 * 一条校园能力 —— 与冻结 OpenAPI 的 `CampusCapability` 逐字段对齐。
 *
 * `available: false` **不是错误**：客户端应据此**引导绑定**，
 * 而不是显示报错（契约不变式 I4）。这条语义由 `resolveCapabilityEntry` 落成代码。
 */
export interface CampusCapability {
  key: string
  nameZh: string
  available: boolean
  requiredProvider: CampusPlatform | null
  phase: CampusCapabilityPhase
  /** 不可用的人可读原因。**必须诚实**（不得含糊成「暂不可用」） */
  blockedReason: string | null
}

export function normalizeCampusCapability(raw: unknown): CampusCapability | null {
  if (!isRecord(raw)) return null
  if (findForbiddenCredentialKeys(raw).length > 0) return null

  const key = readNullableString(raw.key)
  if (key === null) return null

  const phase: CampusCapabilityPhase =
    raw.phase === 'phase1' || raw.phase === 'phase2' || raw.phase === 'phase3'
      ? raw.phase
      : 'phase0'

  return {
    key,
    nameZh: readNullableString(raw.nameZh) ?? key,
    available: raw.available === true,
    requiredProvider: isCampusPlatform(raw.requiredProvider) ? raw.requiredProvider : null,
    phase,
    blockedReason: readNullableString(raw.blockedReason),
  }
}

export function normalizeCampusCapabilities(raw: unknown): CampusCapability[] {
  if (!Array.isArray(raw)) return []
  const out: CampusCapability[] = []
  for (const item of raw) {
    const normalized = normalizeCampusCapability(item)
    if (normalized !== null) out.push(normalized)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 能力 → 入口决策（**契约 I4 的落点**）
 * ------------------------------------------------------------------ */

/** 客户端对一条能力应当做什么 */
export type CampusEntryAction =
  /** 未登录 —— 这是真的「不可用」，需要先登录 */
  | 'SIGN_IN'
  /** 已登录但该能力需要绑定 —— **引导**去绑定，不是报错 */
  | 'GO_BIND'
  /** 可用，走 WebView 直连校园系统（W4：用户自己登录） */
  | 'OPEN_WEBVIEW'
  /** 可用，走端内页面 */
  | 'OPEN_NATIVE'
  /** 该能力本阶段不提供（诚实告知阻塞原因） */
  | 'BLOCKED'

export interface CampusEntryDecision {
  action: CampusEntryAction
  /**
   * 是否应当渲染成**引导**（引导卡片 + 去绑定按钮）而不是**错误态**。
   *
   * ⚠️ 这是本模块最容易被做错的一点：
   * 「已登录但未绑定」是**合法状态**（契约 §5 硬规则 3），
   * 用红色报错去表达它，会误导用户以为自己账号有问题。
   */
  isGuidance: boolean
  /** 对应的契约错误码；`null` 表示这不是一个错误状态 */
  code: 'UNAUTHENTICATED' | 'CAMPUS_BINDING_REQUIRED' | null
  title: string
  detail: string
}

export interface CampusViewer {
  /** 第一级身份是否有效 */
  authenticated: boolean
  /** 已经**可用**的绑定平台（来自 `GET /techpie/links` 中 `status=ACTIVE` 的那些） */
  boundProviders: readonly CampusPlatform[]
}

export function isProviderBound(viewer: CampusViewer, provider: CampusPlatform): boolean {
  return viewer.boundProviders.includes(provider)
}

/**
 * 从「第一级身份 + 绑定列表」构造 `CampusViewer`。
 *
 * ⚠️ 这是**两级身份模型在客户端唯一的汇合点**，因此它必须显式：
 * - 第一级（`authenticated`）来自**会话**（KedaYa 自有 JWT）；
 * - 第二级（`boundProviders`）来自**绑定列表**，且只取 `status` 可用的那些。
 *
 * 之所以要一个函数而不是两处 `if`：客户端的每一个「未登录 vs 未绑定」判断
 * 都必须走同一条路径，否则迟早会出现某页把「未绑定」误判成「未登录」，
 * 让用户被踢去重新登录（契约 §11.18-H 的 I4 正是要防这个）。
 */
export function campusViewerFromBindings(
  authenticated: boolean,
  bindings: readonly CampusBindingSummary[],
): CampusViewer {
  const providers: CampusPlatform[] = []
  for (const binding of bindings) {
    if (!isBindingUsable(binding.status)) continue
    if (providers.includes(binding.provider)) continue
    providers.push(binding.provider)
  }
  return { authenticated, boundProviders: providers }
}

/**
 * 把一条能力解析成「该做什么」。
 *
 * 判定顺序是刻意的：
 * 1. **未登录** → `SIGN_IN`（`UNAUTHENTICATED`，不是引导 —— 用户确实要先登录）；
 * 2. **非 Phase 0** → `BLOCKED`（先于绑定判定：我们**不实现**的能力，
 *    不该引导用户去绑定一个不存在的路径 —— 那是在骗用户做无用功）；
 * 3. **需要绑定但未绑定** → `GO_BIND`（`CAMPUS_BINDING_REQUIRED`，**是引导**）；
 * 4. 其余 → 可用，按交付方式给 `OPEN_WEBVIEW` / `OPEN_NATIVE`。
 */
export function resolveCapabilityEntry(
  capability: CampusCapability,
  viewer: CampusViewer,
  delivery: CampusCapabilityDelivery = 'native',
): CampusEntryDecision {
  if (!viewer.authenticated) {
    return {
      action: 'SIGN_IN',
      isGuidance: false,
      code: 'UNAUTHENTICATED',
      title: '需要先登录',
      detail: '登录后即可查看你已开通的校园能力。',
    }
  }

  if (capability.phase !== 'phase0') {
    return {
      action: 'BLOCKED',
      isGuidance: false,
      code: null,
      title: '本阶段暂不提供',
      detail:
        capability.blockedReason ??
        '该能力需要代持校园会话，正在等待学校信息办的书面回复（契约 §11.9 第 1 项）。',
    }
  }

  const provider = capability.requiredProvider
  if (provider !== null && !isProviderBound(viewer, provider)) {
    return {
      action: 'GO_BIND',
      // ⚠️ 契约 I4：已登录但未绑定 → 引导，不是错误
      isGuidance: true,
      code: 'CAMPUS_BINDING_REQUIRED',
      title: `还差一步：绑定${CAMPUS_PLATFORM_LABELS[provider]}`,
      detail: `绑定${CAMPUS_PLATFORM_LABELS[provider]}之后即可使用「${capability.nameZh}」。`,
    }
  }

  if (!capability.available) {
    return {
      action: 'BLOCKED',
      isGuidance: false,
      code: null,
      title: '本阶段暂不提供',
      detail:
        capability.blockedReason ??
        '该能力当前不可用。具体原因未由服务端给出，我们不猜测。',
    }
  }

  return delivery === 'webview'
    ? {
        action: 'OPEN_WEBVIEW',
        isGuidance: false,
        code: null,
        title: capability.nameZh,
        detail: '将打开学校系统页面，请在那里登录；可达鸭不接触你的登录凭证。',
      }
    : {
        action: 'OPEN_NATIVE',
        isGuidance: false,
        code: null,
        title: capability.nameZh,
        detail: '在可达鸭内查看。',
      }
}

/* ------------------------------------------------------------------ *
 * 能力目录（客户端补全：交付方式与入口）
 * ------------------------------------------------------------------ */

export type CampusCapabilityDelivery = 'webview' | 'native'

/**
 * 校园系统 WebView 目标。
 *
 * ⚠️ **域名目前是占位**（契约未决问题 U11：校园域名白名单的真实内容未知）。
 * `domainVerified: false` 是**机器可见**的标记 —— 它同时驱动 UI 上的一句提示，
 * 避免用户以为「打开失败」是可达鸭的 bug。
 */
export type CampusWebviewTargetId = 'ecourse' | 'egate' | 'elrc'

export interface CampusWebviewTarget {
  id: CampusWebviewTargetId
  nameZh: string
  summary: string
  url: string
  /** 域名是否已与信息办确认（U11）。未确认时必须如实告知 */
  domainVerified: boolean
}

export const CAMPUS_WEBVIEW_TARGETS: readonly CampusWebviewTarget[] = [
  {
    id: 'ecourse',
    nameZh: 'E云课堂',
    summary: '课程资料与在线课堂',
    url: 'https://ecourse.shanghaitech.edu.cn/',
    domainVerified: false,
  },
  {
    id: 'egate',
    nameZh: 'eGate 门户',
    summary: '学生请假 / 学生活动等 eGate 应用',
    url: 'https://egate.shanghaitech.edu.cn/',
    domainVerified: false,
  },
  {
    id: 'elrc',
    nameZh: '课程录播',
    summary: '教室录播回看（ELRC）',
    url: 'https://elrc.shanghaitech.edu.cn/',
    domainVerified: false,
  },
]

export function campusWebviewTarget(id: string): CampusWebviewTarget | null {
  return CAMPUS_WEBVIEW_TARGETS.find((target) => target.id === id) ?? null
}

/**
 * 必须在 WebView 页面上原样展示的告知（契约 §11.10-F + 用户要求「UI 上要如实告诉用户」）。
 *
 * 这句话不是免责声明，而是**事实陈述**：
 * 小程序 `web-view` 无法注入 cookie，所以用户在校园系统里的登录状态
 * 由学校域名自己维护，可达鸭既拿不到也存不了。
 */
export const CAMPUS_WEBVIEW_LOGIN_NOTICE =
  '接下来的页面由学校系统提供，请在那里登录；可达鸭不接触你的登录凭证。'

/** 域名未确认时追加的诚实提示（U11） */
export const CAMPUS_WEBVIEW_PLACEHOLDER_NOTICE =
  '该域名尚未与学校信息办确认（契约未决问题 U11），若打不开请反馈；可达鸭不会为此绕过任何限制。'

/** 校园系统页面只允许 https（契约 §11.18-B：禁止 http / IP 字面量 / userinfo） */
export function isHttpsCampusUrl(url: string): boolean {
  if (!url.startsWith('https://')) return false
  const rest = url.slice('https://'.length)
  const hostPart = rest.split(/[/?#]/)[0] ?? ''
  if (hostPart.includes('@')) return false
  if (/^\d+\.\d+\.\d+\.\d+/.test(hostPart)) return false
  return hostPart.length > 0
}

/**
 * 一条能力的客户端补全信息（交付方式 + WebView 目标）。
 *
 * 为什么服务端不返回它：交付方式是**端的能力**，不是服务端的领域数据 ——
 * 同一份 `CampusCapability` 在 Flutter 端可以走 cookie 注入的 WebView（I3 有效），
 * 在小程序端只能走 W4（用户自登录）。把端差异放在端上，是正确的分层。
 */
export interface CampusCapabilityDefinition {
  key: string
  delivery: CampusCapabilityDelivery
  webviewTargetId: CampusWebviewTargetId | null
  /** 端内页面（`delivery: 'native'` 时必填）；由 presentation 层映射成路由 */
  nativeRoute: 'campus-card' | null
}

export const CAMPUS_CAPABILITY_DEFINITIONS: readonly CampusCapabilityDefinition[] = [
  { key: 'ecourse', delivery: 'webview', webviewTargetId: 'ecourse', nativeRoute: null },
  { key: 'student_leave', delivery: 'webview', webviewTargetId: 'egate', nativeRoute: null },
  { key: 'student_activity', delivery: 'webview', webviewTargetId: 'egate', nativeRoute: null },
  { key: 'elrc_recordings', delivery: 'webview', webviewTargetId: 'elrc', nativeRoute: null },
  { key: 'campus_card', delivery: 'native', webviewTargetId: null, nativeRoute: 'campus-card' },
  // Phase 1+：交付方式未知（不实现），因此不给 WebView 目标 —— 避免 UI 上出现一个能点的入口
  { key: 'schedule', delivery: 'native', webviewTargetId: null, nativeRoute: null },
  { key: 'exam', delivery: 'native', webviewTargetId: null, nativeRoute: null },
  { key: 'ddl', delivery: 'native', webviewTargetId: null, nativeRoute: null },
  { key: 'facility', delivery: 'native', webviewTargetId: null, nativeRoute: null },
]

export function campusCapabilityDefinition(key: string): CampusCapabilityDefinition | null {
  return CAMPUS_CAPABILITY_DEFINITIONS.find((definition) => definition.key === key) ?? null
}

export function campusCapabilityDelivery(key: string): CampusCapabilityDelivery {
  return campusCapabilityDefinition(key)?.delivery ?? 'native'
}

/** 未绑定项的数量 —— 能力页用它决定是否显示「去绑定」引导条 */
export function countUnboundCapabilities(
  capabilities: readonly CampusCapability[],
  viewer: CampusViewer,
): number {
  return capabilities.filter(
    (capability) => resolveCapabilityEntry(capability, viewer).action === 'GO_BIND',
  ).length
}
