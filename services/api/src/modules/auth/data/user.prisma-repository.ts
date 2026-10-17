import { Inject, Injectable } from '@nestjs/common';
import type { AuthIdentity, User } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { CampusIdentity, UserRecord, UserRepository } from '../domain/auth.domain';

/**
 * KedaYa 自有账户的 Prisma 实现。
 *
 * 只写 AuthIdentity（第一级身份映射），**不碰** CampusBinding（第二级）。
 * 这正是契约 §5 在数据访问层的体现：两张表由两个不同的仓储负责。
 */
@Injectable()
export class UserPrismaRepository implements UserRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async upsertFromIdentity(identity: CampusIdentity): Promise<UserRecord> {
    const existing = await this.prisma.authIdentity.findUnique({
      where: {
        provider_externalId: { provider: identity.provider, externalId: identity.externalId },
      },
      include: { user: true },
    });

    if (existing) {
      const refreshed = await this.prisma.authIdentity.update({
        where: { id: existing.id },
        data: {
          email: identity.email ?? null,
          realName: identity.realName ?? null,
          department: identity.department ?? null,
          lastLoginAt: new Date(),
        },
        include: { user: true },
      });
      return toUserRecord(refreshed.user, refreshed);
    }

    const created = await this.prisma.user.create({
      data: {
        displayName: identity.realName ?? `同学${identity.externalId.slice(-4)}`,
        department: identity.department ?? null,
        identities: {
          create: {
            provider: identity.provider,
            externalId: identity.externalId,
            email: identity.email ?? null,
            realName: identity.realName ?? null,
            department: identity.department ?? null,
            lastLoginAt: new Date(),
          },
        },
        // 首次登录即建立默认隐私开关（全部默认关闭，契约 §9 数据最小化）
        profileSetting: { create: {} },
      },
      include: { identities: true },
    });

    return toUserRecord(created, created.identities[0] ?? null);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { identities: true } });
    return user ? toUserRecord(user, user.identities[0] ?? null) : null;
  }
}

/**
 * 行 → 领域模型。
 *
 * `studentId` 来自第一级身份映射（`AuthIdentity.externalId`），
 * 是**身份**的一部分，不是凭证 —— 它不涉及任何校园系统 session。
 */
function toUserRecord(user: User, identity: AuthIdentity | null): UserRecord {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    department: user.department,
    studentId: identity?.externalId ?? null,
    createdAt: user.createdAt,
  };
}
