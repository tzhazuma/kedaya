/**
 * TechPie 整合 · 校园能力清单（规格 §3.1 映射表 / §8.1 端点 6）
 *
 * 本文件是**纯 domain**：零框架、零 IO、零 Prisma（契约 §7 依赖方向）。
 *
 * ## 两条必须守住的诚实底线
 *
 * 1. **不编造能力**：规格 §3.4 / 裁决 §11.18-C —— 当前 clone 的 TechPie master 上
 *    **没有校园网能力**（U1）。因此本清单里**不出现**校园网，也不出现
 *    Piazza / CourseBench（TechPie 自身未实现，规格 N3）。
 * 2. **不假装 Phase 1–3 只是"待接线"**：它们阻塞于信息办 / GeekPie 的**书面回复**
 *    （U6 / U7 / U8 / U12），因此 `blockedReason` 是**明确的阻塞原因**，
 *    而不是"暂不可用"。
 *
 * ## wire 形状（契约 §11.20-D / §11.21-F 收敛后）
 *
 * ⚠️ 本轮删除了全部**加法兼容别名**（§11.20-D：两个名字会永久共存、
 * 消费方分裂、把不一致从编译期推到运行期）：
 *
 * | 被删除的别名 | 保留的**唯一**名字 |
 * | --- | --- |
 * | `id` | **`key`** |
 * | `platform` | **`requiredProvider`** |
 * | `status`（5 值枚举） | **`available`**（布尔） |
 * | `guidance` | **`blockedReason`** |
 *
 * 条目上**保留**的非别名结构性字段：`moduleId`（归属模块，规格 §3.1 映射表是
 * 按模块组织的）、`summary`（人可读描述）、`access`（openid / webview /
 * server_proxy —— 决定 UI 给"去绑定"还是"打开校园系统"）、`targetUrl`
 * （`access: 'webview'` 的白名单地址，`POST /techpie/webview-session` 的
 * `targetUrl` **唯一**合法来源，§11.18-B）。
 * 它们**不是**任何字段的同义别名，删掉会让 WebView 直连在契约上无法表达。
 *
 * ⚠️ §11.22-D 通用规则：**可空的可选字段为空时省略键，而不是下发 `null`**。
 * 因此 `requiredProvider` / `blockedReason` / `targetUrl` 为空时**整个键都不出现**。
 */

import {
  CAMPUS_PLATFORM_LABEL,
  isActiveLinkStatus,
  type CampusPlatform,
  type TechpiePhase,
} from './ports/campus-session.port';

// `CAMPUS_PLATFORM_LABEL` 现在**只有一处定义**（端口文件，与枚举同住）——
// 这里重新导出，保持既有的 import 路径仍然可用（一个概念一个 owner）。
export { CAMPUS_PLATFORM_LABEL };

/** 能力的访问方式（决定 UI 给"去绑定"还是"打开校园系统"） */
export type TechpieCapabilityAccess = 'openid' | 'webview' | 'server_proxy';

/**
 * 服务端判定的能力状态（**内部**判定，wire 上只暴露 `available: boolean`）。
 *
 * ⚠️ `CAMPUS_BINDING_REQUIRED` 与 `ApiErrorCode` 里的同名错误码是**同一个语义**，
 * 字符串刻意保持一致（三端可以复用同一个判定分支）。
 */
export type TechpieCapabilityStatus =
  | 'AVAILABLE'
  | 'CAMPUS_BINDING_REQUIRED'
  | 'EXPIRED'
  | 'PHASE_BLOCKED'
  | 'UPSTREAM_UNAVAILABLE';

/**
 * 一条校园能力（**wire 类型**，冻结 OpenAPI `CampusCapability` 的超集）。
 *
 * 别名已删除：只有 `key` / `requiredProvider` / `available` / `blockedReason`，
 * 没有 `id` / `platform` / `status` / `guidance`（§11.20-D / §11.21-F）。
 */
export interface TechpieCapability {
  /** 能力标识，如 `ecard.balance`（规格 §3.1 的能力行） */
  key: string;
  /** 归属的契约模块 id（`campus-card` / `schedule` / ...） */
  moduleId: string;
  nameZh: string;
  summary: string;
  phase: TechpiePhase;
  access: TechpieCapabilityAccess;
  /** 需要哪个平台的绑定；**不需要绑定时整个键不出现**（§11.22-D） */
  requiredProvider?: CampusPlatform;
  /**
   * WebView 能力的**目标地址**（`access === 'webview'` 时必有）。
   *
   * ⚠️ 契约 §11.18-B：它**必须来自服务端白名单**，客户端**不得自行拼接任意 URL**。
   * 客户端只把这个值**原样**透传给 `POST /techpie/webview-session`。
   */
  targetUrl?: string;
  /** 当前用户是否可用。**`false` 不是错误** —— 客户端据此**引导绑定**（不变式 I4） */
  available: boolean;
  /** 不可用的人可读原因；可用时**整个键不出现**（§11.22-D） */
  blockedReason?: string;
}

