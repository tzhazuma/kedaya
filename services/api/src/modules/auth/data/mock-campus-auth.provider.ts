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
@Injectable()
export class MockCampusAuthProvider implements AuthPort {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async authenticateTicket(ticket: string): Promise<CampusIdentity> {
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
}
