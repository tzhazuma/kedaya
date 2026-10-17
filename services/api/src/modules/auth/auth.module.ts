import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MockCampusAuthProvider } from './data/mock-campus-auth.provider';
import { PrismaCampusSessionAdapter } from './data/prisma-campus-session.adapter';
import { UserPrismaRepository } from './data/user.prisma-repository';
import { AUTH_PORT, CAMPUS_SESSION_PORT, USER_REPOSITORY } from './domain/auth.domain';

/**
 * 身份模块（契约 §5 两级模型）。
 *
 * 两个端口分别绑定到两个实现，**物理隔离**：
 *   AUTH_PORT          → MockCampusAuthProvider（第一级，上科大 CAS）
 *   CAMPUS_SESSION_PORT → PrismaCampusSessionAdapter（第二级，加密 session）
 *
 * 换成真实 CAS 时只需替换 AUTH_PORT 的 provider，其余代码不动。
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: AUTH_PORT, useClass: MockCampusAuthProvider },
    { provide: CAMPUS_SESSION_PORT, useClass: PrismaCampusSessionAdapter },
    { provide: USER_REPOSITORY, useClass: UserPrismaRepository },
  ],
  exports: [AuthService, AUTH_PORT, CAMPUS_SESSION_PORT],
})
export class AuthModule {}
