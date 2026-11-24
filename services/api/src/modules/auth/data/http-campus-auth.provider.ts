import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { UnauthenticatedError } from '../../../common/errors/app-error';
import type { AuthPort, CampusIdentity } from '../domain/auth.domain';

/** 便于测试注入 fetch（Nest 不能解析函数类型，必须用显式 token）。 */
export const CAS_FETCH = 'CAS_FETCH';

const DEFAULT_CAS_URL = 'https://ids.shanghaitech.edu.cn/authserver';

interface CasAttributes {
  user?: string;
  realName?: string;
  email?: string;
  department?: string;
}

/**
 * 真实 CAS 身份提供方（Apereo CAS 3.0 `/serviceValidate`）。
 *
 * 为什么在服务端做：`ticket` 是"一次性、有时效、与 service 绑定"的凭据，
 * 在浏览器里校验等于把票据交给前端；标准做法是服务端用同一个 `service`
 * 去校验，再把 `cas:user` 换成本系统的 JWT。
 *
 * 明确不做的事：
 * - 不打印 ticket / 校验 URL（URL 里含 ticket）；
 * - 不缓存 CAS 响应；
 * - 不把 `attributes` 之外的任何字段写进身份。
 *
 * 配置（`CAMPUS_CAS_MODE=live` 时启用）：
 *   CAMPUS_CAS_URL      默认 https://ids.shanghaitech.edu.cn/authserver
 *   CAMPUS_CAS_SERVICE  **必须**是校方注册过的回调地址
 */
@Injectable()
export class HttpCampusAuthProvider implements AuthPort {
  readonly simulated = false;

  private readonly casBaseUrl: string;
  private readonly service: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    config: ConfigService,
    @Optional() @Inject(CAS_FETCH) fetchImpl?: typeof fetch,
  ) {
    this.casBaseUrl = (config.get<string>('CAMPUS_CAS_URL') ?? DEFAULT_CAS_URL)
      .trim()
      .replace(/\/+$/, '');
    this.service = (config.get<string>('CAMPUS_CAS_SERVICE') ?? '').trim();
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async authenticateTicket(ticket: string): Promise<CampusIdentity> {
    const normalized = (ticket ?? '').trim();
    if (normalized === '') {
      throw new UnauthenticatedError('缺少 CAS 票据');
    }
    if (this.service === '') {
      throw new UnauthenticatedError(
        'CAMPUS_CAS_SERVICE 未配置：真实 CAS 需要校方注册的回调地址',
      );
    }

    let url: URL;
    try {
      url = new URL(`${this.casBaseUrl}/serviceValidate`);
    } catch {
      throw new UnauthenticatedError('CAMPUS_CAS_URL 不是合法地址');
    }
    url.searchParams.set('service', this.service);
    url.searchParams.set('ticket', normalized);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Accept: 'application/xml,text/xml' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new UnauthenticatedError('无法连接统一身份认证，请稍后重试');
    }
    if (!response.ok) {
      throw new UnauthenticatedError(`统一身份认证返回 ${response.status}`);
    }

    const xml = await response.text();
    const identity = parseCasServiceValidateResponse(xml);
    if (identity === null) {
      throw new UnauthenticatedError('CAS 票据无效或已过期，请重新登录');
    }
    return identity;
  }
}

/**
 * 解析 `/serviceValidate` 的 XML。失败（含 `<cas:authenticationFailure>`）返回 null。
 *
 * 不引入 XML 依赖：CAS 响应只有两种形态，用非贪婪正则取字段足够，
 * 且任何解析失败都会走到"票据无效"，不会误放行。
 */
export function parseCasServiceValidateResponse(
  xml: string,
): CampusIdentity | null {
  const user = matchTag(xml, 'cas:user');
  if (!user) return null;

  return {
    provider: 'SHTU_CAS',
    externalId: user,
    realName: matchTag(xml, 'cas:cn') ?? matchTag(xml, 'cas:displayName') ?? undefined,
    email: matchTag(xml, 'cas:mail') ?? undefined,
    department: matchTag(xml, 'cas:ou') ?? matchTag(xml, 'cas:department') ?? undefined,
  };
}

function matchTag(xml: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`);
  const match = pattern.exec(xml);
  const value = match?.[1]?.trim();
  return value ? decodeXmlEntities(value) : null;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
