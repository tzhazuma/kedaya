import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { describeAccount } from './domain/account-summary';
import type { AccountSession } from './domain/account-session';
import { USER_REPOSITORY, type UserRecord, type UserRepository } from './domain/auth.domain';
import { deriveNameFromEmail, sanitizeDisplayName } from './domain/display-name';
import {
  CLOCK,
  LOCAL_ACCOUNT_REPOSITORY,
  MAIL_PORT,
  REFRESH_SESSION_REPOSITORY,
  VERIFICATION_CODE_REPOSITORY,
  type AuthRequestContext,
  type ClockPort,
  type LocalAccountRecord,
  type LocalAccountRepository,
  type MailPort,
  type RefreshSessionRepository,
  type VerificationCodeRepository,
} from './domain/local-account.domain';
import {
  CODE_MAX_ATTEMPTS,
  CODE_MAX_SENDS_PER_HOUR,
  CODE_RESEND_COOLDOWN_MS,
  CODE_TTL_MS,
  generateCode,
  hashCode,
  isEmailLike,
  normalizeEmail,
  verifyCode,
  type VerificationPurpose,
} from './domain/verification-code';
import { assertPasswordStrength, hashPassword, verifyPassword } from './domain/password';
import { AuthService } from './auth.service';

/** 连续失败次数上限与锁定时长 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

/**
 * 邮箱账号的登录/注册结果。
 *
 * 与微信登录、CAS 登录**同构**（见 `domain/account-session.ts`）：
 * 客户端因此只需要一套解析与一套「我的」渲染逻辑。
 */
export interface LoginOutcome extends AccountSession {
  isNewUser: boolean;
}

export interface CodeReceipt {
  sent: true;
  email: string;
  purpose: VerificationPurpose;
  /** 验证码有效期（秒） */
  expiresInSeconds: number;
  /**
   * **仅开发环境**（`AUTH_DEV_EXPOSE_CODES=true`）返回，便于真机联调。
   * 生产必须为 false —— 该开关由环境变量控制，代码里没有默认放行。
   */
  devCode?: string;
}

export interface RegisterInput {
  email: string;
  code: string;
  password: string;
  displayName?: string;
}

