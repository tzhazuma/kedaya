import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ComplianceModule } from '../../common/compliance/compliance.module';
import { TechpieModule } from '../techpie/techpie.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CampusIdentityController } from './campus-identity.controller';
import { CampusIdentityService } from './campus-identity.service';
import { LocalAuthController } from './local-auth.controller';
import { LocalAuthService } from './local-auth.service';
import { WechatAuthController } from './wechat-auth.controller';
import { WechatAuthService } from './wechat-auth.service';
import { ConsoleMailAdapter } from './data/console-mail.adapter';
import { SmtpMailAdapter, resolveMailTransport } from './data/smtp-mail.adapter';
import { HttpCampusDataAdapter } from './data/http-campus-data.adapter';
import { LocalAccountPrismaRepository } from './data/local-account.prisma-repository';
import { MockCampusAuthProvider } from './data/mock-campus-auth.provider';
import { MockCampusDataAdapter } from './data/mock-campus-data.adapter';
import { RefreshSessionPrismaRepository } from './data/refresh-session.prisma-repository';
import { UserPrismaRepository } from './data/user.prisma-repository';
import { AccountDeletionPrismaRepository } from './data/account-deletion.prisma-repository';
import { ACCOUNT_DELETION_REPOSITORY } from './domain/account-deletion.domain';
import { AccountDeletionService } from './application/account-deletion.service';
import { VerificationCodePrismaRepository } from './data/verification-code.prisma-repository';
import { WeChatMiniProgramAdapter } from './data/wechat-miniprogram.adapter';
import {
  AUTH_PORT,
  CAMPUS_SESSION_PORT,
  USER_REPOSITORY,
} from './domain/auth.domain';
import { CAMPUS_DATA_PORT } from './domain/campus-data.domain';
import {
  CLOCK,
  LOCAL_ACCOUNT_REPOSITORY,
  MAIL_PORT,
  REFRESH_SESSION_REPOSITORY,
  VERIFICATION_CODE_REPOSITORY,
} from './domain/local-account.domain';
import { WECHAT_SESSION_PORT } from './domain/wechat.domain';

/**
 * 身份模块（契约 §5 两级模型 + 三条登录路径）。
 *
 * 端口绑定一览（每个端口一个实现，物理隔离）：
 *   AUTH_PORT                 → MockCampusAuthProvider（第一级 CAS 身份，换真实 CAS 只替换它）
 *   WECHAT_SESSION_PORT       → WeChatMiniProgramAdapter（微信 code → openid，第一级）
 *   CAMPUS_SESSION_PORT       → PrismaCampusSessionAdapter（第二级，加密 session）
 *   CAMPUS_DATA_PORT          → Mock/HttpCampusDataAdapter（第二级取数，按 CAMPUS_DATA_MODE 切换）
 *   USER_REPOSITORY           → UserPrismaRepository（自有账户 + 身份映射）
 *   LOCAL_ACCOUNT_REPOSITORY  → LocalAccountPrismaRepository（邮箱 + 密码凭据）
 *   VERIFICATION_CODE_REPOSITORY → VerificationCodePrismaRepository（一次性验证码）
 *   REFRESH_SESSION_REPOSITORY   → RefreshSessionPrismaRepository（可撤销/轮换的刷新令牌）
 *   MAIL_PORT                 → SMTP（生产）/ ConsoleMailAdapter（开发，验证码写日志）
 *                               选择逻辑见 `resolveMailTransport`：生产没配 SMTP 会**拒绝启动**
 *
 * 三条登录路径（CAS / 邮箱密码 / 微信）共用 `AuthService.issueTokens`，
 * 因此签发出来的 JWT 完全同构；返回的账号信息也同构（见 `domain/account-session.ts`）。
 */
