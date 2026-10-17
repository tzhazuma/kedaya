import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CampusBindingRequiredError,
  InternalError,
  UnauthenticatedError,
} from '../../common/errors/app-error';
import { signJwt, verifyJwt } from '../../common/auth/jwt';
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
  type UserRecord,
  type UserRepository,
} from './domain/auth.domain';

export interface LoginResult {
  user: UserRecord;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  /**
   * 恒定 false：**登录 ≠ 已绑定校园系统**（契约 §5 硬规则 3）。
   * 客户端据此决定是否展示"绑定校园系统"引导，而不是靠猜。
   */
  campusBound: false;
}

export interface MeResult {
  user: UserRecord;
  campusBindings: CampusBindingRecord[];
  /** 已登录但未绑定时为 false —— 这是合法状态，不是错误 */
  campusBound: boolean;
}

export interface RefreshResult {
  accessToken: string;
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
    @Inject(ConfigService) private readonly config: ConfigService,
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
  async login(ticket: string): Promise<LoginResult> {
    const identity = assertIdentityOnly(
      await this.authPort.authenticateTicket(ticket),
      'AuthPort',
    );

    const user = await this.users.upsertFromIdentity(identity);
    const expiresIn = this.accessTtl();

    return {
      user,
      accessToken: signJwt(user.id, 'access', this.jwtSecret(), expiresIn),
      refreshToken: signJwt(user.id, 'refresh', this.jwtSecret(), this.refreshTtl()),
      expiresIn,
      campusBound: false,
    };
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    const payload = verifyJwt(refreshToken, this.jwtSecret());
    if (payload.typ !== 'refresh') {
      throw new UnauthenticatedError('请使用 refreshToken 换取新的访问令牌');
    }
    const expiresIn = this.accessTtl();
    return {
      accessToken: signJwt(payload.sub, 'access', this.jwtSecret(), expiresIn),
      expiresIn,
    };
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

  bindCampus(
    userId: string,
    platform: CampusPlatform,
    credentials: CampusBindCredentials,
  ): Promise<CampusBindingRecord> {
    return this.campusSession.bind(userId, platform, credentials);
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
