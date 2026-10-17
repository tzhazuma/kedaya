import { ValidationError } from '../../../common/errors/app-error';

/* ================================================================== *
 * 微信小程序登录（第三条登录路径）
 *
 * 与契约 §5 的关系：
 *   它属于**第一级身份层**，和 CAS、邮箱密码一样只回答"你是谁"，
 *   产出的仍然是 KedaYa 自有 JWT。它**不**携带任何校园系统 session。
 *
 * 与 `AuthPort` 的关系：
 *   `AuthPort` 是"上科大统一身份认证"的端口；微信不是校园系统，
 *   因此单独一个端口，避免把两种上游揉进同一个接口（违反契约 §5 硬规则 1）。
 * ================================================================== */

/** `AuthIdentity.provider` 取值（与 CAS / EGATE 并列，仍然只是身份） */
export const WECHAT_IDENTITY_PROVIDER = 'WECHAT_MINIPROGRAM';

/**
 * 微信 code 换取的会话信息。
 *
 * ⚠️ `session_key` **刻意不在此处**：它属于"能解密用户数据"的凭据，
 * 一旦进入身份层，就会顺着 `assertIdentityOnly` 的判定变成违约字段。
 * 当前版本不需要解密（不用 `getPhoneNumber`），因此拿到后立即丢弃。
 */
export interface WeChatSession {
  /** 小程序内唯一标识，作为 AuthIdentity.externalId */
  openid: string;
  /** 开放平台统一标识；未绑定开放平台时为空。仅用于将来迁移，不参与唯一性判定 */
  unionid?: string;
  /**
   * 是否走了**开发模拟**（服务端未配置小程序密钥时的回退）。
   * UI 与日志据此明确标注，绝不把模拟身份当成真实微信身份。
   */
  simulated: boolean;
}

export interface WeChatSessionPort {
  /** `wx.login` 的 code → openid。实现方必须在返回前丢弃 session_key。 */
  exchangeCode(code: string): Promise<WeChatSession>;
  /**
   * 当前实现是否具备**真实**换取 openid 的能力（即配置了小程序密钥）。
   *
   * 客户端据此决定走 `Taro.login()` 还是开发模拟凭证 —— 不需要客户端
   * 再维护一个"我这个环境有没有密钥"的开关。
   */
  describeUpstream(): { configured: boolean; appIdTail: string | null };
}

export const WECHAT_SESSION_PORT = Symbol('KEDAYA_WECHAT_SESSION_PORT');

/* ---------------- code 约定 ---------------- */

/**
 * 开发模拟 code 前缀。
 *
 * 服务端没有 `WECHAT_MINIAPP_APPID/SECRET` 时无法调 `jscode2session`
 * （那是微信服务端接口，必须要有小程序密钥）。为了"没有密钥也能把整条链路跑通"，
 * 约定：客户端在非生产模式下返回 `dev:<设备标识>`，服务端映射成稳定的 openid。
 *
 * 三条硬约束：
 *   1. `dev:` 前缀的 code 只在**非生产**环境被接受，生产一律拒绝；
 *   2. 映射是**确定性**的（同一设备标识 → 同一账号），否则每次登录都会建新号；
 *   3. 模拟身份在会话响应里带 `simulated: true`，UI 必须标注"开发模式"。
 */
export const DEV_WECHAT_CODE_PREFIX = 'dev:';

/** 从 `dev:<id>` 里取出安全的设备标识 */
export function parseDevWechatCode(code: string): string | null {
  if (!code.startsWith(DEV_WECHAT_CODE_PREFIX)) return null;
  const suffix = code.slice(DEV_WECHAT_CODE_PREFIX.length).trim();
  if (suffix.length === 0 || suffix.length > 64) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(suffix)) return null;
  return suffix;
}

/** 开发模拟 code → openid（稳定、可预测，便于演示"老用户再登录"） */
export function devOpenidFromCode(suffix: string): string {
  return `dev_openid_${suffix}`;
}

/** `wx.login` 的 code 形状校验（微信是 32 位左右的随机串） */
export function assertWechatCodeShape(code: string): string {
  const trimmed = typeof code === 'string' ? code.trim() : '';
  if (trimmed.length === 0) {
    throw new ValidationError('缺少微信登录凭证（code）', { field: 'code' });
  }
  if (trimmed.length > 512) {
    throw new ValidationError('微信登录凭证过长', { field: 'code' });
  }
  return trimmed;
}
