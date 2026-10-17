import { Module } from '@nestjs/common';
import { TechpieModule } from '../techpie/techpie.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MockCampusAuthProvider } from './data/mock-campus-auth.provider';
import { UserPrismaRepository } from './data/user.prisma-repository';
import { AUTH_PORT, USER_REPOSITORY } from './domain/auth.domain';

/**
 * 身份模块（契约 §5 两级模型）。
 *
 * ## 端口绑定
 *
 * | 端口 | 实现 | 层级 |
 * | --- | --- | --- |
 * | `AUTH_PORT` | `MockCampusAuthProvider` | 第一级 · 身份（上科大 CAS） |
 * | `CAMPUS_SESSION_PORT` | **由 `TechpieModule` 提供** | 第二级 · 能力（校园会话） |
 * | `USER_REPOSITORY` | `UserPrismaRepository` | KedaYa 自有账户 |
 *
 * 换成真实 CAS 时只需替换 `AUTH_PORT` 的 provider，其余代码不动。
 *
 * ## ⚠️ 第二级的实现为什么不在本模块
 *
 * 契约 §5 硬规则 1 要求两级身份在**实现层**也不耦合；不变式 **I2** 把它钉成静态扫描
 * （`modules/auth/data/**` 不得 import `campus-session.port`）。
 * 本模块因此**不再持有**任何校园会话实现 —— 它只 `import TechpieModule` 拿到端口。
 * `modules/auth/data/` 现在只剩两件事：CAS 身份提供方与自有账户仓储。
 */
@Module({
  imports: [TechpieModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: AUTH_PORT, useClass: MockCampusAuthProvider },
    { provide: USER_REPOSITORY, useClass: UserPrismaRepository },
  ],
  exports: [AuthService, AUTH_PORT, USER_REPOSITORY],
})
export class AuthModule {}
