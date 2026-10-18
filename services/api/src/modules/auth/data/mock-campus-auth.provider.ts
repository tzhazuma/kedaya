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
 * ⚠️ 本 Mock **默认关闭**，且是 fail-closed（见 `assertMockExplicitlyAllowed`）。
 *
 * 这不是洁癖：`authenticateTicket` 会**直接采信** `mock-<学号>` 形式的票据
 * （`externalId` 就等于学号），而 `POST /auth/login` 按设计是公开接口 ——
 * 若把它带进任何真实环境，任何人 `curl` 一个学号就能拿到该校学生的令牌。
 *
 * 开启条件（**两条都必须满足**，缺一即拒绝）：
 *   1. `NODE_ENV` **显式**等于 `development` 或 `test`。
 *      —— 未设置 / 拼错 / `production` **一律拒绝**。
 *      （审计 P0-3：旧实现只在 `NODE_ENV === 'production'` 时拒绝，
 *       `NODE_ENV` 未设或拼错就放行 = 一条完整的身份伪造路径。）
 *   2. `CAMPUS_CAS_MOCK_ALLOWED` 是显式真值（`true` / `1` / `yes` / `on`）。
 *
 * `NODE_ENV=production` 下**即使**设置 `CAMPUS_CAS_MOCK_ALLOWED=true` 仍拒绝 ——
 * 生产必须接入真实 CAS，不能靠一个环境变量把后门打开。
 */
@Injectable()
export class MockCampusAuthProvider implements AuthPort {
  /**
   * 本实现产出的身份**永远是模拟身份**（不是真实 CAS 返回的学号/姓名）。
   *
   * `AuthService.login()` 会把它带进 CAS 登录响应（`simulated: true`），
   * 客户端据此显著标注「演示身份」，不把它当成真实校园身份。
   */
  readonly simulated = true;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async authenticateTicket(ticket: string): Promise<CampusIdentity> {
    this.assertMockExplicitlyAllowed();

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
   * Mock 身份闸门 —— **fail-closed**。
   *
   * 判定顺序（每一步都只会更严格）：
   *   1. `NODE_ENV=production` → 无条件拒绝（`CAMPUS_CAS_MOCK_ALLOWED` 也不放行）；
   *   2. `NODE_ENV` 未设置 / 拼错 → 拒绝（不能把"忘记设 NODE_ENV"当成开发环境）；
   *   3. 只有 `development` / `test` **且** `CAMPUS_CAS_MOCK_ALLOWED` 为真 → 放行。
   *
   * 为什么是 401 而**不是**拒绝启动（对比 `resolveMailTransport` 的取舍）：
   * 邮件没配时整条注册链路都是假的，起不来才是对的；
   * 而校园 CAS 只是一个**可选**登录入口 —— 邮箱与微信两条路仍然可用，
   * 所以正确的行为是「这个入口暂时不可用」，而不是整站不上线。
   * 用户看到的是明确的一句话，不是一个能冒充别人的后门。
   */
  private assertMockExplicitlyAllowed(): void {
    const nodeEnv = (this.config.get<string>('NODE_ENV') ?? '').trim().toLowerCase();

    // 1) 生产环境无条件拒绝 —— 不给「设了开关就放行」留口子。
    if (nodeEnv === 'production') {
      throw new UnauthenticatedError(
        '校园统一身份认证仍在向校方申请对接中，暂不可用。' +
          'Mock 身份在 NODE_ENV=production 下**无条件禁用**' +
          '（即使设置了 CAMPUS_CAS_MOCK_ALLOWED=true 也不会生效）——' +
          '它会信任 mock-<学号> 形式的票据，等于把任意学号的账号交给调用方。' +
          '请改用邮箱密码或微信登录；生产接入真实 CAS 后再开放这个入口。',
      );
    }

    // 2) 未设置 / 拼错一律拒绝。旧实现在这里 return（fail-open），是 P0-3 的根因。
    if (nodeEnv !== 'development' && nodeEnv !== 'test') {
      throw new UnauthenticatedError(
        'Mock 校园统一身份认证被拒绝：NODE_ENV 未设置或不是 development/test' +
          `（当前值：${nodeEnv === '' ? '未设置' : nodeEnv}）。` +
          '这项 fail-closed 校验是刻意的 —— NODE_ENV 拼错时绝不能退回「信任 mock 票据」。' +
          '本地开发/演示请**同时**设置 NODE_ENV=development 与 CAMPUS_CAS_MOCK_ALLOWED=true；' +
          '生产请接入真实 CAS，或改用邮箱密码 / 微信登录。',
      );
    }

    // 3) 非生产也要显式开启（默认关闭）。
    if (!isTruthy(this.config.get<string>('CAMPUS_CAS_MOCK_ALLOWED'))) {
      throw new UnauthenticatedError(
        'Mock 校园统一身份认证未开启：本环境的 CAS 登录要求显式设置 ' +
          'CAMPUS_CAS_MOCK_ALLOWED=true。' +
          '该开关会信任 mock-<学号> 形式的票据（等于暂时放弃这一级的身份校验），' +
          '只能用于本地开发/演示；生产环境即使设置也不会生效。' +
          '若不打算使用 mock，请改用邮箱密码或微信登录。',
      );
    }
  }
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
}
