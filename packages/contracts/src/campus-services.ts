/**
 * 校园服务对接的描述契约 —— **「哪些校内系统已接通」的唯一真相**。
 *
 * ## 为什么需要这个文件
 *
 * 在此之前，「哪些校园服务是真的接通了」这件事散落在三处：
 *   · 后端 `CAMPUS_DATA_MODE` 环境变量（决定 mock / live）；
 *   · `apps/web` 的 `delivery.ts`（决定门户上标"接口就绪"还是"已上线"）；
 *   · 各端页面里的文案（「演示数据」「模拟」之类）。
 *
 * 三处各写一份的后果是可预测的：**某天后端切了 live，页面还写着「演示数据」**，
 * 或者反过来 —— 页面说"已接通"，后端其实还在 mock。用户看到的是"平台在假装"。
 *
 * 这个文件把「服务 → 平台枚举 → 数据源 → 授权状态 → 当前模式」表达成类型，
 * 供三端与文档共用。**不要在别处另写一份判断。**
 *
 * ## 与本文件配套的诚实约束
 *
 * `authorization` 字段是**法律/授权状态**，不是技术状态。
 * 技术上线（`mode: 'live'`）与获得校方授权是**两件独立的事** ——
 * 没有授权就切 live 是违规，有授权但没接线是未完成。
 * 因此两者分开表达，且**默认都是「未确认」**（fail closed）。
 */

/* ------------------------------------------------------------------ *
 * 平台枚举（契约 §11.20：小写，与后端统一）
 * ------------------------------------------------------------------ */

export const CAMPUS_PLATFORMS = ['cas', 'egate', 'cpdaily', 'jwc', 'ecard', 'techpie'] as const;
export type CampusPlatform = (typeof CAMPUS_PLATFORMS)[number];

export const CAMPUS_PLATFORM_LABELS: Readonly<Record<CampusPlatform, string>> = {
  cas: '统一身份认证（CAS）',
  egate: 'eGate 门户',
  cpdaily: '今日校园 / cqmobile',
  jwc: '教务处（JWC）',
  ecard: '校园卡（Ecard）',
  techpie: '技术服务目录（TechPie）',
};

/* ------------------------------------------------------------------ *
 * 三个正交的状态
 * ------------------------------------------------------------------ */

/**
 * 技术上「现在跑的是什么」。
 *
 * - `mock`：确定性模拟数据，响应必须标 `simulated: true`；
 * - `live`：真的打校方接口；
 * - `not-wired`：连适配器都没有（调用会抛错，而不是返回空）。
 */
export type CampusDataMode = 'mock' | 'live' | 'not-wired';

/**
 * 授权状态 —— **法律事实，不是技术事实**。
 *
 * - `none`：没有授权（当前状态）；
 * - `pending`：申请中；
 * - `granted`：已获书面授权（**必须有书面凭证**，口头同意不算）；
 * - `unknown`：未确认（默认值，fail closed）。
 */
export type CampusAuthorization = 'none' | 'pending' | 'granted' | 'unknown';

/**
 * 真实对接点的**可达性**。
 *
 * 这是给维护者看的：切 live 到底要改哪里。
 * `null` 表示「还没有真实适配器」。
 */
export interface CampusIntegrationPoint {
  /** 适配器文件路径（相对仓库根） */
  readonly adapterFile: string | null;
  /** 切 live 需要配置的环境变量名 */
  readonly envKeys: readonly string[];
  /** 上游地址是否已确认（**未确认时不得编造 URL**） */
  readonly upstreamConfirmed: boolean;
  /** 一句话说明为什么还没接通 */
  readonly blockedBy: string | null;
}

/** 一条校园服务的完整描述 */
export interface CampusServiceDescriptor {
  readonly platform: CampusPlatform;
  readonly label: string;
  /** 技术上现在跑的 */
  readonly mode: CampusDataMode;
  /** 授权状态（默认 `unknown`） */
  readonly authorization: CampusAuthorization;
  /** 这个服务提供哪类数据 */
  readonly provides: readonly string[];
  /** 真实对接点 */
  readonly integration: CampusIntegrationPoint;
  /**
   * 用户在端上会看到什么 —— **这句必须与 `mode` 一致**。
   * `mode: 'mock'` 时不能写"已同步"。
   */
  readonly userFacingNote: string;
}

/* ------------------------------------------------------------------ *
 * 当前真相（2026-10-18）
 * ------------------------------------------------------------------ */

/**
 * ⚠️ **改这里之前先读下面每个 `blockedBy`。**
 *
 * 全部服务当前都是 `mock` 且 `authorization: 'none'`。
 * 上游地址**一个都未确认** —— 仓库里没有任何校方接口的正式文档，
 * 所以 `upstreamConfirmed` 全为 false，`envKeys` 里列的是**我们预留的名字**，
 * 不是校方给的名字。
 */
