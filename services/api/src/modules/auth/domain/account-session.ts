import type { AccountSummary } from './account-summary';
import type { UserRecord } from './auth.domain';

/**
 * 登录 / 注册 / 微信登录 / 改密的**统一响应形状**。
 *
 * 三条身份路径（CAS、邮箱密码、微信）签发同构 JWT，
 * 也返回同构的账号信息 —— 客户端因此只需要一套解析与一套「我的」渲染逻辑。
 *
 * 仍然遵守契约 §5：`campusBound` 恒定 false（登录 ≠ 已绑定校园系统），
 * 响应里不出现任何校园 session。
 */
export interface AccountSession {
  user: UserRecord;
  accessToken: string;
  refreshToken: string;
  /** access token 有效期（秒），与 `expiresAt` 冗余，便于客户端倒计时 */
  expiresIn: number;
  /** access token 绝对过期时间（ISO-8601 UTC） */
  expiresAt: string;
  /** 恒定 false：登录 ≠ 已绑定校园系统（契约 §5 硬规则 3） */
  campusBound: false;
  /** 账号登录方式概览（是否已设邮箱密码 / 是否已绑微信） */
  account: AccountSummary;
  /** 本次调用是否**首次建号**（客户端据此引导「完善资料」） */
  isNewUser: boolean;
  /**
   * 本次身份是否来自**模拟实现**。当前有两个来源：
   *   · 微信小程序：服务端未配置 `WECHAT_MINIAPP_APPID/SECRET` 时的 `dev:` 凭证；
   *   · 校园 CAS：`AUTH_PORT` 仍是 `MockCampusAuthProvider`（它恒为 true）。
   *
   * 两种登录都会返回该字段；CAS 路径是**必填布尔值**（见 `AuthService.LoginResult`），
   * 真实 CAS 实现为 false。UI 必须明确标注「演示身份」，
   * 绝不把 `mock-<学号>` 当成真实学号、也不把 `dev_openid_*` 当成真实微信身份。
   */
  simulated?: boolean;
}
