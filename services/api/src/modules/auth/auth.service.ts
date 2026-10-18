import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CampusBindingRequiredError,
  InternalError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import { signJwt, verifyJwt } from '../../common/auth/jwt';
import { describeAccount } from './domain/account-summary';
import type { AccountSession } from './domain/account-session';
import {
  AUTH_PORT,
  CAMPUS_SESSION_PORT,
  USER_REPOSITORY,
  assertIdentityOnly,
  type AuthPort,
  type CampusBindCredentials,
  type CampusBindingRecord,
  type CampusPlatform,
  type CampusSessionPort,
  type ProfilePatch,
  type UserRecord,
  type UserRepository,
} from './domain/auth.domain';
import { sanitizeDisplayName, validateAvatarDataUrl } from './domain/display-name';
import { buildDemoCampusSessionRef } from './domain/campus-data.domain';
import {
  LOCAL_ACCOUNT_REPOSITORY,
  REFRESH_SESSION_REPOSITORY,
  type AuthRequestContext,
  type LocalAccountRepository,
  type RefreshSessionRepository,
} from './domain/local-account.domain';
import { sha256Hex } from './domain/verification-code';

/** 各校园系统默认申请的权限域（真实对接时以官方文档为准） */
const DEFAULT_SCOPES: Record<CampusPlatform, string[]> = {
  cas: ['identity:read'],
  egate: ['identity:read'],
  jwc: ['schedule:read'],
  cpdaily: ['notice:read'],
  ecard: ['card:read'],
  techpie: ['directory:read'],
};

/**
 * 登录结果（与邮箱密码 / 微信路径同构，客户端只写一套解析）。
 *
 * `simulated` 在 CAS 登录里是**必填布尔值**（不是可选）：
 * 审计 P0-3 发现 mock CAS 的响应没有这个字段，客户端无法区分「真实学号」
 * 与「`mock-20230001` 采信出来的假身份」。现在：
 *   · `MockCampusAuthProvider`（带 `simulated = true`）→ 响应 `simulated: true`；
 *   · 将来接入的真实 CAS 实现不设该属性 → 响应 `simulated: false`。
 */
export type LoginResult = Omit<AccountSession, 'isNewUser' | 'simulated'> & {
  simulated: boolean;
};

/** 令牌三元组 + 绝对过期时间（客户端可直接落本地） */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 UTC */
  expiresAt: string;
  /** access token 有效期（秒），与 `expiresAt` 冗余，便于客户端做倒计时 */
  expiresIn: number;
}

export interface MeResult {
  user: UserRecord;
  campusBindings: CampusBindingRecord[];
  /** 已登录但未绑定时为 false —— 这是合法状态，不是错误 */
  campusBound: boolean;
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 UTC */
  expiresAt: string;
  expiresIn: number;
}

