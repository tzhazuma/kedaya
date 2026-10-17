import type { VerificationPurpose } from './verification-code';

/* ================================================================== *
 * 自建账号（邮箱 + 密码）领域端口
 *
 * 契约 §5 的两级模型**不受影响**：
 *   · 第一级仍是「你是谁」——CAS 走 AuthPort，自建账号走本文件的端口；
 *   · 校园系统 session 仍然只能走 CampusSessionPort。
 * 两条登录路径最终都收敛到同一个 KedaYa `User`。
 * ================================================================== */

export const LOCAL_ACCOUNT_STATUS = {
  active: 'active',
  locked: 'locked',
  disabled: 'disabled',
} as const;

export type LocalAccountStatus =
  (typeof LOCAL_ACCOUNT_STATUS)[keyof typeof LOCAL_ACCOUNT_STATUS];

export interface LocalAccountRecord {
  id: string;
  userId: string;
  /** 规范化（小写）邮箱 */
  email: string;
  passwordHash: string;
  status: LocalAccountStatus;
  failedAttempts: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date;
  lastLoginAt: Date | null;
}

export interface CreateLocalAccountInput {
  email: string;
  passwordHash: string;
  /** 展示名，未提供时由邮箱前缀派生 */
  displayName: string;
}

/**
 * 给**既有账号**补一套邮箱密码。
 *
 * 场景：用户先用微信一键登录（只有微信身份），后来想加邮箱密码作为
 * 第二登录方式/找回手段。此时不能新建 User，只能给同一个 userId 挂凭据 ——
 * 否则会出现"同一个人两个账号"。
 */
export interface AttachCredentialInput {
  userId: string;
  email: string;
  passwordHash: string;
}

export interface LocalAccountRepository {
  findByEmail(email: string): Promise<LocalAccountRecord | null>;
  findByUserId(userId: string): Promise<LocalAccountRecord | null>;
  /** 在同一事务里创建 `User` + `UserCredential`（半成品账号不允许存在） */
  createAccount(input: CreateLocalAccountInput): Promise<LocalAccountRecord>;
  /** 给既有账号挂凭据（UserCredential.userId 唯一，重复挂载会抛冲突） */
  attachCredential(input: AttachCredentialInput): Promise<LocalAccountRecord>;
  updatePassword(accountId: string, passwordHash: string): Promise<void>;
  /** 记录一次失败：递增计数并按策略决定是否锁定 */
  recordFailedAttempt(
    accountId: string,
    failedAttempts: number,
    lockedUntil: Date | null,
  ): Promise<void>;
  markLogin(accountId: string, at: Date): Promise<void>;
}

export const LOCAL_ACCOUNT_REPOSITORY = Symbol('KEDAYA_LOCAL_ACCOUNT_REPOSITORY');

/* ---------------- 验证码 ---------------- */

export interface VerificationCodeRecord {
  id: string;
  target: string;
  purpose: VerificationPurpose;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

export interface CreateVerificationCodeInput {
  target: string;
  purpose: VerificationPurpose;
  codeHash: string;
  expiresAt: Date;
  ip?: string;
}

export interface VerificationCodeRepository {
  /** 取最近一条未被消费的验证码（发送冷却、校验都用它） */
  findLatestActive(target: string, purpose: VerificationPurpose): Promise<VerificationCodeRecord | null>;
  /** 统计时间窗内的发送次数（频控） */
  countSince(target: string, purpose: VerificationPurpose, since: Date): Promise<number>;
  create(input: CreateVerificationCodeInput): Promise<VerificationCodeRecord>;
  incrementAttempts(id: string): Promise<void>;
  consume(id: string, at: Date): Promise<void>;
  /** 消费掉该目标 + 用途下所有未消费验证码（改密成功后防重放） */
  consumeAll(target: string, purpose: VerificationPurpose, at: Date): Promise<void>;
}

export const VERIFICATION_CODE_REPOSITORY = Symbol('KEDAYA_VERIFICATION_CODE_REPOSITORY');

/* ---------------- 刷新令牌会话 ---------------- */

export interface RefreshSessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface CreateRefreshSessionInput {
  userId: string;
  /** `sha256(token)` 的十六进制；**不存明文令牌** */
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string;
  ip?: string;
}

export interface RefreshSessionRepository {
  create(input: CreateRefreshSessionInput): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshSessionRecord | null>;
  revoke(id: string, replacedById?: string): Promise<void>;
  /** 登出全部设备 / 改密后强制下线 */
  revokeAllForUser(userId: string): Promise<number>;
}

export const REFRESH_SESSION_REPOSITORY = Symbol('KEDAYA_REFRESH_SESSION_REPOSITORY');

/* ---------------- 邮件（验证码投递） ---------------- */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * 邮件端口。
 *
 * 本地开发没有 SMTP，因此默认实现是 `ConsoleMailAdapter`（写日志）；
 * 接生产只需换本端口的实现，业务代码不动。
 */
export interface MailPort {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_PORT = Symbol('KEDAYA_MAIL_PORT');

/* ---------------- 时钟 ---------------- */

/**
 * 时钟端口。
 *
 * 为什么认证逻辑必须注入时钟而不是直接用 `Date.now()`：
 *   「验证码 10 分钟过期」「连续失败锁定 15 分钟」「60 秒发送冷却」
 *   这三条规则都要求测试能把时间**推进**过去。硬编码 `Date.now()`
 *   会让这些规则无法被真实验证，只能靠 sleep 或改断言。
 */
export type ClockPort = () => Date;

export const CLOCK = Symbol('KEDAYA_CLOCK');

/* ---------------- 请求上下文 ---------------- */

export interface AuthRequestContext {
  ip?: string;
  userAgent?: string;
}
