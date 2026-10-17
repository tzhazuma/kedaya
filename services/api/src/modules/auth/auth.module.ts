import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalAuthController } from './local-auth.controller';
import { LocalAuthService } from './local-auth.service';
import { WechatAuthController } from './wechat-auth.controller';
import { WechatAuthService } from './wechat-auth.service';
import { ConsoleMailAdapter } from './data/console-mail.adapter';
import { LocalAccountPrismaRepository } from './data/local-account.prisma-repository';
import { MockCampusAuthProvider } from './data/mock-campus-auth.provider';
import { PrismaCampusSessionAdapter } from './data/prisma-campus-session.adapter';
import { RefreshSessionPrismaRepository } from './data/refresh-session.prisma-repository';
import { UserPrismaRepository } from './data/user.prisma-repository';
import { VerificationCodePrismaRepository } from './data/verification-code.prisma-repository';
import { WeChatMiniProgramAdapter } from './data/wechat-miniprogram.adapter';
import {
  AUTH_PORT,
  CAMPUS_SESSION_PORT,
  USER_REPOSITORY,
} from './domain/auth.domain';
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
 *   USER_REPOSITORY           → UserPrismaRepository（自有账户 + 身份映射）
 *   LOCAL_ACCOUNT_REPOSITORY  → LocalAccountPrismaRepository（邮箱 + 密码凭据）
 *   VERIFICATION_CODE_REPOSITORY → VerificationCodePrismaRepository（一次性验证码）
 *   REFRESH_SESSION_REPOSITORY   → RefreshSessionPrismaRepository（可撤销/轮换的刷新令牌）
 *   MAIL_PORT                 → ConsoleMailAdapter（开发用邮件实现，生产换 SMTP）
 *
 * 三条登录路径（CAS / 邮箱密码 / 微信）共用 `AuthService.issueTokens`，
 * 因此签发出来的 JWT 完全同构；返回的账号信息也同构（见 `domain/account-session.ts`）。
 */
@Module({
  controllers: [AuthController, LocalAuthController, WechatAuthController],
  providers: [
    AuthService,
    LocalAuthService,
    WechatAuthService,
    { provide: AUTH_PORT, useClass: MockCampusAuthProvider },
    { provide: WECHAT_SESSION_PORT, useClass: WeChatMiniProgramAdapter },
    { provide: CAMPUS_SESSION_PORT, useClass: PrismaCampusSessionAdapter },
    { provide: USER_REPOSITORY, useClass: UserPrismaRepository },
    { provide: LOCAL_ACCOUNT_REPOSITORY, useClass: LocalAccountPrismaRepository },
    { provide: VERIFICATION_CODE_REPOSITORY, useClass: VerificationCodePrismaRepository },
    { provide: REFRESH_SESSION_REPOSITORY, useClass: RefreshSessionPrismaRepository },
    { provide: MAIL_PORT, useClass: ConsoleMailAdapter },
    // 系统时钟（真实时间）。测试通过 `createTestingModule().overrideProvider(CLOCK)` 注入固定时钟。
    { provide: CLOCK, useValue: () => new Date() },
  ],
  exports: [
    AuthService,
    LocalAuthService,
    WechatAuthService,
    AUTH_PORT,
    WECHAT_SESSION_PORT,
    CAMPUS_SESSION_PORT,
  ],
})
export class AuthModule {}