/**
 * 身份用例（第一级）。
 *
 * 本服务**只**依赖 `AuthPort`（身份）与 `UserRepository`（自有账户）。
 * 第二级的 `CampusSessionPort` 虽然也注入了，但仅用于 `me()` 里把绑定状态
 * 作为**独立字段**返回、以及 campus 能力模块的入口 —— 它绝不参与签发 JWT，
 * 也不会把自己的 session 混进 login 的返回值。
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_PORT) private readonly authPort: AuthPort,
    @Inject(CAMPUS_SESSION_PORT) private readonly campusSession: CampusSessionPort,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(LOCAL_ACCOUNT_REPOSITORY) private readonly localAccounts: LocalAccountRepository,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(REFRESH_SESSION_REPOSITORY) private readonly refreshSessions: RefreshSessionRepository,
  ) {}

  private jwtSecret(): string {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) throw new InternalError('JWT_SECRET 未配置，无法签发访问令牌');
    return secret;
  }

  private accessTtl(): number {
    return Number(this.config.get<string>('JWT_ACCESS_TTL') ?? 900);
  }

  private refreshTtl(): number {
    return Number(this.config.get<string>('JWT_REFRESH_TTL') ?? 2_592_000);
  }

  /**
   * 第一级登录：CAS ticket → 身份 → KedaYa 自有 JWT。
   *
   * 返回值里**没有任何**校园系统 session/cookie —— 这是契约 §5 的核心约束，
   * 由 `assertIdentityOnly()` 在运行时兜底断言。
   */
  async login(ticket: string, context: AuthRequestContext = {}): Promise<LoginResult> {
    const identity = assertIdentityOnly(
      await this.authPort.authenticateTicket(ticket),
      'AuthPort',
    );

    const user = await this.users.upsertFromIdentity(identity);
    const issued = await this.issueTokens(user.id, context);
    const account = await describeAccount(
      { accounts: this.localAccounts, users: this.users },
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
      // 身份来源自报了模拟（当前唯一的 MockCampusAuthProvider 恒为 true）。
      // 真实 CAS 实现不设该属性 → false。客户端必须据此标注「演示身份」。
      simulated: this.authPort.simulated === true,
    };
  }

  /**
   * 更新自己的展示资料（昵称 / 头像 / 院系）。
   *
   * 为什么放在身份层：昵称与头像是**第一级身份**的展示属性，
   * 与"我的"模块的隐私开关（ProfileSetting）不是一回事。
   * 邮箱、学号这类由上游/凭据决定的字段**不允许**在这里改。
   */
  async updateProfile(userId: string, patch: ProfilePatch): Promise<UserRecord> {
    const normalized: ProfilePatch = {};

    if (patch.displayName !== undefined) {
      const displayName = sanitizeDisplayName(patch.displayName);
      if (displayName === null) {
        throw new ValidationError('昵称不能为空', { field: 'displayName' });
      }
      normalized.displayName = displayName;
    }

    if (patch.avatarUrl !== undefined && patch.avatarUrl !== null) {
      const avatar = validateAvatarDataUrl(patch.avatarUrl);
      if (!avatar.ok || avatar.dataUrl === undefined) {
        throw new ValidationError(avatar.reason ?? '头像不合法', { field: 'avatarUrl' });
      }
      normalized.avatarUrl = avatar.dataUrl;
    } else if (patch.avatarUrl === null) {
      normalized.avatarUrl = null;
    }

    if (patch.department !== undefined) {
      const department = sanitizeDisplayName(patch.department);
      normalized.department = department;
    }

    if (Object.keys(normalized).length === 0) {
      throw new ValidationError('没有需要更新的字段');
    }

    return this.users.updateProfile(userId, normalized);
  }

  /**
   * 签发一对令牌，并把 refresh token 的**指纹**写进会话表。
   *
   * 这是「登出立刻生效」与「刷新令牌轮换」的前提：
   * access token 仍然无状态；refresh token 必须能在库里被撤销。
   */
  async issueTokens(userId: string, context: AuthRequestContext = {}): Promise<IssuedTokens> {
    const expiresIn = this.accessTtl();
    const refreshTtl = this.refreshTtl();
    const refreshToken = signJwt(userId, 'refresh', this.jwtSecret(), refreshTtl);

    await this.refreshSessions.create({
      userId,
      tokenHash: sha256Hex(refreshToken),
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
      ...(context.userAgent === undefined ? {} : { userAgent: context.userAgent }),
      ...(context.ip === undefined ? {} : { ip: context.ip }),
    });

    return {
      accessToken: signJwt(userId, 'access', this.jwtSecret(), expiresIn),
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      expiresIn,
    };
  }

  /**
   * 用 refreshToken 换取新的令牌对（**轮换**）。
   *
   * 三重校验，缺一不可：
   *   1. JWT 签名 + `typ === 'refresh'`；
   *   2. 会话表里存在该指纹且未被撤销；
   *   3. 会话未过期。
   * 通过后旧会话立即撤销并记录 `replacedById`，被盗令牌最多只能再用一次。
   */
  async refresh(refreshToken: string, context: AuthRequestContext = {}): Promise<RefreshResult> {
    const payload = verifyJwt(refreshToken, this.jwtSecret());
    if (payload.typ !== 'refresh') {
      throw new UnauthenticatedError('请使用 refreshToken 换取新的访问令牌');
    }

    const tokenHash = sha256Hex(refreshToken);
    const session = await this.refreshSessions.findByHash(tokenHash);
    if (!session) {
      throw new UnauthenticatedError('登录状态已失效，请重新登录');
    }
    if (session.revokedAt !== null) {
      // 已轮换过的令牌被再次使用：按"令牌可能已泄漏"处理，撤销该用户全部会话
      await this.refreshSessions.revokeAllForUser(session.userId);
      throw new UnauthenticatedError('登录状态已失效，请重新登录');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthenticatedError('登录状态已过期，请重新登录');
    }

    const issued = await this.issueTokens(session.userId, context);
    await this.refreshSessions.revoke(session.id);
    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresAt: issued.expiresAt,
      expiresIn: issued.expiresIn,
    };
  }

  /**
   * 登出。
   *
   * 给了 refreshToken 就只撤销这一台设备；没给（或已被撤销）则撤销该用户全部会话 ——
   * 这是"在别处登出 / 怀疑账号被盗"时的正确语义。
   */
  async logout(userId: string, refreshToken?: string): Promise<{ revoked: number }> {
    if (refreshToken !== undefined && refreshToken.length > 0) {
      const session = await this.refreshSessions.findByHash(sha256Hex(refreshToken));
      if (session && session.userId === userId && session.revokedAt === null) {
        await this.refreshSessions.revoke(session.id);
        return { revoked: 1 };
      }
    }
    const revoked = await this.refreshSessions.revokeAllForUser(userId);
    return { revoked };
  }

  /** 改密码 / 重置密码后强制所有设备重新登录 */
  async revokeAllSessions(userId: string): Promise<number> {
    return this.refreshSessions.revokeAllForUser(userId);
  }

  async me(userId: string): Promise<MeResult> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthenticatedError('账户不存在，请重新登录');

    const campusBindings = await this.campusSession.listBindings(userId);

    return {
      user,
      campusBindings,
      campusBound: campusBindings.some((binding) => binding.status === 'active'),
    };
  }

  /* ---------------- 第二级：校园系统绑定 ---------------- */

  /**
   * 绑定校园系统。
   *
   * `sessionCookie` 缺省时（`CAMPUS_DATA_MODE=mock` 且非生产）服务端签发演示凭据 ——
   * 这样「身份 / 课表 / 校园卡」三个模块在没有官方授权的前提下也能验证全链路，
   * 且**走的是同一套加密落库与权限判定代码**（不是绕过）。
   */
  bindCampus(
    userId: string,
    platform: CampusPlatform,
    credentials: Partial<CampusBindCredentials>,
  ): Promise<CampusBindingRecord> {
    const sessionCookie = credentials.sessionCookie ?? this.demoSessionRef(platform, userId);

    return this.campusSession.bind(userId, platform, {
      sessionCookie,
      ...(credentials.scopes === undefined
        ? { scopes: DEFAULT_SCOPES[platform] }
        : { scopes: credentials.scopes }),
      ...(credentials.ttlSeconds === undefined ? {} : { ttlSeconds: credentials.ttlSeconds }),
    });
  }

  private demoSessionRef(platform: CampusPlatform, userId: string): string {
    const mode = this.config.get<string>('CAMPUS_DATA_MODE') ?? 'mock';
    const production = (this.config.get<string>('NODE_ENV') ?? 'development') === 'production';

    if (mode === 'mock' && !production) {
      return buildDemoCampusSessionRef(platform, userId);
    }
    throw new ValidationError(
      `绑定 ${platform} 需要提供校园系统 sessionCookie（当前数据模式：${mode}）`,
      { platform, dataMode: mode },
    );
  }

  listCampusBindings(userId: string): Promise<CampusBindingRecord[]> {
    return this.campusSession.listBindings(userId);
  }

  unbindCampus(userId: string, platform: CampusPlatform): Promise<void> {
    return this.campusSession.unbind(userId, platform);
  }

  /**
   * 校园系统能力可用性（供 UI 判断是否要显示"去绑定"）。
   * 只返回布尔值，**绝不**把 session 本身返回给调用方。
   */
  async campusCapability(userId: string, platform: CampusPlatform): Promise<{ available: boolean }> {
    const session = await this.campusSession.acquireSession(userId, platform);
    return { available: session !== null };
  }

  /**
   * 需要第二级能力的用例入口（例如 campus-card 读余额）。
   * 未绑定/已过期 → `CAMPUS_BINDING_REQUIRED`（契约 §5 硬规则 3）。
   *
   * 注意：返回的 `CampusSession` 含 `sessionRef`，**仅供服务端内部使用**，
   * 任何控制器都不得把它直接序列化进响应。
   */
  async requireCampusSession(userId: string, platform: CampusPlatform) {
    const session = await this.campusSession.acquireSession(userId, platform);
    if (!session) {
      throw new CampusBindingRequiredError(
        `请先绑定校园系统（${platform}）后再使用该功能`,
        { platform },
      );
    }
    return session;
  }
}
