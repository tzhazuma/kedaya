import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalError, UnauthenticatedError } from '../../common/errors/app-error';
import { signJwt, verifyJwt } from '../../common/auth/jwt';
import {
  CAMPUS_SESSION_PORT,
  isActiveLinkStatus,
  translateCampusSessionError,
  type CampusPlatform,
  type CampusSessionPort,
} from '../techpie/domain/ports/campus-session.port';
import {
  AUTH_PORT,
  USER_REPOSITORY,
  assertIdentityOnly,
  toCampusBindingSummary,
  toIdentitySession,
  type AuthPort,
  type CampusBindingSummary,
  type KedaYaIdentitySession,
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
  /**
   * `/auth/*` 的 wire 形状（`CampusBindingSummary`）—— **不是** `TechpieLink`。
   *
   * §11.19-C / §11.20-A：两个名字属于两个端点，形状不同、**不共用**。
   */
  campusBindings: CampusBindingSummary[];
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
 * ## 这个服务与第二级的关系（契约 §5 硬规则 1/2）
 *
 * 它**只**依赖 `AuthPort`（身份）与 `UserRepository`（自有账户）来**签发身份**。
 * 第二级的 `CampusSessionPort` 也注入了，但用途被严格限制为：
 *   · `me()` 把绑定状态作为**独立字段**返回；
 *   · `/auth/campus-bindings` 这组**已在冻结 OpenAPI 里登记**的端点。
 *
 * 它**绝不**参与签发 JWT，也**绝不**把 session 混进 login 的返回值。
 *
 * ## ⚠️ 端口为什么来自 `techpie/` 而不是本模块的 domain
 *
 * 不变式 **I2**（`modules/auth/data/**` 不得 import `campus-session.port`）的
 * 意图是"两级身份在**实现层**也不耦合"。把端口定义留在身份模块，
 * 那条扫描就只能靠"没写 import"通过。端口与实现都搬到能力层之后，
 * I2 是**结构性**成立的。
 *
 * ## ⚠️ I5：`session()` 必须是**纯本地读取**
 *
 * 它只读 `UserRepository.findById`（本地账户表），
 * **不得**触发任何上游调用 —— 否则首帧会被网络阻塞（契约 §8）。
 * 由 `test/techpie-http.spec.ts` 在"mock 上游全超时"环境下断言 < 50ms。
 *
 * ## ⚠️ 契约 §11.22-A：I1 只约束 `KedaYaIdentitySession` 与 `/auth/*`
 *
 * 本模块的**全部**响应投影（`toIdentitySession` / `toCampusBindingSummary`）
 * 都跑禁用键名断言。`/techpie/webview-session` 的 `ticket` 是**合法领域字段**，
 * 不受该禁令约束 —— 用词禁令只能约束它真正要约束的那个对象。
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

  /**
   * `GET /auth/session` —— **契约 §11.4 I1** 的落点。
   *
   * 返回 `KedaYaIdentitySession`（只有 `userId` / `studentId` / `name` / `department`）。
   * 那 8 个禁用键名在**类型上**就不存在，返回前再跑一次运行时断言。
   *
   * **纯本地读取**（不变式 I5）：只查本地账户表，不触发任何上游调用。
   */
  async session(userId: string): Promise<KedaYaIdentitySession> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthenticatedError('账户不存在，请重新登录');
    return toIdentitySession(user);
  }

  async me(userId: string): Promise<MeResult> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthenticatedError('账户不存在，请重新登录');

    const campusBindings = await this.listCampusBindings(userId);

    return {
      user,
      campusBindings,
      campusBound: campusBindings.some((binding) => binding.bound),
    };
  }

  /* ---------------- 第二级：校园系统绑定（`/auth/campus-bindings`） ---------------- */

  /**
   * `POST /auth/campus-bindings`。
   *
   * ⚠️ 它**不**返回任何凭证：`CampusBindingSummary` 里只有"绑没绑上 + 到期时刻"。
   * 校园 cookie 的唯一出口在 `modules/techpie/data/webview-session/`（不变式 I3）。
   *
   * ⚠️ 契约 §11.19-C：本端点的**形状与 `/techpie/links` 不同**（不共用名字）。
   */
  async bindCampus(
    userId: string,
    platform: CampusPlatform,
    credential: unknown,
  ): Promise<CampusBindingSummary> {
    try {
      const state = await this.campusSession.bind(userId, platform, credential as never);
      return toCampusBindingSummary(state);
    } catch (error) {
      // 与 `TechpieService.createLink` 用**同一份**翻译：
      // 不翻译的话 `PHASE_BLOCKED` 会变成 500（客户端会以为服务坏了，
      // 而真实语义是"这条路本轮不开放"）。
      throw translateCampusSessionError(error);
    }
  }

  async listCampusBindings(userId: string): Promise<CampusBindingSummary[]> {
    const states = await this.campusSession.listBindings(userId);
    return states.map(toCampusBindingSummary);
  }

  async unbindCampus(userId: string, platform: CampusPlatform): Promise<void> {
    try {
      await this.campusSession.unbind(userId, platform);
    } catch (error) {
      throw translateCampusSessionError(error);
    }
  }

  /**
   * 校园系统能力可用性（供 UI 判断是否要显示"去绑定"）。
   * 只返回布尔值，**绝不**把会话本身返回给调用方。
   */
  async campusCapability(userId: string, platform: CampusPlatform): Promise<{ available: boolean }> {
    const binding = await this.campusSession.getBinding(userId, platform);
    return { available: binding !== null && isActiveLinkStatus(binding.status) };
  }
}
