import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InternalError,
  RateLimitedError,
  UnauthenticatedError,
  UpstreamUnavailableError,
} from '../../../common/errors/app-error';
import {
  assertWechatCodeShape,
  devOpenidFromCode,
  parseDevWechatCode,
  type WeChatSession,
  type WeChatSessionPort,
} from '../domain/wechat.domain';

/**
 * 微信小程序登录适配器（`WECHAT_SESSION_PORT` 的唯一实现）。
 *
 * 真实链路（生产）：
 *   小程序 `Taro.login()` → code
 *     → 服务端 `GET https://api.weixin.qq.com/sns/jscode2session
 *          ?appid=&secret=&js_code=&grant_type=authorization_code`
 *     → `{ openid, session_key, unionid? }`
 *     → **只用 openid**：identity 落库，`session_key` 立即丢弃。
 *
 * 开发链路（未配置小程序密钥）：
 *   客户端在非生产构建里发 `dev:<设备标识>`，这里映射成稳定的
 *   `dev_openid_<设备标识>`，让整条链路（建号 → 完善资料 → 再登录）可被演示。
 *   生产环境**一律拒绝** `dev:` code。
 *
 * 安全约定：
 *   · 绝不打日志输出 appId/secret/code/session_key；
 *   · 上游失败按错误码分流（见下），不把微信原始报文透传给客户端。
 */
@Injectable()
export class WeChatMiniProgramAdapter implements WeChatSessionPort {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async exchangeCode(code: string): Promise<WeChatSession> {
    const normalized = assertWechatCodeShape(code);

    const devSuffix = parseDevWechatCode(normalized);
    if (devSuffix !== null) {
      if (this.isProduction()) {
        // 生产环境绝不允许伪造 openid
        throw new UnauthenticatedError('微信登录凭证无效，请重启小程序后重试');
      }
      return { openid: devOpenidFromCode(devSuffix), simulated: true };
    }

    const appId = this.config.get<string>('WECHAT_MINIAPP_APPID');
    const secret = this.config.get<string>('WECHAT_MINIAPP_SECRET');
    if (!appId || !secret) {
      throw new InternalError(
        '微信登录未配置：请在服务端设置 WECHAT_MINIAPP_APPID / WECHAT_MINIAPP_SECRET；' +
          '本地开发无需密钥 —— 小程序会先请求 GET /auth/wechat/config，' +
          '发现未配置就自动使用 dev: 前缀的模拟凭证',
      );
    }

    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(appId)}` +
      `&secret=${encodeURIComponent(secret)}` +
      `&js_code=${encodeURIComponent(normalized)}` +
      '&grant_type=authorization_code';

    let payload: unknown;
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(this.timeoutMs()),
      });
      payload = await response.json();
    } catch {
      // 网络/超时/非 JSON：统一按上游不可用处理（客户端可重试）
      throw new UpstreamUnavailableError('微信登录服务暂时不可用，请稍后重试');
    }

    return this.parseUpstream(payload);
  }

  /* ---------------- 内部 ---------------- */

  private parseUpstream(payload: unknown): WeChatSession {
    if (typeof payload !== 'object' || payload === null) {
      throw new UpstreamUnavailableError('微信登录返回了无法解析的响应');
    }
    const body = payload as Record<string, unknown>;

    if (typeof body.errcode === 'number' && body.errcode !== 0) {
      switch (body.errcode) {
        case 40029: // invalid code
        case 40163: // code been used
          throw new UnauthenticatedError('微信登录凭证已失效，请重新登录');
        case 45011: // frequency limit
        case -1: // system busy
          throw new RateLimitedError('微信登录请求过于频繁，请稍后再试');
        default:
          throw new UpstreamUnavailableError('微信登录失败，请稍后重试');
      }
    }

    const openid = body.openid;
    if (typeof openid !== 'string' || openid.length === 0) {
      throw new UpstreamUnavailableError('微信登录未返回有效的 openid');
    }

    const unionid = typeof body.unionid === 'string' && body.unionid.length > 0 ? body.unionid : undefined;
    // 刻意不读取 session_key：当前版本不需要解密用户数据，拿到即弃。
    return unionid === undefined ? { openid, simulated: false } : { openid, unionid, simulated: false };
  }

  private isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private timeoutMs(): number {
    const raw = Number(this.config.get<string>('WECHAT_UPSTREAM_TIMEOUT_MS') ?? 5000);
    return Number.isFinite(raw) && raw > 0 ? raw : 5000;
  }

  /** 供自检端点/日志展示当前是真实还是模拟（**不含任何密钥**） */
  describeUpstream(): { configured: boolean; appIdTail: string | null } {
    const appId = this.config.get<string>('WECHAT_MINIAPP_APPID') ?? '';
    return {
      configured: appId.length > 0 && Boolean(this.config.get<string>('WECHAT_MINIAPP_SECRET')),
      appIdTail: appId.length >= 4 ? `***${appId.slice(-4)}` : null,
    };
  }
}
