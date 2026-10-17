import { InternalError } from '../../../common/errors/app-error';
import {
  isActiveLinkStatus,
  type CampusBindingState,
  type CampusPlatform,
} from '../../techpie/domain/ports/campus-session.port';

/* ================================================================== *
 * 第一级 · 身份层（Identity）
 *
 * 契约 §5 硬规则 1：
 *   "AuthPort 只认第一级。它**不知道**任何校园系统的 cookie/session/tgc。"
 *
 * ⚠️ 第二级（能力层）的端口**不在本文件里** —— 它在
 * `modules/techpie/domain/ports/campus-session.port.ts`。
 * 这是不变式 **I2** 的结构性落地：身份层在**类型上**就拿不到校园会话端口，
 * 而不是靠"记得不要 import"（ADR 0004 §2.2 的 L2/L3 教训）。
 * ================================================================== */

export type CampusIdentityProvider = 'SHTU_CAS' | 'SHTU_EGATE';

/** 纯身份：回答"你是谁"。**不允许**出现任何凭据字段。 */
export interface CampusIdentity {
  provider: CampusIdentityProvider;
  /** 上游唯一标识（CAS 的学号 / OAuth 的 sub） */
  externalId: string;
  email?: string;
  realName?: string;
  department?: string;
}

/**
 * 第一级端口。
 *
 * 注意它**只有**一个方法，且返回类型是 `CampusIdentity` ——
 * 类型系统层面就不给"顺手把 session 带出来"留口子。
 */
export interface AuthPort {
  /** 用 CAS ticket 换取身份。实现方必须在返回前丢弃 ticket。 */
  authenticateTicket(ticket: string): Promise<CampusIdentity>;
}

export const AUTH_PORT = Symbol('KEDAYA_AUTH_PORT');

/* ================================================================== *
 * KedaYa 自有账户
 * ================================================================== */

export interface UserRecord {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  department: string | null;
  /**
   * 学号（来自 `AuthIdentity.externalId`）。**不是**凭证 ——
   * 它是第一级身份的一部分，回答"你是谁"。
   */
  studentId: string | null;
  createdAt: Date;
}

export interface UserRepository {
  /** 首次登录建档；已存在则刷新身份映射并返回既有账户 */
  upsertFromIdentity(identity: CampusIdentity): Promise<UserRecord>;
  findById(id: string): Promise<UserRecord | null>;
}

export const USER_REPOSITORY = Symbol('KEDAYA_USER_REPOSITORY');

/* ================================================================== *
 * 契约 §11.4 I1：身份层会话的序列化形状
 * ================================================================== */

/**
 * 一级身份会话的**唯一**投影（契约 §11.4 I1 / 规格 §4.2）。
 *
 * ```ts
 * export interface KedaYaIdentitySession {
 *   userId: string;
 *   studentId: string | null;
 *   name: string | null;
 *   department: string | null;
 *   // 严禁出现：cookie / cookies / session / sessionToken / tgc / castgc / ticket / tenant
 * }
 * ```
 *
 * 强制手段（ADR §7 已规定，这里是具体实现）：
 *   1. **类型上没有**那 8 个键；
 *   2. `assertIdentitySessionHasNoCredentialKeys()` 运行时兜底；
 *   3. `test/techpie-arch.spec.ts` 对**真实 HTTP 响应体**做递归键名扫描（I1）。
 */
export interface KedaYaIdentitySession {
  userId: string;
  studentId: string | null;
  name: string | null;
  department: string | null;
}

/** 契约 §11.4 I1 冻结的 8 个禁用键名 */
export const IDENTITY_SESSION_FORBIDDEN_KEYS: readonly string[] = [
  'cookie',
  'cookies',
  'session',
  'sessionToken',
  'tgc',
  'castgc',
  'ticket',
  'tenant',
];

/**
 * 运行时兜底：身份会话（及其嵌套结构）里一旦出现禁用键名就抛 `INTERNAL`。
 *
 * 键名比较**大小写不敏感**且忽略 `_` / `-`：`session_token` / `sessionToken` /
 * `SESSION-TOKEN` 是同一个东西。**错误信息不回显任何值**（规格 §10.3）。
 */
export function assertIdentitySessionHasNoCredentialKeys(
  value: unknown,
  where = 'KedaYaIdentitySession',
): void {
  const normalize = (key: string): string => key.toLowerCase().replace(/[_-]/g, '');
  const wanted = new Set(IDENTITY_SESSION_FORBIDDEN_KEYS.map(normalize));

  const walk = (node: unknown, depth: number): void => {
    if (depth > 8 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (wanted.has(normalize(key))) {
        throw new InternalError(`${where} 违反契约 §11.4 I1：序列化里出现了被禁的凭据键名（键名已脱敏）`);
      }
      walk(child, depth + 1);
    }
  };

  walk(value, 0);
}

