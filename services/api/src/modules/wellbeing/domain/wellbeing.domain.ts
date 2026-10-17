import type { Page } from '@kedaya/contracts';
import type { ListParams, ResourceRepository } from '../../../common/crud/resource';

/**
 * 心理支持 · wellbeing（契约 §4.1 模块 id `wellbeing`，敏感级 **critical**）
 *
 * ⚠️ **这是一整个仓库里最敏感的一个模块，动它之前请先读完这段**。
 *
 * 一、文案纪律
 * 契约里的模块中文名沿用了一个承诺性的旧词，但产品形态是**心理支持**
 * （倾听 + 预约入口 + 危机出口），因此本模块**面向用户的文案一律写「支持」**，
 * 禁止出现「治疗 / 诊疗 / 心理医生 / 诊断」这类会让人以为"来了就能被治好"的措辞。
 * 契约里的中文名要改是 owner 的决策（`@kedaya/contracts` 是冻结契约），
 * 这里只保证本模块自己这一侧不再复制那个词。
 *
 * 二、五条不可回退的约束（契约 §9）
 *   1. **二次同意**：所有预约数据读写前先 `requireConsent()`；
 *   2. **审计**：读写全部 fail-closed 落审计（写不进去就不放行）；
 *   3. **归属只来自 JWT**：`userId` 不在请求体里，客户端无法替别人建预约；
 *   4. **只看自己**：列表强制按主体收窄，非本人一律 `NOT_FOUND`（403 等于确认"存在"）；
 *   5. **危机出口公开**：`crisis-line` 无需登录、无需同意，且前端必须**首屏**渲染。
 *
 * 纯领域：零框架依赖。
 */

/** 契约 §4 模块 id —— 与 @kedaya/contracts 的 MODULES 保持一致 */
export const WELLBEING_MODULE_ID = 'wellbeing';

/* ------------------------------------------------------------------ *
 * 状态机（白名单）
 *
 * 与 `takeout-guard` 同一套做法：状态只能经**领域动作**跃迁，
 * `PATCH` 的输入类型里根本没有 `status`（否则任何人都能把预约改成"已完成"）。
 * ------------------------------------------------------------------ */

export const WELLBEING_STATUS = {
  /** 已提交，等中心确认 */
  requested: 'requested',
  /** 中心已确认时间与方式 */
  confirmed: 'confirmed',
  /** 已完成（见过面 / 通完电话） */
  completed: 'completed',
  /** 本人取消 */
  cancelled: 'cancelled',
} as const;
export type WellbeingStatus = (typeof WELLBEING_STATUS)[keyof typeof WELLBEING_STATUS];

/** 供 Zod `z.enum` 与 data 层 `buildWhere` 复用的白名单（客户端 `WELLBEING_STATUSES` 与之对齐） */
export const WELLBEING_STATUSES = [
  WELLBEING_STATUS.requested,
  WELLBEING_STATUS.confirmed,
  WELLBEING_STATUS.completed,
  WELLBEING_STATUS.cancelled,
] as const;

/** 新建预约的初始状态。由服务层写入，客户端无法指定 */
export const WELLBEING_DEFAULT_STATUS: WellbeingStatus = WELLBEING_STATUS.requested;

/**
 * 可以取消的状态。
 *
 * `completed` 与 `cancelled` 是终态，取消它们没有意义（服务层返回 CONFLICT）。
 * 客户端的 `cancellable()` 与这里逐条对齐，避免"按钮点得动但服务端必拒"。
 */
export const WELLBEING_CANCELLABLE_STATUSES: readonly WellbeingStatus[] = [
  WELLBEING_STATUS.requested,
  WELLBEING_STATUS.confirmed,
];

/* ------------------------------------------------------------------ *
 * 方式 / 上限 / 时间偏差
 * ------------------------------------------------------------------ */

export const WELLBEING_MODE = {
  online: 'online',
  onsite: 'onsite',
} as const;
export type WellbeingMode = (typeof WELLBEING_MODE)[keyof typeof WELLBEING_MODE];

