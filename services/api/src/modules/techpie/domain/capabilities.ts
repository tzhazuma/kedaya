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
 *    （U6 / U7 / U8 / U12），因此状态是 `PHASE_BLOCKED` + **明确的阻塞原因**，
 *    而不是"暂不可用"。
 *
 * ## 关于 `CAMPUS_BINDING_REQUIRED`
 *
 * 它**不是错误**（契约 §5 硬规则 3、ADR §5.4）：它是「已登录但未绑定」这一
 * **合法状态**的呈现，UI 必须给**引导**而不是报错。本文件把它作为能力条目的
 * `status` 值返回，客户端据此渲染引导卡片。
 */

import type { CampusPlatform, TechpiePhase } from './ports/campus-session.port';

/** 能力的访问方式（决定 UI 给"去绑定"还是"打开校园系统"） */
export type TechpieCapabilityAccess = 'openid' | 'webview' | 'server_proxy';

/**
 * 服务端判定的能力状态。
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
 * 一条校园能力。
 *
 * ⚠️ **字段是两套客户端形状的并集**（如实登记，不是设计品味）：
 *   · 冻结 OpenAPI `CampusCapability` 用 `key` / `available` / `requiredProvider` / `blockedReason`；
 *   · 规格 §8.1 与 Web 端 `TechpieCapability` 用 `id` / `platform` / `status` / `guidance`。
 * 两者在**同一份已提交的仓库里同时存在**且互相矛盾（见交付说明的未决问题）。
 * 为了让三端都不被打断，本实现返回**并集**：同一语义的字段成对出现
 * （`id`/`key`、`platform`/`requiredProvider`、`status`/`available`、`guidance`/`blockedReason`）。
 * Lead 收敛契约后应删掉其中一半。
 */
export interface TechpieCapability {
  /** 冻结能力 id，如 `ecard.balance`（规格 §3.1 的能力行） */
  id: string;
  /** 与 `id` 同值的别名（OpenAPI 形状） */
  key: string;
  /** 归属的契约模块 id（`campus-card` / `schedule` / ...） */
  moduleId: string;
  nameZh: string;
  summary: string;
  phase: TechpiePhase;
  access: TechpieCapabilityAccess;
  /** 需要哪个平台的绑定（`null` = 不需要绑定） */
  platform: CampusPlatform | null;
  /** 与 `platform` 同值的别名（OpenAPI 形状） */
  requiredProvider: CampusPlatform | null;
  /**
   * WebView 能力的**目标地址**。
   *
   * ⚠️ 契约 §11.18-B：它**必须来自服务端白名单**，客户端**不得自行拼接任意 URL**。
   * 客户端只把这个值**原样**透传给 `POST /techpie/webview-session`。
   */
  targetUrl: string | null;
  /** 服务端判定的状态（客户端不自己推导，只做降级展示） */
  status: TechpieCapabilityStatus;
  /** 与 `status === 'AVAILABLE'` 同值的别名（OpenAPI 形状） */
  available: boolean;
  /** 服务端可覆盖的引导文案 */
  guidance: string | null;
  /** 与 `guidance` 同值的别名（OpenAPI 形状） */
  blockedReason: string | null;
}