/** 能力清单响应（含白名单占位标记 —— 裁决 §11.18-B 第 2 条：必须机器可见） */
export interface TechpieCapabilitiesResult {
  /**
   * 权威字段（冻结 OpenAPI 的形状）。
   *
   * ⚠️ 契约 §11.20-D：**删掉了同值的 `items` 别名** —— 一个字段只有一个名字。
   */
  capabilities: TechpieCapability[];
  /** 校园域名白名单**内容仍为占位**（§11.18-B / U11） */
  allowlistPlaceholder: boolean;
  /** 需要先绑定才能用的能力数（OpenAPI 形状） */
  unboundCount: number;
}

/**
 * 能力目录（**纯数据**，不含用户状态）。
 *
 * 顺序即 UI 展示顺序：Phase 0 的可用能力在前，被阻塞的在后。
 */
export interface TechpieCapabilityDefinition {
  /** 能力标识（wire 上的 `key`） */
  key: string;
  moduleId: string;
  nameZh: string;
  summary: string;
  phase: TechpiePhase;
  access: TechpieCapabilityAccess;
  /** 需要绑定的平台（`null` = 不需要绑定） */
  requiredProvider: CampusPlatform | null;
  targetUrl: string | null;
  /** 被阻塞时的**诚实**原因（§11.18-D：不得含糊成"暂不可用"） */
  blockedReason: string | null;
}

/** Phase 1+ 的阻塞原因（裁决 §11.18-D 的原话，逐字保留） */
export const PHASE_BLOCKED_REASON =
  '本项需要学校信息办的书面确认（是否允许第三方代持校园会话 CASTGC、绑定是否必须使用明文密码），' +
  '以及学校 CAS 对接的正式批准。在拿到书面回复前，可达鸭**不实现**该通道的绑定流程 ——' +
  '不是"先做着等批准"，而是根本不做：一旦落库，就产生了一个未经授权的凭证副本。';

/** Phase 2 的阻塞原因（模块归属 + 上游能力，规格 §9.3 / §11.18-D） */
export const PHASE2_BLOCKED_REASON =
  '本项属 Phase 2：它依赖 Phase 1 的结构化校园数据，且上游能力（场馆预约 / 自动续期）' +
  '尚未确认对我们开放 —— 那需要 GeekPie / HeZeBang 的**书面**确认（规格 U8）。本轮不实现。';

/**
 * 校园 WebView 直连入口的目标地址（规格 §8.4 方案 **W4**）。
 *
 * Phase 0 的做法：用户在校园系统页面**自己登录**，我们**不接触 cookie**。
 * 这些地址必须与 `data/webview-session/target-url.ts` 的白名单**一致** ——
 * 该一致性由 `data/webview-session/target-url.spec.ts` 的测试钉死
 * （能力清单给出的 targetUrl 若不在白名单里，票据端点会 403，UI 就成了死链）。
 */
export const CAMPUS_WEB_ENTRY_TARGETS = {
  ecourse: 'https://ecourse.shanghaitech.edu.cn/',
  studentLeave: 'https://oa.shanghaitech.edu.cn/',
  studentActivity: 'https://oa.shanghaitech.edu.cn/activity',
  elrc: 'https://elrc.shanghaitech.edu.cn/',
} as const;

/**
 * 冻结的能力目录。
 *
 * 映射依据：规格 §3.1 的能力 → 模块映射总表。**逐条可追溯**。
 */