export const CAMPUS_SERVICES: readonly CampusServiceDescriptor[] = [
  {
    platform: 'cas',
    label: CAMPUS_PLATFORM_LABELS.cas,
    mode: 'mock',
    authorization: 'none',
    provides: ['第一级身份：学号 / 姓名 / 院系'],
    integration: {
      adapterFile: 'services/api/src/modules/auth/data/mock-campus-auth.provider.ts',
      envKeys: ['CAMPUS_CAS_LOGIN_URL', 'CAMPUS_CAS_VALIDATE_URL'],
      upstreamConfirmed: false,
      blockedBy: 'CAS 的 service ticket 校验端点与 RSA 公钥需要校方提供；未拿到前用 mock 适配器',
    },
    userFacingNote: '演示期：登录为模拟身份，不是真实学号',
  },
  {
    platform: 'egate',
    label: CAMPUS_PLATFORM_LABELS.egate,
    mode: 'mock',
    authorization: 'none',
    provides: ['学生基本信息', '院系 / 年级'],
    integration: {
      adapterFile: 'services/api/src/modules/auth/data/http-campus-data.adapter.ts',
      envKeys: ['CAMPUS_EGATE_DATA_URL'],
      upstreamConfirmed: false,
      blockedBy: 'eGate 的数据接口未公开，需要校方开放并给出字段定义',
    },
    userFacingNote: '演示期：数据为模拟生成，标注 simulated',
  },
  {
    platform: 'cpdaily',
    label: CAMPUS_PLATFORM_LABELS.cpdaily,
    mode: 'mock',
    authorization: 'none',
    provides: ['课表（学期 / 课程 / 时间地点）'],
    integration: {
      adapterFile: 'services/api/src/modules/auth/data/http-campus-data.adapter.ts',
      envKeys: ['CAMPUS_CPDAILY_DATA_URL'],
      upstreamConfirmed: false,
      blockedBy: '今日校园的课表接口需要校方账号体系授权；当前用确定性模拟数据',
    },
    userFacingNote: '演示期：课表为模拟生成，与真实课表无关',
  },
  {
    platform: 'jwc',
    label: CAMPUS_PLATFORM_LABELS.jwc,
    mode: 'mock',
    authorization: 'none',
    provides: ['考试安排', '成绩'],
    integration: {
      adapterFile: 'services/api/src/modules/auth/data/http-campus-data.adapter.ts',
      envKeys: ['CAMPUS_JWC_DATA_URL'],
      upstreamConfirmed: false,
      blockedBy: '教务处系统未对外开放接口；成绩属高敏数据，需要单独授权与审计',
    },
    userFacingNote: '演示期：考试与成绩为模拟数据',
  },
  {
    platform: 'ecard',
    label: CAMPUS_PLATFORM_LABELS.ecard,
    mode: 'mock',
    authorization: 'none',
    provides: ['校园卡余额', '交易流水', '付款码'],
    integration: {
      adapterFile: 'services/api/src/modules/auth/data/http-campus-data.adapter.ts',
      envKeys: ['CAMPUS_CARD_DATA_URL'],
      upstreamConfirmed: false,
      blockedBy: '校园卡涉及资金，需要校方与银行侧双重授权；付款码在 mock 下**故意返回 503** 而不是假码',
    },
    userFacingNote: '演示期：余额与流水为模拟；付款码不可用（不提供假码）',
  },
  {
    platform: 'techpie',
    label: CAMPUS_PLATFORM_LABELS.techpie,
    mode: 'live',
    authorization: 'granted',
    provides: ['校内技术服务目录（人工核对）'],
    integration: {
      adapterFile: 'services/api/src/modules/techpie/techpie.service.ts',
      envKeys: [],
      upstreamConfirmed: true,
      blockedBy: null,
    },
    // ⚠️ 这一条是刻意的：techpie **没有上游同步**，它是同学共建 + 人工核对。
    // 写"已同步"会让用户以为是自动抓的。
    userFacingNote: '同学共建的服务目录，人工核对；不是从上游自动同步',
  },
] as const;

/* ------------------------------------------------------------------ *
 * 派生的判断（三端共用，不要各写一份）
 * ------------------------------------------------------------------ */

export function campusServiceOf(platform: CampusPlatform): CampusServiceDescriptor {
  const found = CAMPUS_SERVICES.find((service) => service.platform === platform);
  if (found === undefined) {
    throw new Error(`未登记的校园服务：${platform}`);
  }
  return found;
}

/** 该服务当前是否在跑模拟数据（决定要不要显示「演示」字样） */
export function isSimulated(platform: CampusPlatform): boolean {
  return campusServiceOf(platform).mode === 'mock';
}

/** 该服务是否可以安全地展示真实数据（mock + 无授权 ⇒ 不可以） */
export function canShowAsReal(platform: CampusPlatform): boolean {
  const service = campusServiceOf(platform);
  return service.mode === 'live' && service.authorization === 'granted';
}

/**
 * 三端统一的「演示期」提示文案。
 *
 * 存在意义：`simulated: true` 是**接口字段**，普通用户看不到；
 * 用户需要一句人话。这句话不能各端各写（措辞漂移会让"到底哪些是假的"变模糊）。
 */
export function simulatedNotice(platform: CampusPlatform): string {
  const service = campusServiceOf(platform);
  if (canShowAsReal(platform)) return '';
  return `${service.label}当前为演示数据，与真实数据无关。`;
}