/** 能力清单响应（含白名单占位标记 —— 裁决 §11.18-B 第 2 条：必须机器可见） */
export interface TechpieCapabilitiesResult {
  /** 权威字段（规格 §8.1 / Web 端） */
  items: TechpieCapability[];
  /** 与 `items` **同值**的别名（冻结 OpenAPI 形状） */
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
  id: string;
  moduleId: string;
  nameZh: string;
  summary: string;
  phase: TechpiePhase;
  access: TechpieCapabilityAccess;
  platform: CampusPlatform | null;
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
    id: 'ecard.balance',
    moduleId: 'campus-card',
    nameZh: '校园卡余额',
    summary: '一卡通余额查询。走 eCard 的 OPENID 通道，**不需要** CASTGC。',
    phase: 'phase0',
    access: 'openid',
    platform: 'ecard',
    targetUrl: null,
    blockedReason: null,
  },
  {
    id: 'ecard.transactions',
    moduleId: 'campus-card',
    nameZh: '校园卡流水',
    summary: '一卡通消费流水。走 eCard 的 OPENID 通道，**不需要** CASTGC。',
    phase: 'phase0',
    access: 'openid',
    platform: 'ecard',
    targetUrl: null,
    blockedReason: null,
  },
  {
    id: 'ecard.payment_code',
    moduleId: 'campus-card',
    nameZh: '校园卡付款码',
    summary: '付款码（60 秒 TTL、一次性、不进日志）。走 eCard 的 OPENID 通道。',
    phase: 'phase0',
    access: 'openid',
    platform: 'ecard',
    targetUrl: null,
    blockedReason: null,
  },

  /* ---------------- Phase 0 · WebView 直连（W4：用户自登录，我们不接触 cookie） ---------------- */
  {
    id: 'webview.ecourse',
    moduleId: 'techpie',
    nameZh: 'E云课堂',
    summary: '在校园系统页面**自己登录**后使用；可达鸭不接触 cookie（规格 §8.4 方案 W4）。',
    phase: 'phase0',
    access: 'webview',
    platform: null,
    targetUrl: CAMPUS_WEB_ENTRY_TARGETS.ecourse,
    blockedReason: null,
  },
  {
    id: 'webview.student_leave',
    moduleId: 'techpie',
    nameZh: '学生请假',
    summary: '在校园系统页面**自己登录**后使用；可达鸭不接触 cookie（规格 §8.4 方案 W4）。',
    phase: 'phase0',
    access: 'webview',
    platform: null,
    targetUrl: CAMPUS_WEB_ENTRY_TARGETS.studentLeave,
    blockedReason: null,
  },
  {
    id: 'webview.student_activity',
    moduleId: 'techpie',
    nameZh: '学生活动',
    summary: '在校园系统页面**自己登录**后使用；可达鸭不接触 cookie（规格 §8.4 方案 W4）。',
    phase: 'phase0',
    access: 'webview',
    platform: null,
    targetUrl: CAMPUS_WEB_ENTRY_TARGETS.studentActivity,
    blockedReason: null,
  },
  {
    id: 'webview.elrc',
    moduleId: 'techpie',
    nameZh: '课程录播（ELRC）',
    summary: '纯外链 WebView，无 cookie 注入（规格 §3.1 第 8 项）。',
    phase: 'phase0',
    access: 'webview',
    platform: null,
    targetUrl: CAMPUS_WEB_ENTRY_TARGETS.elrc,
    blockedReason: null,
  },

  /* ---------------- Phase 1 · 结构化校园数据（阻塞于信息办书面回复） ---------------- */
  {
    id: 'schedule.courses',
    moduleId: 'schedule',
    nameZh: '课程表',
    summary: '结构化课表数据需要调用 CpDaily API（即需要代持校园会话）。',
    phase: 'phase1',
    access: 'server_proxy',
    platform: 'cpdaily',
    targetUrl: null,
    blockedReason: PHASE_BLOCKED_REASON,
  },
  {
    id: 'schedule.exams',
    moduleId: 'schedule',
    nameZh: '考试表',
    summary: '考试表与课程表同一会话（规格 §3.1 第 2 项）。',
    phase: 'phase1',
    access: 'server_proxy',
    platform: 'cpdaily',
    targetUrl: null,
    blockedReason: PHASE_BLOCKED_REASON,
  },
  {
    id: 'schedule.deadlines',
    moduleId: 'schedule',
    nameZh: 'DDL 聚合',
    summary: 'Blackboard / 考试 / Gradescope / Hydro 的 DDL 聚合（规格 §3.1 第 3 项）。',
    phase: 'phase1',
    access: 'server_proxy',
    platform: 'cpdaily',
    targetUrl: null,
    blockedReason: PHASE_BLOCKED_REASON,
  },
  {
    id: 'auth.school_cas',
    moduleId: 'auth',
    nameZh: '学校统一身份认证直连',
    summary: '一级身份直连学校 CAS（规格 §4.2 方案 A 的目标形态）。',
    phase: 'phase1',
    access: 'server_proxy',
    platform: 'cas',
    targetUrl: null,
    blockedReason: PHASE_BLOCKED_REASON,
  },

  /* ---------------- Phase 2 · 高级能力（依赖 Phase 1 + 上游确认） ---------------- */
  {
    id: 'facility.reservation',
    moduleId: 'facility',
    nameZh: '场馆预约',
    summary: '学校 OA 的场馆预约能力，需要 OA 会话（规格 §2.6 / §3.3）。',
    phase: 'phase2',
    access: 'server_proxy',
    platform: 'cpdaily',
    targetUrl: null,
    blockedReason: PHASE2_BLOCKED_REASON,
  },
  {
    id: 'techpie.auto_renew',
    moduleId: 'techpie',
    nameZh: '会话自动续期',
    summary:
      '自动续期依赖 `/api/auth/renew`（TechPie 自建后端的能力）—— 我们**无法假定它对我们开放**（规格 §6.3 R4 / U8）。',
    phase: 'phase2',
    access: 'server_proxy',
    platform: 'techpie',
    targetUrl: null,
    blockedReason: PHASE2_BLOCKED_REASON,
  },
];

