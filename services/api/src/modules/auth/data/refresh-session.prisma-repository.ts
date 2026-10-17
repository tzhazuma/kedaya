import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateRefreshSessionInput,
  RefreshSessionRecord,
  RefreshSessionRepository,
} from '../domain/local-account.domain';

/**
 * 刷新令牌会话（Prisma）。
 *
 * 这是「JWT 无状态」与「登出要立刻生效」之间的折中：
 *   · access token 仍然无状态、不查库（15 分钟，泄露窗口有限）；
 *   · refresh token 必须查库，因此可以被撤销、可以被轮换、
 *     改密码后可以把所有设备一次性踢下线。
 */
@Injectable()
export class RefreshSessionPrismaRepository implements RefreshSessionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateRefreshSessionInput): Promise<void> {
    await this.prisma.refreshSession.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
      },
    });
  }

  async findByHash(tokenHash: string): Promise<RefreshSessionRecord | null> {
    const row = await this.prisma.refreshSession.findUnique({ where: { tokenHash } });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
    };
  }

  async revoke(id: string, replacedById?: string): Promise<void> {
    await this.prisma.refreshSession.update({
      where: { id },
      data: { revokedAt: new Date(), replacedById: replacedById ?? null },
    });
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}
