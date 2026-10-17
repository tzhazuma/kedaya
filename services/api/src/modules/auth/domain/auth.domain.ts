import { InternalError } from '../../../common/errors/app-error';

/* ================================================================== *
 * 第一级 · 身份层（Identity）
 *
 * 契约 §5 硬规则 1：
 *   "AuthPort 只认第一级。它**不知道**任何校园系统的 cookie/session/tgc。"
 * ================================================================== */

/**
 * 第一级的**身份来源**。
 *
 * 注意它们都只是"你是谁"，与"你能访问哪些校园系统"（第二级）无关：
 *   · SHTU_CAS / SHTU_EGATE —— 上科大统一身份认证
 *   · WECHAT_MINIPROGRAM    —— 微信小程序登录（同一身份层，另一条入口）
 *   · LOCAL_EMAIL           —— 自建邮箱账号（凭据存 UserCredential，不落本表）
 */
export type CampusIdentityProvider = 'SHTU_CAS' | 'SHTU_EGATE' | 'WECHAT_MINIPROGRAM';

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
 * 第二级 · 能力层（Campus Session）
 *
 * 契约 §5 硬规则 2：
 *   "任何校园系统能力必须通过 CampusSessionPort 获取，不得从 AuthPort 读取。"
 * ================================================================== */

export type CampusPlatform = 'EGATE' | 'CPDAILY' | 'JWC' | 'CARD';

export const CAMPUS_PLATFORMS: readonly CampusPlatform[] = ['EGATE', 'CPDAILY', 'JWC', 'CARD'];

/** 面向调用方的绑定视图 —— **刻意不包含** session 明文或密文 */
export interface CampusBindingRecord {
  id: string;
  platform: CampusPlatform;
  status: string;
  scopes: string[];
  expiresAt: Date;
  lastUsedAt: Date | null;
}

/**
 * 能力层 session。
 *
 * `sessionRef` 只在 CampusSessionPort 内部流转，
 * **绝不**进入 AuthService 的返回值（契约 §5 硬规则 2）。
 */
export interface CampusSession {
  platform: CampusPlatform;
  sessionRef: string;
  expiresAt: Date;
}

export interface CampusBindCredentials {
  /** 上游回调拿到的 session cookie（明文，仅在此层短暂存在） */
  sessionCookie: string;
  scopes?: string[];
  /** 绑定有效期（秒），默认 7 天 */
  ttlSeconds?: number;
}

export interface CampusSessionPort {
  bind(userId: string, platform: CampusPlatform, credentials: CampusBindCredentials): Promise<CampusBindingRecord>;
  listBindings(userId: string): Promise<CampusBindingRecord[]>;
  /** 取能力层 session；未绑定/已过期返回 null（调用方据此抛 CAMPUS_BINDING_REQUIRED） */
  acquireSession(userId: string, platform: CampusPlatform): Promise<CampusSession | null>;
  unbind(userId: string, platform: CampusPlatform): Promise<void>;
}

export const CAMPUS_SESSION_PORT = Symbol('KEDAYA_CAMPUS_SESSION_PORT');

/* ================================================================== *
 * KedaYa 自有账户
 * ================================================================== */

export interface UserRecord {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  department: string | null;
  createdAt: Date;
}

/** 身份映射的只读视图（列表用；**不含**任何凭据） */
export interface IdentityRecord {
  provider: CampusIdentityProvider;
  externalId: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface ProfilePatch {
  displayName?: string;
  /** 传 `null` 表示清空头像 */
  avatarUrl?: string | null;
  department?: string | null;
}

export interface UserRepository {
  /** 首次登录建档；已存在则刷新身份映射并返回既有账户 */
  upsertFromIdentity(identity: CampusIdentity): Promise<UserRecord>;
  findById(id: string): Promise<UserRecord | null>;
  /** 按上游标识查身份映射（用于"这个微信号已经属于别的账号"的冲突判定） */
  findIdentity(
    provider: CampusIdentityProvider,
    externalId: string,
  ): Promise<{ userId: string; identity: IdentityRecord } | null>;
  /** 把一个新的身份映射挂到既有账号上（账号关联 / 绑定） */
  linkIdentity(userId: string, identity: CampusIdentity): Promise<IdentityRecord>;
  /** 解绑某个身份来源；返回解除的映射数量 */
  unlinkIdentity(userId: string, provider: CampusIdentityProvider): Promise<number>;
  listIdentities(userId: string): Promise<IdentityRecord[]>;
  /** 更新展示资料（昵称 / 头像 / 院系） */
  updateProfile(userId: string, patch: ProfilePatch): Promise<UserRecord>;
}

export const USER_REPOSITORY = Symbol('KEDAYA_USER_REPOSITORY');

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
