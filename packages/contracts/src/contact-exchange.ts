/**
 * 联系方式交换（U8）· wire 契约
 *
 * 背景：搭子 / 拼单 / 跑腿等模块在「双方都同意」后需要交换联系方式，
 * 但**不得默认暴露**手机号 / 微信号（冻结契约 §9 隐私与合规）。
 *
 * ## 这个文件冻结什么
 *
 * 只冻结**跨端 wire 形状与枚举**，不冻结实现：
 *   · 可交换条目的类型（`wechat | phone | email | qq`）；
 *   · 申请状态机（`PENDING | ACCEPTED | REJECTED | REVOKED | EXPIRED`）；
 *   · 列表方向（`incoming/outgoing/all`、`inbound/outbound`）；
 *   · 环境变量名、24h 限流窗口与默认阈值；
 *   · 服务端返回的 DTO 形状。
 *
 * ## 不冻结什么
 *
 * 密文格式、指纹算法、数据库列名、限流的具体实现（数据库计数 / Redis）
 * 都属于实现细节。客户端只依赖本文件的枚举与 DTO。
 *
 * ## 隐私硬约束（与 00-FROZEN-CONTRACT.md §9 一致）
 *
 * 1. `shared` 默认 `false` —— 新建条目**不参与交换**，必须用户显式打开；
 * 2. 未达成 `ACCEPTED` 前，任何响应都**不得**包含对方联系方式的明文或脱敏值；
 * 3. 撤销后立即不可见 —— 交换的是"读取权限"，不是联系方式副本；
 * 4. 审计记录只保存条目 id / 类型 / 时间，**绝不保存 value 或密文**。
 */

/** 可交换的联系方式类型（冻结） */
export const CONTACT_KINDS = ['wechat', 'phone', 'email', 'qq'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** 申请状态（冻结）。`EXPIRED` 由 `expiresAt` 到期推导，不是用户动作。 */
export const CONTACT_EXCHANGE_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'REVOKED',
  'EXPIRED',
] as const;
export type ContactExchangeStatus = (typeof CONTACT_EXCHANGE_STATUSES)[number];

/** 我的申请列表方向 */
export const CONTACT_EXCHANGE_LIST_DIRECTIONS = ['incoming', 'outgoing', 'all'] as const;
export type ContactExchangeListDirection = (typeof CONTACT_EXCHANGE_LIST_DIRECTIONS)[number];

/** 审计查询方向：谁看了我 / 我看了谁 */
export const CONTACT_AUDIT_DIRECTIONS = ['inbound', 'outbound'] as const;
export type ContactAuditDirection = (typeof CONTACT_AUDIT_DIRECTIONS)[number];

/**
 * 允许作为交换上下文的模块（冻结）。
 *
 * 只放「会产生线下见面 / 交易」的模块。`wellbeing` / `dorm-harmony` /
 * `ai-portrait` 等敏感域**永远不允许**成为交换上下文 —— 它们的隐私门是独立的，
 * 不能被"交换联系方式"这条路径绕过。
 *
 * 新增上下文必须同时改本文件与 OpenAPI/规格，不允许客户端自创。
 */
export const CONTACT_EXCHANGE_CONTEXT_MODULES = [
  'buddy',
  'groupbuy',
  'errand',
  'flea-market',
  'lost-found',
  'facility',
] as const;
export type ContactExchangeContextModule = (typeof CONTACT_EXCHANGE_CONTEXT_MODULES)[number];

/** 路由段（不是用户可见模块，故不进 `MODULES`） */
/**
 * 联系方式交换的**路由前缀**。
 *
 * ⚠️ 它挂在 `profile` 下，而不是自成一个 `contact-exchange` 模块。
 * 理由：契约 §6 有一条硬性不变式 —— **每个端点都必须属于某个用户可见模块**
 * （`openapi.test.ts` 会断言"所有路径的首段都是已注册模块路由"）。
 * 联系方式就是「我的资料」的一部分，挂在 `profile` 下既符合这条规则，
 * 语义上也对。
 *
 * 实现仍然是**独立模块**（`modules/contact-exchange/`）：
 * `profile` 的通用 CRUD 表达不了「条目级授权 + 明文加密 + 查看审计」。
 * **路由归属**与**代码归属**是两件事。
 */
export const CONTACT_EXCHANGE_ROUTE = 'profile';

/** 环境变量名：密钥**无默认值**，缺失时应用启动失败（fail closed） */
export const CONTACT_EXCHANGE_ENC_KEY_ENV = 'CONTACT_EXCHANGE_ENC_KEY';

/** 同一对用户 24h 内最多申请次数（环境变量可覆盖） */
export const CONTACT_EXCHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CONTACT_EXCHANGE_DEFAULT_RATE_LIMIT = 3;
export const CONTACT_EXCHANGE_RATE_LIMIT_ENV = 'CONTACT_EXCHANGE_RATE_LIMIT';

/** 待同意申请的有效期（7 天）；`ACCEPTED` 不自动过期，只能撤销 */
export const CONTACT_EXCHANGE_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * wire DTO
 * ------------------------------------------------------------------ */

/** 我自己的联系方式条目（仅本人可见；`value` 为明文，用于管理） */
export interface ContactEntryWire {
  id: string;
  kind: ContactKind;
  label: string | null;
  /** 明文。只出现在「我的联系方式」响应里，永不出现在交换申请详情里。 */
  value: string;
  /** 是否授权给交换对象。默认 false。 */
  shared: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 申请详情（**只含关系元数据，绝不含任何联系方式字段**） */
export interface ContactExchangeRequestWire {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: ContactExchangeStatus;
  contextModule: ContactExchangeContextModule;
  contextId: string | null;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  respondedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
}

/** 对方已授权的单条联系方式（仅 `ACCEPTED` 后返回） */
export interface ExchangedContactWire {
  id: string;
  kind: ContactKind;
  label: string | null;
  /** 明文。读取行为会写审计（不含明文）。 */
  value: string;
}

/** 查看对方联系方式的响应 */
export interface ExchangedContactsWire {
  requestId: string;
  counterpartyId: string;
  entries: ExchangedContactWire[];
  /** 本次读取的审计时间（ISO-8601）。 */
  viewedAt: string;
}

/** 查看审计（只含 id / 类型 / 时间，绝不含 value 或密文） */
export interface ContactAccessAuditWire {
  id: string;
  requestId: string;
  actorId: string;
  subjectId: string;
  action: 'view_contacts';
  entryIds: string[];
  entryKinds: ContactKind[];
  entryCount: number;
  at: string;
}

/* ------------------------------------------------------------------ *
 * 类型守卫
 * ------------------------------------------------------------------ */

export function isContactKind(value: string): value is ContactKind {
  return (CONTACT_KINDS as readonly string[]).includes(value);
}

export function isContactExchangeStatus(value: string): value is ContactExchangeStatus {
  return (CONTACT_EXCHANGE_STATUSES as readonly string[]).includes(value);
}

export function isContactExchangeContextModule(value: string): value is ContactExchangeContextModule {
  return (CONTACT_EXCHANGE_CONTEXT_MODULES as readonly string[]).includes(value);
}