export interface BindEmailInput {
  email: string;
  code: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ResetPasswordInput {
  email: string;
  code: string;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * 自建账号用例（邮箱 + 密码）。
 *
 * 与 `AuthService` 的分工：
 *   · 本服务只处理「凭据」——注册、登录、验证码、改密、重置；
 *   · 令牌签发/轮换/撤销统一走 `AuthService.issueTokens`，
 *     保证两条登录路径（CAS 与邮箱）签发出来的令牌完全同构。
 */
@Injectable()
export class LocalAuthService {
  constructor(
    @Inject(LOCAL_ACCOUNT_REPOSITORY) private readonly accounts: LocalAccountRepository,
    @Inject(VERIFICATION_CODE_REPOSITORY) private readonly codes: VerificationCodeRepository,
    @Inject(REFRESH_SESSION_REPOSITORY) private readonly sessions: RefreshSessionRepository,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  /** 现在（可注入，便于把 TTL / 锁定 / 冷却推进过去） */
  private now(): Date {
    return this.clock();
  }

  /* ---------------- 验证码 ---------------- */

  async sendRegisterCode(email: string, context: AuthRequestContext = {}): Promise<CodeReceipt> {
    const target = this.normalizeTarget(email);
    const existing = await this.accounts.findByEmail(target);
    if (existing) {
      throw new ConflictError('该邮箱已注册，请直接登录或使用找回密码', { email: target });
    }
    return this.sendCode(target, 'register', context);
  }

  /**
   * 找回密码。
   *
   * 刻意**不**区分"邮箱不存在"：不存在的邮箱同样返回 sent=true，
   * 只是不发信。这样攻击者无法用该接口枚举学校师生邮箱。
   */
  async sendResetCode(email: string, context: AuthRequestContext = {}): Promise<CodeReceipt> {
    const target = this.normalizeTarget(email);
    const account = await this.accounts.findByEmail(target);

    if (!account) {
      return {
        sent: true,
        email: target,
        purpose: 'reset-password',
        expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
      };
    }
    return this.sendCode(target, 'reset-password', context);
  }

  private async sendCode(
    target: string,
    purpose: VerificationPurpose,
    context: AuthRequestContext,
  ): Promise<CodeReceipt> {
    const now = this.now();

    // 频控 1：同一验证码未过期前不得重复发送（冷却窗口）
    const latest = await this.codes.findLatestActive(target, purpose);
    if (latest && now.getTime() - latest.createdAt.getTime() < CODE_RESEND_COOLDOWN_MS) {
      const waitSeconds = Math.ceil(
        (CODE_RESEND_COOLDOWN_MS - (now.getTime() - latest.createdAt.getTime())) / 1000,
      );
      throw new ConflictError(`验证码刚发过，请 ${waitSeconds} 秒后再试`, { retryAfterSeconds: waitSeconds });
    }

    // 频控 2：每小时上限（防撞库 / 防刷短信邮件额度）
    const sentLastHour = await this.codes.countSince(
      target,
      purpose,
      new Date(now.getTime() - 60 * 60 * 1000),
    );
    if (sentLastHour >= CODE_MAX_SENDS_PER_HOUR) {
      throw new ConflictError('验证码发送过于频繁，请稍后再试', {
        limitPerHour: CODE_MAX_SENDS_PER_HOUR,
      });
    }

    const code = generateCode();
    await this.codes.create({
      target,
      purpose,
      codeHash: hashCode(target, purpose, code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      ...(context.ip === undefined ? {} : { ip: context.ip }),
    });

    await this.mail.send({
      to: target,
      subject: `【可达鸭】${purposeSubject(purpose)}验证码`,
      text: `你的验证码是 ${code}，10 分钟内有效。若非本人操作请忽略本邮件。`,
    });

    const receipt: CodeReceipt = {
      sent: true,
      email: target,
      purpose,
      expiresInSeconds: Math.floor(CODE_TTL_MS / 1000),
    };

    // 开发环境下把验证码回给调用方（真机联调用）；生产必须关闭
    if (this.devCodesExposed()) receipt.devCode = code;
    return receipt;
  }

  /** 校验并消费验证码；失败会累加尝试次数，超限即作废 */
  private async consumeCode(
    target: string,
    purpose: VerificationPurpose,
    code: string,
  ): Promise<void> {
    const record = await this.codes.findLatestActive(target, purpose);
    if (!record) {
      throw new ValidationError('请先获取验证码', { purpose });
    }
    if (record.expiresAt.getTime() <= this.now().getTime()) {
      throw new ValidationError('验证码已过期，请重新获取', { purpose });
    }
    if (record.attempts >= CODE_MAX_ATTEMPTS) {
      throw new ValidationError('验证码尝试次数过多，请重新获取', { purpose });
    }

    if (!verifyCode(target, purpose, code, record.codeHash)) {
      await this.codes.incrementAttempts(record.id);
      throw new ValidationError('验证码不正确', { purpose });
    }

    await this.codes.consume(record.id, this.now());
  }

  /* ---------------- 注册 / 登录 ---------------- */

  async register(input: RegisterInput, context: AuthRequestContext = {}): Promise<LoginOutcome> {
    const email = this.normalizeTarget(input.email);
    assertPasswordStrength(input.password);

    if (await this.accounts.findByEmail(email)) {
      throw new ConflictError('该邮箱已注册，请直接登录', { email });
    }

    await this.consumeCode(email, 'register', input.code);

    const account = await this.accounts.createAccount({
      email,
      passwordHash: hashPassword(input.password),
      displayName: sanitizeDisplayName(input.displayName) ?? deriveNameFromEmail(email),
    });

    const user = await this.requireUser(account.userId);
    return this.issueSession(user, true, context);
  }

  async login(input: LoginInput, context: AuthRequestContext = {}): Promise<LoginOutcome> {
    const email = this.normalizeTarget(input.email);
    const account = await this.accounts.findByEmail(email);

    // 账号不存在与密码错误返回**完全一致**的文案，避免账号枚举
    if (!account) {
      throw new UnauthenticatedError('邮箱或密码不正确');
    }
    this.assertAccountUsable(account);

    if (!verifyPassword(input.password, account.passwordHash)) {
      await this.recordFailure(account);
      throw new UnauthenticatedError('邮箱或密码不正确');
    }

    await this.accounts.markLogin(account.id, this.now());
    const user = await this.requireUser(account.userId);
    return this.issueSession(user, false, context);
  }

  /**
   * 给当前账号补一套邮箱密码（绑定邮箱）。
   *
   * 场景：用户用微信一键注册，账号只有微信一种登录方式 ——
   * 一旦换手机或微信异常就再也进不来。本方法让它在**同一个 userId** 上
   * 增加凭据（不新建账号），同时也是"解绑微信"的前置条件。
   */
  async bindEmail(
    userId: string,
    input: BindEmailInput,
    context: AuthRequestContext = {},
  ): Promise<LoginOutcome> {
    const email = this.normalizeTarget(input.email);
    assertPasswordStrength(input.password);

    if (await this.accounts.findByUserId(userId)) {
      throw new ConflictError('当前账号已设置邮箱密码，请使用「修改密码」', { field: 'email' });
    }
    const owner = await this.accounts.findByEmail(email);
    if (owner) {
      throw new ConflictError('该邮箱已被其他账号使用，请换一个邮箱', { email });
    }

    await this.consumeCode(email, 'bind-email', input.code);
    await this.accounts.attachCredential({
      userId,
      email,
      passwordHash: hashPassword(input.password),
    });

    const user = await this.requireUser(userId);
    return this.issueSession(user, false, context);
  }

  /** 绑定邮箱前先发验证码（邮箱已被占用时直接拒绝，避免用户白等一封信） */
  async sendBindEmailCode(
    userId: string,
    email: string,
    context: AuthRequestContext = {},
  ): Promise<CodeReceipt> {
    const target = this.normalizeTarget(email);

    if (await this.accounts.findByUserId(userId)) {
      throw new ConflictError('当前账号已设置邮箱密码', { field: 'email' });
    }
    const owner = await this.accounts.findByEmail(target);
    if (owner) {
      throw new ConflictError('该邮箱已被其他账号使用，请换一个邮箱', { email: target });
    }
    return this.sendCode(target, 'bind-email', context);
  }

  /* ---------------- 密码维护 ---------------- */

  async resetPassword(input: ResetPasswordInput): Promise<{ reset: true; message: string }> {
    const email = this.normalizeTarget(input.email);
    assertPasswordStrength(input.password);

    const account = await this.accounts.findByEmail(email);
    if (!account) {
      // 与"验证码错误"同构的响应，避免通过该接口判断邮箱是否存在
      await this.consumeCode(email, 'reset-password', input.code);
      throw new NotFoundError('重置失败，请重新获取验证码');
    }

    await this.consumeCode(email, 'reset-password', input.code);
    await this.accounts.updatePassword(account.id, hashPassword(input.password));
    // 改密后所有设备下线（含攻击者可能已持有的 refresh token）
    await this.sessions.revokeAllForUser(account.userId);
    await this.codes.consumeAll(email, 'reset-password', this.now());

    return { reset: true, message: '密码已重置，请用新密码登录' };
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    context: AuthRequestContext = {},
  ): Promise<LoginOutcome> {
    assertPasswordStrength(input.newPassword);

    const account = await this.accounts.findByUserId(userId);
    if (!account) {
      throw new NotFoundError('当前账号没有设置密码，无法修改密码');
    }
    this.assertAccountUsable(account);

    if (!verifyPassword(input.currentPassword, account.passwordHash)) {
      await this.recordFailure(account);
      throw new UnauthenticatedError('当前密码不正确');
    }
    if (input.currentPassword === input.newPassword) {
      throw new ValidationError('新密码不能与当前密码相同');
    }

    await this.accounts.updatePassword(account.id, hashPassword(input.newPassword));
    await this.sessions.revokeAllForUser(userId);

    // 改密把当前设备也踢下线了，这里直接签发一套新令牌，避免用户被迫重新登录
    const user = await this.requireUser(userId);
    return this.issueSession(user, false, context);
  }

  /** 当前账号是否设置了密码（供 UI 决定是否展示「修改密码」） */
  async hasPassword(userId: string): Promise<boolean> {
    return (await this.accounts.findByUserId(userId)) !== null;
  }

  /** 登出：撤销本次登录；未给 refreshToken 则撤销全部会话 */
  logout(userId: string, refreshToken?: string): Promise<{ revoked: number }> {
    return this.authService.logout(userId, refreshToken);
  }

  /* ---------------- 内部工具 ---------------- */

  private normalizeTarget(email: string): string {
    if (typeof email !== 'string' || !isEmailLike(email)) {
      throw new ValidationError('请填写正确的邮箱地址', { field: 'email' });
    }
    return normalizeEmail(email);
  }

  private assertAccountUsable(account: LocalAccountRecord): void {
    if (account.status === 'disabled') {
      throw new ForbiddenError('该账号已被停用，请联系管理员');
    }
    if (account.lockedUntil !== null && account.lockedUntil.getTime() > this.now().getTime()) {
      const minutes = Math.ceil((account.lockedUntil.getTime() - this.now().getTime()) / 60000);
      throw new ForbiddenError(`密码错误次数过多，请 ${minutes} 分钟后再试`, { locked: true });
    }
  }

  private async recordFailure(account: LocalAccountRecord): Promise<void> {
    const attempts = account.failedAttempts + 1;
    const lockedUntil =
      attempts >= MAX_FAILED_ATTEMPTS ? new Date(this.now().getTime() + LOCK_DURATION_MS) : null;
    await this.accounts.recordFailedAttempt(account.id, attempts, lockedUntil);
  }

  private async requireUser(userId: string): Promise<UserRecord> {
    const user = await this.users.findById(userId);
    if (!user) throw new InternalError('账号数据不一致：凭据存在但用户不存在');
    return user;
  }

  /**
   * 签发令牌 + 组装统一的账号信息（三条登录路径共用同一形状）。
   *
   * `isNewUser` 对邮箱注册恒为 true、登录/改密恒为 false；
   * 微信路径由 `WechatAuthService` 自行判定。
   */
  private async issueSession(
    user: UserRecord,
    isNewUser: boolean,
    context: AuthRequestContext,
  ): Promise<LoginOutcome> {
    const issued = await this.authService.issueTokens(user.id, context);
    const account = await describeAccount(
      { accounts: this.accounts, users: this.users },
      user.id,
    );

    return {
      user,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
      expiresAt: issued.expiresAt,
      campusBound: false,
      account,
      isNewUser,
    };
  }

  private devCodesExposed(): boolean {
    // 仅在非生产环境允许回显验证码；NODE_ENV=production 时无条件关闭
    if (this.config.get<string>('NODE_ENV') === 'production') return false;
    return this.config.get<string>('AUTH_DEV_EXPOSE_CODES') === 'true';
  }
}

function purposeSubject(purpose: VerificationPurpose): string {
  switch (purpose) {
    case 'register':
      return '注册';
    case 'reset-password':
      return '找回密码';
    case 'change-password':
      return '修改密码';
    case 'bind-email':
      return '绑定邮箱';
  }
}
