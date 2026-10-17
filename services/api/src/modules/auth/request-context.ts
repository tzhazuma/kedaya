import type { AuthRequestContext } from './domain/local-account.domain';

/**
 * 从请求头读取认证上下文（IP / UA）。
 *
 * 只用于风控与刷新令牌会话的展示，**绝不参与业务判定**，
 * 也不写入任何响应。三个 auth 控制器共用这一份实现。
 */
export function readAuthContext(
  headers: Record<string, string | string[] | undefined>,
): AuthRequestContext {
  const forwarded = headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = typeof rawIp === 'string' ? rawIp.split(',')[0]?.trim() : undefined;

  const ua = headers['user-agent'];
  const userAgent = Array.isArray(ua) ? ua[0] : ua;

  return {
    ...(ip === undefined || ip === '' ? {} : { ip }),
    ...(userAgent === undefined ? {} : { userAgent }),
  };
}