@Module({
  /**
   * 显式 import ComplianceModule（它虽然 `@Global`，但"全局"只在
   * **AppModule 装配之后**成立）。身份模块自己就依赖审计（`CampusIdentityService`
   * 在 reveal 明文时要落审计），显式声明后，任何"只装配 AuthModule + PrismaModule"
   * 的场景（例如打真库的集成测试）也能起来，不会再出现"少了 AuditService"。
   *
   * ⚠️ 同时 import `TechpieModule`：`/auth/campus-bindings` 的**唯一**实现是
   * techpie 的 `CAMPUS_SESSION_PORT`（§11.20 的收敛裁决）——
   * auth 自己那套大写平台 + `CampusBinding` 表**不再是**这条链路的 owner。
   * 两者之间**没有**模块环：TechpieModule 只 import IdempotencyModule。
   */
  imports: [ComplianceModule, TechpieModule],
  controllers: [AuthController, LocalAuthController, WechatAuthController, CampusIdentityController],
  providers: [
    AuthService,
    LocalAuthService,
    WechatAuthService,
    CampusIdentityService,
    MockCampusDataAdapter,
    HttpCampusDataAdapter,
    { provide: AUTH_PORT, useClass: MockCampusAuthProvider },
    { provide: WECHAT_SESSION_PORT, useClass: WeChatMiniProgramAdapter },
    {
      // 第二级「取数」实现：默认模拟（确定性数据，响应里标注 simulated），
      // 拿到官方授权后把 CAMPUS_DATA_MODE 切成 live 即可，端口契约不变。
      provide: CAMPUS_DATA_PORT,
      inject: [ConfigService, MockCampusDataAdapter, HttpCampusDataAdapter],
      useFactory: (
        config: ConfigService,
        mock: MockCampusDataAdapter,
        http: HttpCampusDataAdapter,
      ) => ((config.get<string>('CAMPUS_DATA_MODE') ?? 'mock') === 'live' ? http : mock),
    },
    { provide: USER_REPOSITORY, useClass: UserPrismaRepository },
    // 账号注销（PIPL 自助注销）：端口 → Prisma 实现
    { provide: ACCOUNT_DELETION_REPOSITORY, useClass: AccountDeletionPrismaRepository },
    AccountDeletionService,
    { provide: LOCAL_ACCOUNT_REPOSITORY, useClass: LocalAccountPrismaRepository },
    { provide: VERIFICATION_CODE_REPOSITORY, useClass: VerificationCodePrismaRepository },
    { provide: REFRESH_SESSION_REPOSITORY, useClass: RefreshSessionPrismaRepository },
    ConsoleMailAdapter,
    SmtpMailAdapter,
    {
      // 邮件实现按环境选择。生产环境没有 SMTP 配置时 `resolveMailTransport` 会抛错，
      // 让服务**起不来** —— 这是刻意的：邮箱注册是 CAS 未接通前唯一能自助走通的登录路径，
      // 一个「接口说已发送、用户永远收不到」的假功能比启动失败危险得多。
      provide: MAIL_PORT,
      inject: [ConfigService, ConsoleMailAdapter, SmtpMailAdapter],
      useFactory: (
        config: ConfigService,
        consoleMail: ConsoleMailAdapter,
        smtpMail: SmtpMailAdapter,
      ) => (resolveMailTransport(config) === 'smtp' ? smtpMail : consoleMail),
    },
    // 系统时钟（真实时间）。测试通过 `createTestingModule().overrideProvider(CLOCK)` 注入固定时钟。
    { provide: CLOCK, useValue: () => new Date() },
  ],
  exports: [
    AuthService,
    LocalAuthService,
    WechatAuthService,
    CampusIdentityService,
    AUTH_PORT,
    WECHAT_SESSION_PORT,
    // ⚠️ P0-1：**不再**从这里导出 `CAMPUS_SESSION_PORT`。
    // 凭证的唯一落点是 techpie 的 `CampusSessionService`（本模块已 import TechpieModule）。
    // 之前 auth 自己提供一份 `PrismaCampusSessionAdapter` 并导出同名 symbol，
    // 导致"两个 Symbol 同名不同值 + 两套表 + 读写互不相认"。
    // 需要它的模块请直接 import `TechpieModule`（`schedule.module` 已经这么做）。
    // 课表 / 校园卡模块依赖它去上游取数；导出后它们不必知道实现是谁。
    CAMPUS_DATA_PORT,
    // 系统时钟：跨模块共享同一份"现在"，便于测试注入固定时钟（课表/倒计时依赖它）。
    CLOCK,
  ],
})
export class AuthModule {}