export const TECHPIE_CAPABILITIES: readonly TechpieCapabilityDefinition[] = [
  /* ---------------- Phase 0 · 校园卡（OPENID 通道，零合规风险） ---------------- */
  {
    key: 'ecard.balance',
    moduleId: 'campus-card',
    nameZh: '校园卡余额',
    summary: '一卡通余额查询。走 eCard 的 OPENID 通道，**不需要** CASTGC。',
    phase: 'phase0',
    access: 'openid',
    requiredProvider: 'ecard',
    targetUrl: null,
    blockedReason: null,
  },
  {
    key: 'ecard.transactions',
    moduleId: 'campus-card',
    nameZh: '校园卡流水',
    summary: '一卡通消费流水。走 eCard 的 OPENID 通道，**不需要** CASTGC。',
    phase: 'phase0',
    access: 'openid',
    requiredProvider: 'ecard',
    targetUrl: null,
    blockedReason: null,
  },
  {
    key: 'ecard.payment_code',
    moduleId: 'campus-card',
    nameZh: '校园卡付款码',
    summary: '付款码（60 秒 TTL、一次性、不进日志）。走 eCard 的 OPENID 通道。',
    phase: 'phase0',
    access: 'openid',
    requiredProvider: 'ecard',
    targetUrl: null,
    blockedReason: null,
  },

  /* ---------------- Phase 0 · WebView 直连（W4：用户自登录，我们不接触 cookie） ---------------- */
  {
    key: 'webview.ecourse',
    moduleId: 'techpie',
    nameZh: 'E云课堂',
    summary: '在校园系统页面**自己登录**后使用；可达鸭不接触 cookie（规格 §8.4 方案 W4）。',
    phase: 'phase0',
    access: 'webview',
    requiredProvider: null,
    targetUrl: CAMPUS_WEB_ENTRY_TARGETS.ecourse,
    blockedReason: null,
  },
  {
    key: 'webview.student_leave',
    moduleId: 'techpie',
    nameZh: '学生请假',
    summary: '在校园系统页面**自己登录**后使用；可达鸭不接触 cookie（规格 §8.4 方案 W4）。',
    phase: 'phase0',
    access: 'webview',
    requiredProvider: null,
    targetUrl: CAMPUS_WEB_ENTRY_TARGETS.studentLeave,
    blockedReason: null,
  },
  {
    key: 'webview.student_activity',
    moduleId: 'techpie',
    nameZh: '学生活动',
    summary: '在校园系统页面**自己登录**后使用；可达鸭不接触 cookie（规格 §8.4 方案 W4）。',
    phase: 'phase0',
    access: 'webview',
    requiredProvider: null,
    targetUrl: CAMPUS_WEB_ENTRY_TARGETS.studentActivity,
    blockedReason: null,
  },
  {
    key: 'webview.elrc',
    moduleId: 'techpie',
    nameZh: '课程录播（ELRC）',
    summary: '纯外链 WebView，无 cookie 注入（规格 §3.1 第 8 项）。',
    phase: 'phase0',
    access: 'webview',
    requiredProvider: null,
    targetUrl: CAMPUS_WEB_ENTRY_TARGETS.elrc,
    blockedReason: null,
  },

  /* ---------------- Phase 1 · 结构化校园数据（阻塞于信息办书面回复） ---------------- */
  {
    key: 'schedule.courses',
    moduleId: 'schedule',
    nameZh: '课程表',
    summary: '结构化课表数据需要调用 CpDaily API（即需要代持校园会话）。',
    phase: 'phase1',
    access: 'server_proxy',
    requiredProvider: 'cpdaily',
    targetUrl: null,
    blockedReason: PHASE_BLOCKED_REASON,
  },
  {
    key: 'schedule.exams',
    moduleId: 'schedule',
    nameZh: '考试表',
    summary: '考试表与课程表同一会话（规格 §3.1 第 2 项）。',
    phase: 'phase1',
    access: 'server_proxy',
    requiredProvider: 'cpdaily',
    targetUrl: null,
    blockedReason: PHASE_BLOCKED_REASON,
  },
  {
    key: 'schedule.deadlines',
    moduleId: 'schedule',
    nameZh: 'DDL 聚合',
    summary: 'Blackboard / 考试 / Gradescope / Hydro 的 DDL 聚合（规格 §3.1 第 3 项）。',
    phase: 'phase1',
    access: 'server_proxy',
    requiredProvider: 'cpdaily',
    targetUrl: null,
    blockedReason: PHASE_BLOCKED_REASON,
  },
  {
    key: 'auth.school_cas',
    moduleId: 'auth',
    nameZh: '学校统一身份认证直连',
    summary: '一级身份直连学校 CAS（规格 §4.2 方案 A 的目标形态）。',
    phase: 'phase1',
    access: 'server_proxy',
    requiredProvider: 'cas',
    targetUrl: null,
    blockedReason: PHASE_BLOCKED_REASON,
  },

  /* ---------------- Phase 2 · 高级能力（依赖 Phase 1 + 上游确认） ---------------- */
  {
    key: 'facility.reservation',
    moduleId: 'facility',
    nameZh: '场馆预约',
    summary: '学校 OA 的场馆预约能力，需要 OA 会话（规格 §2.6 / §3.3）。',
    phase: 'phase2',
    access: 'server_proxy',
    requiredProvider: 'cpdaily',
    targetUrl: null,
    blockedReason: PHASE2_BLOCKED_REASON,
  },
  {
    key: 'techpie.auto_renew',
    moduleId: 'techpie',
    nameZh: '会话自动续期',
    summary:
      '自动续期依赖 `/api/auth/renew`（TechPie 自建后端的能力）—— 我们**无法假定它对我们开放**（规格 §6.3 R4 / U8）。',
    phase: 'phase2',
    access: 'server_proxy',
    requiredProvider: 'techpie',
    targetUrl: null,
    blockedReason: PHASE2_BLOCKED_REASON,
  },
];