export const WELLBEING_MODES = [WELLBEING_MODE.online, WELLBEING_MODE.onsite] as const;

/** 默认方式：线下（面对面能得到的支持通常比线上更多） */
export const WELLBEING_DEFAULT_MODE: WellbeingMode = WELLBEING_MODE.onsite;

/** 文本上限（与小程序 `domain/models/wellbeing.ts` 同值，客户端只做即时提示） */
export const WELLBEING_COUNSELOR_MAX = 120;
export const WELLBEING_NOTE_MAX = 1000;

/**
 * 预约时间相对"现在"允许的时钟偏差：5 分钟。
 *
 * 手机时钟略快不该让用户提交失败；但选一个已经过去的时间没有意义
 * （与 `takeout-guard` 的 `TAKEOUT_CLOCK_SKEW_MS` 同一套判定）。
 */
export const WELLBEING_SLOT_TOLERANCE_MS = 5 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * 领域模型与输入
 * ------------------------------------------------------------------ */

export interface WellbeingAppointmentModel {
  id: string;
  userId: string;
  /** 用户想约的老师 / 咨询师（以学校公布的名单为准；不清楚可以填「不限」） */
  counselor: string;
  /** 预约时间 */
  slotAt: Date;
  /** online | onsite */
  mode: string;
  status: string;
  /** 最小化采集：仅存用户主动填写的诉求摘要（契约 §9） */
  note: string | null;
  /**
   * 危机干预标记。
   *
   * 刻意做成**与 status 正交**的标记：触发危机出口不等于把预约改成某个终态 ——
   * 用户可能在被给出热线之后仍然继续这次预约（取消与否由用户自己决定）。
   */
  crisisFlag: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 客户端可见的创建输入 —— **没有** `userId` / `status` / `crisisFlag`。
 * 归属与初始状态由服务层决定，Zod schema 与它保持同形。
 */
export interface WellbeingAppointmentDraft {
  counselor: string;
  slotAt: Date;
  mode?: string;
  note?: string | null;
}

/** data 层落库用的完整输入：在客户端输入之上补上服务层决定的归属与状态 */
export interface WellbeingAppointmentCreateRecord extends WellbeingAppointmentDraft {
  /** 由服务层从登录主体注入，不接受请求体传入 */
  userId: string;
  status: WellbeingStatus;
  crisisFlag: boolean;
}

/**
 * 更新输入（全部可选）。
 *
 * 刻意**不含** `status` / `userId` / `crisisFlag`：
 *   · 状态只能走领域动作（`cancel` / `escalateCrisis`），不是 PATCH 能写的；
 *   · 归属永远不可变（否则 PATCH 就成了越权口子）。
 */
export interface UpdateWellbeingAppointmentInput {
  slotAt?: Date;
  mode?: string;
  note?: string | null;
}

export type WellbeingAppointmentRepository = ResourceRepository<
  WellbeingAppointmentModel,
  WellbeingAppointmentCreateRecord,
  UpdateWellbeingAppointmentInput
> & {
  /**
   * 必须按用户过滤：敏感数据绝不能跨用户列出。
   *
   * `params.filters` 已经是**白名单后的标量**（服务层只会塞 `status`），
   * data 层再逐字段翻译成 Prisma `where`（见 data 层的 `buildWhere`）。
   */
  listByUser(
    userId: string,
    params: ListParams,
  ): Promise<Page<WellbeingAppointmentModel>>;

  /** 领域动作专用：由服务层校验状态机后调用，不允许任何 PATCH 直接写 status */
  applyStatus(id: string, status: WellbeingStatus): Promise<WellbeingAppointmentModel>;

  /**
   * 领域动作专用：打上危机干预标记（**不改 status**）。
   *
   * 单独开一个方法而不是走 `update`，是为了让"危机干预"这件事在 data 层也能被
   * 一眼看到 —— 它牵动的是热线出口，不是一条普通字段。
   */
  markCrisis(id: string): Promise<WellbeingAppointmentModel>;
};

export const WELLBEING_APPOINTMENT_REPOSITORY = Symbol(
  'KEDAYA_WELLBEING_APPOINTMENT_REPOSITORY',
);

/* ------------------------------------------------------------------ *
 * 危机出口（契约 §9：必须提供，且不可被埋进二级菜单）
 * ------------------------------------------------------------------ */

export interface CrisisLineHotline {
  name: string;
  /** 可直接拨打的号码（客户端会调 `makePhoneCall`；非号码类文案要另开 channel） */
  number: string;
}

/** 打不了电话时的下一步（辅导员 / 保卫处）—— 绝不只写"请寻求专业帮助" */
export interface CrisisLineChannel {
  name: string;
  /** 可执行的下一步说明 */
  instruction: string;
}

export interface CrisisLine {
  module: string;
  title: string;
  message: string;
  hotlines: CrisisLineHotline[];
  channels: CrisisLineChannel[];
  /** 前端必须首屏可见，禁止折叠/二级菜单 */
  prominence: 'primary';
  requiresLogin: false;
  requiresConsent: false;
}

/**
 * 危机出口的**可运营配置**：换学校 / 换号码 / 改文案只改这一处。
 *
 * 号码可以用环境变量覆盖（`WELLBEING_CRISIS_*`）—— 学校换合作机构时不必发版。
 */
export interface CrisisHotlineConfigEntry {
  /** 覆盖用的环境变量名 */
  envKey: string;
  name: string;
  /** 默认号码（环境变量缺省时使用） */
  defaultNumber: string;
}

export const WELLBEING_CRISIS_CONFIG: {
  title: string;
  message: string;
  hotlines: readonly CrisisHotlineConfigEntry[];
  channels: readonly CrisisLineChannel[];
} = {
  title: '紧急情况 · 立刻找人',
  message:
    '如果你或身边的人有自伤、伤人的风险，请马上拨打 110（报警）或 120（急救），也可以直接找辅导员、学校保卫处，或任何一位你信任的人陪着。你不需要登录，也不需要同意任何条款。',
  hotlines: [
    { envKey: 'WELLBEING_CRISIS_EMERGENCY_POLICE', name: '紧急报警（有自伤 / 伤人风险）', defaultNumber: '110' },
    { envKey: 'WELLBEING_CRISIS_EMERGENCY_MEDICAL', name: '急救', defaultNumber: '120' },
    {
      envKey: 'WELLBEING_CRISIS_HOTLINE',
      name: '全国 24 小时心理援助热线',
      defaultNumber: '021-12320-5',
    },
    {
      envKey: 'WELLBEING_CRISIS_HOTLINE_ALT',
      name: '希望 24 热线（全国）',
      defaultNumber: '400-161-9995',
    },
  ],
  channels: [
    {
      name: '辅导员',
      instruction: '直接给辅导员发消息或打电话，说清楚「我现在需要有人陪着」；不必先解释背景。',
    },
    {
      name: '学校保卫处',
      instruction: '拨打保卫处值班电话，或到最近的门卫室 / 值班室当面求助（校内最快能到人）。',
    },
  ],
};

/**
 * ⚠️ **上线前必须核实**（写在代码里，避免它只存在于某次口头交接）：
 *
 *   1. 上面每一个号码都要**真实拨通一次**再上线：热线会因为机构调整而停用/换号
 *      （例如「希望 24 热线」历史上多次变更），停用的号码出现在危机出口上比没有更糟；
 *   2. `110` / `120` 是全国统一的，但**学校保卫处与辅导员的值班电话**必须由校方提供，
 *      并写进 `WELLBEING_CRISIS_*` 环境变量（代码里的 channel 只给"找谁"，不给号）；
 *   3. 号码、文案、可拨打性每次改动都要过一遍本函数的单测（`wellbeing.service.spec.ts`）。
 */
export const WELLBEING_CRISIS_VERIFY_NOTE = '上线前必须逐个拨通核实，并由校方提供保卫处 / 辅导员值班电话';
