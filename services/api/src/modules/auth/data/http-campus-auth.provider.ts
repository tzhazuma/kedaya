import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { UnauthenticatedError, InternalError } from '../../../common/errors/app-error';
import type { AuthPort, CampusIdentity } from '../domain/auth.domain';

/**
 * 真实统一身份认证（上海科技大学 IDS / Apereo CAS）。
 *
 * ## 为什么是 CAS `serviceValidate`，而不是模拟密码登录
 *
 * 学校 IDS 是 **Apereo CAS**（`https://ids.shanghaitech.edu.cn/authserver`），
 * 它的设计本来就是「用户在学校页面上登录，然后带着 ticket 跳回我们的回调」。
 *
 * **我们永远不接触用户的密码**：
 *   1. 前端跳到 `{IDS}/login?service={我们的回调}`
 *   2. 用户**在学校页面上**输入密码（我们看不到）
 *   3. 学校带着 `ticket` 跳回我们的回调
 *   4. 后端拿 ticket 去 `{IDS}/p3/serviceValidate` 换身份
 *   5. **拿到身份后立即丢弃 ticket** —— 不落库、不进日志、不进响应
 *
 * 这条路径下，用户的密码从来没有离开过学校的页面。
 *
 * ## 为什么用 `p3/serviceValidate?format=JSON`
 *
 * CAS 默认返回 XML，形如：
 * ```xml
 * <cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
 *   <cas:authenticationFailure code="INVALID_TICKET">…</cas:authenticationFailure>
 * </cas:serviceResponse>
 * ```
 * 解析 XML 要处理命名空间、实体转义、自闭合标签 —— 而 `format=JSON`
 * 直接返回同样的结构（`{ serviceResponse: { authenticationSuccess|Failure } }`），
 * 用 `JSON.parse` 就够了。少一类解析器就少一类漏洞。
 *
 * ## ⚠️ 前置条件（没满足就是起不来，不是"降级运行"）
 *
 * - `CAMPUS_CAS_URL` 必须配置（真实值：`https://ids.shanghaitech.edu.cn/authserver`）
 * - `CAMPUS_CAS_SERVICE` 必须是**校方已注册**的回调地址。
 *   未注册的 service 会在 CAS 侧被拒绝（这是校方的安全策略，不是我们的 bug）。
 *   在拿到注册之前，这个 provider **无法**在真实环境工作 —— 会如实报错。
 */
@Injectable()
export class HttpCampusAuthProvider implements AuthPort {
  /**
   * ⚠️ **恒为 false** —— 这个实现产出的是真实身份，不是模拟的。
   *
   * 登录响应里的 `simulated: false` 就来自这里。改成 true 会让真实身份
   * 被标成"演示数据"，用户会以为这不是他的真账号。
   */
  readonly simulated = false;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async authenticateTicket(ticket: string): Promise<CampusIdentity> {
    const base = (this.config.get<string>('CAMPUS_CAS_URL') ?? '').trim();
    const service = (this.config.get<string>('CAMPUS_CAS_SERVICE') ?? '').trim();

    if (base === '') {
      throw new InternalError(
        '统一身份认证未配置：CAMPUS_CAS_URL 为空。请填入学校 IDS 地址（如 https://ids.shanghaitech.edu.cn/authserver）',
      );
    }
    if (service === '') {
      throw new InternalError(
        '统一身份认证未配置：CAMPUS_CAS_SERVICE 为空。必须是**校方已注册**的回调地址，未注册的 service 会被 CAS 拒绝',
      );
    }
    if (ticket.trim() === '') {
      throw new UnauthenticatedError('登录票据为空，请重新从学校统一身份认证登录');
    }

    const url = new URL(`${base.replace(/\/+$/, '')}/p3/serviceValidate`);
    url.searchParams.set('service', service);
    url.searchParams.set('ticket', ticket.trim());
    url.searchParams.set('format', 'JSON');

    let payload: unknown;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        // 票据校验是登录链路上的同步步骤，不能无限等
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        throw new InternalError(`统一身份认证返回 HTTP ${response.status}，请稍后重试`);
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof InternalError) throw error;
      // ⚠️ 不要把上游错误原文暴露给用户 —— 里面可能含 ticket
      throw new InternalError('无法连接统一身份认证，请稍后重试');
    }

    const identity = parseServiceResponse(payload);

    // ⚠️ 到这里 ticket 的使命就结束了。**下面任何一行都不能再引用它。**
    //    不写日志、不落库、不进响应 —— 这是 I5 的一部分。
    return identity;
  }
}

/** CAS `p3/serviceValidate?format=JSON` 的成功响应里我们关心的字段 */
interface CasSuccess {
  readonly serviceResponse?: {
    readonly authenticationSuccess?: {
      readonly user?: unknown;
      readonly attributes?: Record<string, unknown>;
    };
    readonly authenticationFailure?: { readonly code?: unknown; readonly description?: unknown };
  };
}

/**
 * 把 CAS 的 JSON 响应变成 `CampusIdentity`。
 *
 * 抽成纯函数是为了**能测**：不用起 HTTP，喂一段 JSON 就能覆盖
 * 成功 / 票根无效 / 结构异常 / 属性缺失 四种情况。
 */
export function parseServiceResponse(payload: unknown): CampusIdentity {
  const root = payload as CasSuccess;
  const response = root?.serviceResponse;

  if (response === undefined || response === null) {
    throw new InternalError('统一身份认证返回了无法识别的响应');
  }

  if (response.authenticationFailure !== undefined) {
    // 上游只说"票根无效"，这里原话转述给用户 —— 不猜原因（过期？伪造？已被用过？）
    throw new UnauthenticatedError('登录已过期或票据无效，请重新从学校统一身份认证登录');
  }

  const success = response.authenticationSuccess;
  if (success === undefined || success === null) {
    throw new InternalError('统一身份认证返回了无法识别的响应');
  }

  const user = typeof success.user === 'string' ? success.user.trim() : '';
  if (user === '') {
    throw new InternalError('统一身份认证未返回学号');
  }

  const attributes = success.attributes ?? {};
  return {
    // 契约 §11.20-C 的规范枚举里，CAS 的身份来源就叫 `SHTU_CAS`
    provider: 'SHTU_CAS',
    // CAS 的 `user` 就是学号（工号）—— 这是上游的语义，不是我们的约定
    externalId: user,
    email: firstString(attributes, ['email', 'mail', 'emailAddress']),
    realName: firstString(attributes, ['name', 'cn', 'displayName', 'realName']),
    department: firstString(attributes, ['department', 'dept', 'ou', 'organization']),
  };
}

/**
 * CAS 的属性值**总是数组**（多值字段），但个别部署给单个字符串。
 * 两种都认，取第一个非空值。
 */
function firstString(
  attributes: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const raw = attributes[key];
    const candidate = Array.isArray(raw) ? raw[0] : raw;
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      return candidate.trim();
    }
  }
  return undefined;
}