/** 用户当前的绑定情况（由 `CampusSessionPort.listBindings` 提供） */
export interface TechpieBindingView {
  provider: CampusPlatform;
  status: string;
}

/**
 * 判定一条能力的服务端状态（**纯函数**，可单测）。
 *
 * 规则（顺序即优先级）：
 *   1. `phase !== 'phase0'` → `PHASE_BLOCKED`（**先于**绑定判定：
 *      未开放的能力不该提示用户"去绑定"，因为绑了也用不了）；
 *   2. 需要绑定且没有可用绑定 → `CAMPUS_BINDING_REQUIRED`（**不是错误**）；
 *   3. 需要绑定且绑定存在但不可用（EXPIRED/REVOKED/PENDING/FAILED）→ `EXPIRED`；
 *   4. 其余 → `AVAILABLE`。
 *
 * `UPSTREAM_UNAVAILABLE` 在 Phase 0 不会出现 —— Phase 0 的能力**不发上游请求**。
 * 保留该值是为了 Phase 1+ 与失败模式 F4/F7 的语义完整。
 */
export function resolveCapabilityStatus(
  definition: Pick<TechpieCapabilityDefinition, 'phase' | 'requiredProvider'>,
  bindings: readonly TechpieBindingView[],
): TechpieCapabilityStatus {
  if (definition.phase !== 'phase0') return 'PHASE_BLOCKED';
  if (definition.requiredProvider === null) return 'AVAILABLE';

  const binding = bindings.find((item) => item.provider === definition.requiredProvider);
  if (!binding) return 'CAMPUS_BINDING_REQUIRED';
  if (!isActiveLinkStatus(binding.status)) return 'EXPIRED';
  return 'AVAILABLE';
}

/** 未绑定时的引导文案（**不是报错**，规格 §8.1 端点 6 / 失败模式 F1） */
export function bindingRequiredGuidance(platform: CampusPlatform): string {
  return `该能力需要先绑定「${CAMPUS_PLATFORM_LABEL[platform]}」。绑定是**可选**的：不绑定也能正常使用可达鸭的全部自有功能。`;
}

/** 已过期时的引导文案（失败模式 F2：不导致登出，只要求重新绑定） */
export function expiredGuidance(platform: CampusPlatform): string {
  return `「${CAMPUS_PLATFORM_LABEL[platform]}」的绑定已过期，需要重新绑定。**你的可达鸭登录状态不受影响** —— 校园会话失效与登录过期是两件事。`;
}



/**
 * 把能力目录 + 用户绑定情况投影成响应条目。
 *
 * **纯函数**：不碰数据库、不碰网络 —— 因此能力清单端点天然满足
 * 契约 §8 的"启动不被上游拖死"（不变式 I5 的同源要求）。
 *
 * ⚠️ 为空的可选字段**省略键**而不是下发 `null`（§11.22-D 通用规则）。
 */
export function buildCapabilities(
  definitions: readonly TechpieCapabilityDefinition[],
  bindings: readonly TechpieBindingView[],
): TechpieCapability[] {
  return definitions.map((definition) => {
    const status = resolveCapabilityStatus(definition, bindings);
    const provider = definition.requiredProvider;

    let blockedReason: string | null = definition.blockedReason;
    if (status === 'CAMPUS_BINDING_REQUIRED' && provider) blockedReason = bindingRequiredGuidance(provider);
    if (status === 'EXPIRED' && provider) blockedReason = expiredGuidance(provider);
    if (status === 'AVAILABLE') blockedReason = null;

    const item: TechpieCapability = {
      key: definition.key,
      moduleId: definition.moduleId,
      nameZh: definition.nameZh,
      summary: definition.summary,
      phase: definition.phase,
      access: definition.access,
      available: status === 'AVAILABLE',
    };

    // §11.22-D：可空的可选字段为空时**省略该键**，不下发 `null`
    if (provider !== null) item.requiredProvider = provider;
    if (definition.targetUrl !== null) item.targetUrl = definition.targetUrl;
    if (blockedReason !== null) item.blockedReason = blockedReason;

    return item;
  });
}

/** 需要先绑定才能用的能力数（`unboundCount`） */
export function countUnbound(
  definitions: readonly TechpieCapabilityDefinition[],
  bindings: readonly TechpieBindingView[],
): number {
  return definitions.filter(
    (definition) => resolveCapabilityStatus(definition, bindings) === 'CAMPUS_BINDING_REQUIRED',
  ).length;
}