/**
 * 账户记录 → 一级身份会话。
 *
 * **逐字段挑选**（不是解构后删字段）：将来给 `UserRecord` 加字段时，
 * 它**默认不会**出现在会话里 —— "不小心把校园凭据暴露进身份通道"这种事故
 * 在结构上就不可能发生。
 */
export function toIdentitySession(user: UserRecord): KedaYaIdentitySession {
  const session: KedaYaIdentitySession = {
    userId: user.id,
    studentId: user.studentId,
    name: user.displayName,
    department: user.department,
  };
  assertIdentitySessionHasNoCredentialKeys(session);
  return session;
}

/* ================================================================== *
 * 契约 §5 的运行时护栏
 * ================================================================== */

/**
 * 任何看起来像凭据的字段名都不允许出现在身份对象里。
 *
 * 这是把「契约 §5 硬规则 1」从"文档约定"变成**可执行断言**：
 * 一旦有人给 AuthPort 的实现加回 session/cookie 字段，
 * 登录会立刻失败并给出明确错误，而不是把凭据悄悄泄漏到 API 响应里。
 */
const FORBIDDEN_IDENTITY_KEY = /(cookie|session|tgc|ticket|token|credential|password|secret)/i;

export function assertIdentityOnly(
  identity: CampusIdentity,
  providerName = 'CampusAuthProvider',
): CampusIdentity {
  const leaked = Object.keys(identity as unknown as Record<string, unknown>).filter((key) =>
    FORBIDDEN_IDENTITY_KEY.test(key),
  );

  if (leaked.length > 0) {
    throw new InternalError(
      `${providerName} 违反契约 §5：AuthPort 返回了校园系统凭据字段 [${leaked.join(', ')}]。` +
        '校园 session 必须走 CampusSessionPort。',
    );
  }
  return identity;
}

/* ================================================================== *
 * `/auth/campus-bindings` 的 wire 类型（契约 §11.19-C / §11.20-A）
 * ================================================================== */

/**
 * 校园系统绑定的**摘要**（`/auth/*` 的 wire 类型，冻结 OpenAPI `CampusBindingSummary`）。
 *
 * ## ⚠️ 这个名字**只属于** `/auth/campus-bindings`
 *
 * §11.19-C / §11.20-A 的裁决：`/techpie/links` 的元素用 **`TechpieLink`**，
 * 本类型**不再被 techpie 引用**。同名两形状是**最坏的一类契约缺陷** ——
 * 它会让实现者按名字去猜，而猜错不会报错、只会静默错。
 * 两者本来就是不同概念：
 *   · `CampusBindingSummary`（`/auth/*`）= **二级身份绑定状态摘要**（面向登录态）；
 *   · `TechpieLink`（`/techpie/*`）= **一条可管理的绑定资源**（有 id、可解绑、可续期）。
 *
 * 端口类型叫 **`CampusBindingState`**（§11.20-B）—— port / wire 不得同名。
 *
 * ⚠️ §11.22-D 通用规则：**可空的可选字段为空时省略键，而不是下发 `null`**。
 *
 * ⚠️ 契约 §11.22-A 精确化后的 **I1** 直接约束本类型所在的端点：
 * `/auth/*` 的全部响应序列化键名不得包含
 * `cookie` / `cookies` / `session` / `sessionToken` / `tgc` / `castgc` / `ticket` / `tenant`。
 */
export interface CampusBindingSummary {
  platform: CampusPlatform;
  /** 该校园系统当前是否可用（= 绑定状态为 `ACTIVE`） */
  bound: boolean;
  /** 绑定到期时刻；无到期时间时**省略该键**（§11.22-D） */
  expiresAt?: string;
  /** 上次续期时刻；Phase 0 从不续期（`RENEW_NOT_SUPPORTED`），因此通常省略该键 */
  lastRenewedAt?: string;
}

/**
 * 端口状态 → `/auth/campus-bindings` 的 wire 摘要（**唯一**的投影实现）。
 *
 * 逐字段挑选 + 运行时断言（I1）：即便将来端口类型加了字段，
 * 也不会顺着这个函数漏进 `/auth/*` 的响应。
 */
export function toCampusBindingSummary(state: CampusBindingState): CampusBindingSummary {
  const summary: CampusBindingSummary = {
    platform: state.provider,
    bound: isActiveLinkStatus(state.status),
  };
  // §11.22-D：为空则**省略键**，不下发 `null`
  if (state.expiresAt !== null) summary.expiresAt = state.expiresAt;

  assertIdentitySessionHasNoCredentialKeys(summary, 'CampusBindingSummary');
  return summary;
}