/** 用户当前的绑定情况（由 `CampusSessionPort.listBindings` 提供） */
export interface TechpieBindingView {
  platform: CampusPlatform;
  status: string;
}

/**
 * 判定一条能力的服务端状态（**纯函数**，可单测）。
 *
 * 规则（顺序即优先级）：
 *   1. `phase !== 'phase0'` → `PHASE_BLOCKED`（**先于**绑定判定：
 *      未开放的能力不该提示用户"去绑定"，因为绑了也用不了）；
 *   2. 需要绑定且没有可用绑定 → `CAMPUS_BINDING_REQUIRED`（**不是错误**）；
 *   3. 需要绑定且绑定存在但不可用（EXPIRED/REVOKED/UNLINKED）→ `EXPIRED`；
 *   4. 其余 → `AVAILABLE`。
 *
 * `UPSTREAM_UNAVAILABLE` 在 Phase 0 不会出现 —— Phase 0 的能力**不发上游请求**。
 * 保留该值是为了 Phase 1+ 与失败模式 F4/F7 的语义完整。
 */
export function resolveCapabilityStatus(
  definition: Pick<TechpieCapabilityDefinition, 'phase' | 'platform'>,
  bindings: readonly TechpieBindingView[],
): TechpieCapabilityStatus {
  if (definition.phase !== 'phase0') return 'PHASE_BLOCKED';
  if (definition.platform === null) return 'AVAILABLE';

  const binding = bindings.find((item) => item.platform === definition.platform);
  if (!binding) return 'CAMPUS_BINDING_REQUIRED';
  if (binding.status !== 'LINKED') return 'EXPIRED';
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

export const CAMPUS_PLATFORM_LABEL: Readonly<Record<CampusPlatform, string>> = {
  ecard: '校园一卡通',
  egate: 'eGate 校园门户',
  cpdaily: 'CpDaily 今日校园',
  cas: '统一身份认证（CAS）',
  techpie: 'GeekPie / TechPie 体系',
};

/**
 * 把能力目录 + 用户绑定情况投影成响应条目。
 *
 * **纯函数**：不碰数据库、不碰网络 —— 因此能力清单端点天然满足
 * 契约 §8 的"启动不被上游拖死"（不变式 I5 的同源要求）。
 */
export function buildCapabilities(
  definitions: readonly TechpieCapabilityDefinition[],
  bindings: readonly TechpieBindingView[],
): TechpieCapability[] {
  return definitions.map((definition) => {
    const status = resolveCapabilityStatus(definition, bindings);
    const platform = definition.platform;

    let guidance: string | null = definition.blockedReason;
    if (status === 'CAMPUS_BINDING_REQUIRED' && platform) guidance = bindingRequiredGuidance(platform);
    if (status === 'EXPIRED' && platform) guidance = expiredGuidance(platform);
    if (status === 'AVAILABLE') guidance = null;

    return {
      id: definition.id,
      key: definition.id,
      moduleId: definition.moduleId,
      nameZh: definition.nameZh,
      summary: definition.summary,
      phase: definition.phase,
      access: definition.access,
      platform,
      requiredProvider: platform,
      targetUrl: definition.targetUrl,
      status,
      available: status === 'AVAILABLE',
      guidance,
      blockedReason: guidance,
    };
  });
}
