import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnauthenticatedError } from '../../../common/errors/app-error';
import type { AuthPort, CampusIdentity } from '../domain/auth.domain';

/**
 * 第一级身份提供方 —— **Mock 实现**。
 *
 * ⚠️ 真实对接点（契约 §5 第一级 · 上科大统一身份认证）
 * ------------------------------------------------------------------
 * 本项目是第三方非官方平台，真实接入需要向学校信息化办申请 OAuth/CAS 客户端。
 * 真实实现应替换本类，但**必须保持 AuthPort 的返回类型不变**：
 *
 *   1. 前端跳转
 *        GET {CAMPUS_CAS_URL}/login?service={CAMPUS_SSO_CLIENT_ID 对应的回调地址}
 *   2. 用户在上科大 CAS 完成认证后，回调带 `ticket`
 *   3. 服务端（**绝不**在客户端做）校验票据：
 *        GET {CAMPUS_CAS_URL}/serviceValidate
 *            ?service=<回调地址>&ticket=<ticket>
 *      解析返回的 XML/JSON，取学号、姓名、院系、邮箱
 *   4. 若走 Egate OAuth：用 CAMPUS_SSO_CLIENT_ID/SECRET 走
 *        authorization_code 换 access_token，再调 /userinfo 取 sub
 *   5. **拿到身份后立即丢弃 ticket / access_token** ——
 *      只把身份字段写进 AuthIdentity 表，不落库、不进日志、不进响应
 *
 * 本 Mock 的语义：用 ticket 的 sha256 派生一个稳定的 externalId，
 * 使"同一 ticket → 同一账户"，便于本地把登录/绑定/二次同意整条链路跑通。
 */
/**
 * ⚠️ 本 Mock **在生产环境默认关闭**（见 `assertAllowedInProduction`）。
 *
 * 这不是洁癖：`authenticateTicket` 会**直接采信** `mock-<学号>` 形式的票据
 * （`externalId` 就等于学号），而 `POST /auth/login` 按设计是公开接口 ——
 * 若把它带进生产，任何人 `curl` 一个学号就能拿到该校学生的令牌。
 * 所以生产环境必须显式 `CAMPUS_CAS_MOCK_ALLOWED=true` 才会打开，
 * 且这条限制要写在部署记录里。
 */
@Injectable()
export class MockCampusAuthProvider implements AuthPort {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async authenticateTicket(ticket: string): Promise<CampusIdentity> {
    this.assertAllowedInProduction();

    const normalized = ticket.trim();
    if (normalized.length === 0) {
      throw new UnauthenticatedError('缺少上科大统一身份认证票据（ticket）');
    }

    // Mock 约定：ticket 形如 "mock-<学号>" 时直接采信学号，否则由哈希派生
    const mockStudentNo = /^mock-(\d{8})$/.exec(normalized)?.[1];
    const externalId = mockStudentNo ?? createHash('sha256').update(normalized).digest('hex').slice(0, 16);

    // 只返回身份字段。任何凭据都不在这里出现（assertIdentityOnly 会兜底断言）。
    return {
      provider: 'SHTU_CAS',
      externalId,
      email: `${externalId}@shanghaitech.edu.cn`,
      realName: `同学${externalId.slice(-4)}`,
      department: '未填写（真实实现来自 CAS 返回的院系字段）',
    };
  }

  /** 供自检端点展示当前上游配置来源（不含任何密钥） */
  describeUpstream(): { casUrl: string; clientId: string | null } {
    return {
      casUrl: this.config.get<string>('CAMPUS_CAS_URL') ?? '(未配置 CAMPUS_CAS_URL)',
      clientId: this.config.get<string>('CAMPUS_SSO_CLIENT_ID') ?? null,
    };
  }

  /**
   * 生产环境的兜底闸门。
   *
   * 为什么是 401 而**不是**拒绝启动（对比 `resolveMailTransport` 的取舍）：
   * 邮件没配时整条注册链路都是假的，起不来才是对的；
   * 而校园 CAS 只是一个**可选**登录入口 —— 邮箱与微信两条路仍然可用，
   * 所以正确的行为是「这个入口暂时不可用」，而不是整站不上线。
   * 用户看到的是明确的一句话，不是一个能冒充别人的后门。
   */
  private assertAllowedInProduction(): void {
    if (this.config.get<string>('NODE_ENV') !== 'production') return;
    if (isTruthy(this.config.get<string>('CAMPUS_CAS_MOCK_ALLOWED'))) return;
    throw new UnauthenticatedError(
      '校园统一身份认证仍在向校方申请对接中，暂不可用。请改用邮箱密码或微信登录；' +
        '若这只是一次演示部署，请显式设置 CAMPUS_CAS_MOCK_ALLOWED=true' +
        '（它会信任 mock-<学号> 形式的票据，等于暂时放弃这一级的身份校验）。',
    );
  }
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}
