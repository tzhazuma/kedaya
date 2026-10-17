import { Inject, Injectable } from '@nestjs/common';
import {
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app-error';
import { describeAccount } from './domain/account-summary';
import type { AccountSession } from './domain/account-session';
import {
  assertIdentityOnly,
  USER_REPOSITORY,
  type CampusIdentity,
  type UserRecord,
  type UserRepository,
} from './domain/auth.domain';
import { deriveNameFromWechat, sanitizeDisplayName, validateAvatarDataUrl } from './domain/display-name';
import {
  LOCAL_ACCOUNT_REPOSITORY,
  type AuthRequestContext,
  type LocalAccountRepository,
} from './domain/local-account.domain';
import {
  assertWechatCodeShape,
  WECHAT_IDENTITY_PROVIDER,
  WECHAT_SESSION_PORT,
  type WeChatSessionPort,
} from './domain/wechat.domain';
import { AuthService } from './auth.service';

export interface WechatLoginInput {
  code: string;
  /** 用户在「完善资料」里填的微信昵称（可选，首次登录时带上更好） */
  displayName?: string;
  /** 头像（data URL，≤64KB）。没有对象存储时的临时方案，见 `validateAvatarDataUrl` */
  avatarDataUrl?: string;
}

export interface WechatStatus {
  /** 是否已绑定 */
  bound: boolean;
  provider: typeof WECHAT_IDENTITY_PROVIDER;
  /** 绑定的时间与最近一次登录时间（不含 openid —— 那是上游标识，不下发给客户端） */
  boundAt: string | null;
  lastLoginAt: string | null;
  /** 是否是**开发模拟身份**（openid 形如 dev_openid_*） */
  simulated: boolean;
  /** 能否解绑（账号还有别的登录方式吗） */
  canUnbind: boolean;
}

/**
 * 微信小程序身份用例（第一级身份层的第三条入口）。
 *
 * 职责边界（与契约 §5 一致）：
 *   · 只回答"你是谁"：openid → AuthIdentity → KedaYa 自有 JWT；
 *   · 不碰任何校园系统 session（那属于 `CampusSessionPort`）；
 *   · 微信 `session_key` 在适配器里就被丢弃，绝不进入身份层。
 *
 * 与 `LocalAuthService` 的关系：两者共用 `AuthService.issueTokens()`，
 * 因此令牌同构；账号关联（绑定/解绑微信、补邮箱密码）也通过同一张表完成。
 */
@Injectable()
export class WechatAuthService {
  constructor(
    @Inject(WECHAT_SESSION_PORT) private readonly wechat: WeChatSessionPort,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(LOCAL_ACCOUNT_REPOSITORY) private readonly accounts: LocalAccountRepository,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  /**
   * 微信一键登录 / 注册。
   *
   * 语义（刻意与"注册"分开，减少一次接口往返）：
   *   · 该 openid 从未见过 → 建号并登录，`isNewUser: true`；
   *   · 该 openid 已有账号 → 直接登录，`isNewUser: false`。
   * 首次登录时会用"微信用户xxxx"兜底昵称，客户端立刻引导用户改成真实昵称。
   */
  async login(input: WechatLoginInput, context: AuthRequestContext = {}): Promise<AccountSession> {
    const session = await this.wechat.exchangeCode(assertWechatCodeShape(input.code));
    const nickname = sanitizeDisplayName(input.displayName);
    const avatar = input.avatarDataUrl === undefined ? undefined : validateAvatarDataUrl(input.avatarDataUrl);
    if (avatar !== undefined && !avatar.ok) {
      throw new ValidationError(avatar.reason ?? '头像不合法', { field: 'avatarDataUrl' });
    }

    const existing = await this.users.findIdentity(WECHAT_IDENTITY_PROVIDER, session.openid);
    if (existing) {
      const user = await this.users.findById(existing.userId);
      if (!user) {
        throw new InternalError('微信身份存在但账号缺失，请重新登录或联系管理员');
      }
      // 老用户：只更新"这次真的给了"的字段，绝不把用户改过的昵称重置回微信名
      const patch = {
        ...(nickname === null ? {} : { displayName: nickname }),
        ...(avatar?.ok === true && avatar.dataUrl !== undefined ? { avatarUrl: avatar.dataUrl } : {}),
      };
      const updated = Object.keys(patch).length === 0 ? user : await this.users.updateProfile(user.id, patch);
      return this.issueSession(updated, { isNewUser: false, simulated: session.simulated }, context);
    }

    const identity = this.buildIdentity(session.openid, nickname);
    let user = await this.users.upsertFromIdentity(identity);
    if (avatar?.ok === true && avatar.dataUrl !== undefined) {
      user = await this.users.updateProfile(user.id, { avatarUrl: avatar.dataUrl });
    }

    return this.issueSession(user, { isNewUser: true, simulated: session.simulated }, context);
  }

  /** 当前账号的微信绑定状态（不含 openid） */
  async status(userId: string): Promise<WechatStatus> {
    const [identities, account] = await Promise.all([
      this.users.listIdentities(userId),
      describeAccount({ accounts: this.accounts, users: this.users }, userId),
    ]);
    const wechat = identities.find((identity) => identity.provider === WECHAT_IDENTITY_PROVIDER);

    return {
      bound: wechat !== undefined,
      provider: WECHAT_IDENTITY_PROVIDER,
      boundAt: wechat?.createdAt.toISOString() ?? null,
      lastLoginAt: wechat?.lastLoginAt?.toISOString() ?? null,
      simulated: wechat?.externalId.startsWith('dev_openid_') ?? false,
      canUnbind: wechat !== undefined && account.hasOtherLoginMethod,
    };
  }

  /**
   * 把微信绑定到**当前登录账号**（邮箱注册的老用户也能一键绑定）。
   *
   * 冲突语义：该 openid 已经属于另一个可达鸭账号时返回 409，
   * 而不是"帮用户合并账号" —— 合并涉及数据归属，必须用户显式操作。
   */
  async bind(userId: string, code: string): Promise<WechatStatus> {
    const session = await this.wechat.exchangeCode(assertWechatCodeShape(code));
    const existing = await this.users.findIdentity(WECHAT_IDENTITY_PROVIDER, session.openid);

    if (existing && existing.userId !== userId) {
      throw new ConflictError('该微信已绑定到另一个可达鸭账号，请先用那个账号登录并解绑', {
        provider: WECHAT_IDENTITY_PROVIDER,
      });
    }
    if (!existing) {
      await this.users.linkIdentity(userId, this.buildIdentity(session.openid, null));
    }
    return this.status(userId);
  }

  /**
   * 解绑微信。
   *
   * 硬约束：解绑后账号必须**还有别的登录方式**，否则用户会把自己锁在门外。
   * 这也是"微信一键注册"必须提供「绑定邮箱密码」入口的原因。
   */
  async unbind(userId: string): Promise<WechatStatus> {
    const account = await describeAccount({ accounts: this.accounts, users: this.users }, userId);
    if (!account.wechatBound) {
      throw new NotFoundError('当前账号未绑定微信');
    }
    if (!account.hasOtherLoginMethod) {
      throw new ForbiddenError('解绑微信后你将无法登录：请先设置邮箱密码，再解绑微信');
    }

    await this.users.unlinkIdentity(userId, WECHAT_IDENTITY_PROVIDER);
    return this.status(userId);
  }

  /* ---------------- 内部 ---------------- */

  /**
   * 构造身份映射。
   *
   * 这里显式过一遍 `assertIdentityOnly`：微信适配器如果哪天"顺手"把
   * `session_key` 塞进身份对象，登录会立刻失败 —— 与 CAS 路径同一道护栏。
   */
  private buildIdentity(openid: string, nickname: string | null): CampusIdentity {
    return assertIdentityOnly(
      {
        provider: WECHAT_IDENTITY_PROVIDER,
        externalId: openid,
        realName: nickname ?? deriveNameFromWechat(openid),
      },
      'WeChatAuthService',
    );
  }

  private async issueSession(
    user: UserRecord,
    extra: { isNewUser: boolean; simulated: boolean },
    context: AuthRequestContext,
  ): Promise<AccountSession> {
    const issued = await this.authService.issueTokens(user.id, context);
    const account = await describeAccount({ accounts: this.accounts, users: this.users }, user.id);

    return {
      user,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.expiresIn,
      expiresAt: issued.expiresAt,
      campusBound: false,
      account,
      isNewUser: extra.isNewUser,
      simulated: extra.simulated,
    };
  }
}
