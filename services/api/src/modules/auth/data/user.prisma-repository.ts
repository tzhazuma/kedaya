import { Inject, Injectable } from '@nestjs/common';
import type { AuthIdentity, User } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  NotFoundError,
  ValidationError,
} from '../../../common/errors/app-error';
import type {
  CampusIdentity,
  CampusIdentityProvider,
  IdentityRecord,
  ProfilePatch,
  UserRecord,
  UserRepository,
} from '../domain/auth.domain';

/**
 * KedaYa 自有账户的 Prisma 实现。
 *
 * 只写 AuthIdentity（第一级身份映射），**不碰** CampusBinding（第二级）。
 * 这正是契约 §5 在数据访问层的体现：两张表由两个不同的仓储负责。
 *
 * 本仓储同时承载三条身份路径（CAS / 微信 / 邮箱），因为它们在库里
 * 都是同一张 `AuthIdentity` / `User` —— 差别只在 provider 与凭据表。
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
          // 上游没给的字段不要用 null 覆盖已有值（微信不回传邮箱/院系）
          ...(identity.email === undefined ? {} : { email: identity.email }),
          ...(identity.realName === undefined ? {} : { realName: identity.realName }),
          ...(identity.department === undefined ? {} : { department: identity.department }),
          lastLoginAt: new Date(),
        },
        include: { user: true },
      });
      return toUserRecord(refreshed.user);
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
    });

    return toUserRecord(created);
  }

  async findById(id: string): Promise<UserRecord | null> {
    // ⚠️ **必须**过滤 `deletedAt: null`。
    //
    // 注销时我们**刻意不删 User 行**（否则他的帖子/拼单会变成孤儿），
    // 只做匿名化。而 JWT 是无状态的 —— 旧 access token 签名依然有效。
    // 如果这里不过滤，注销后拿旧 token 调 `/auth/me` 仍会 200，
    // 「注销后立即失效」就是一句空话。
    //
    // 用 `findFirst` 而不是 `findUnique`：加了 `deletedAt` 条件后
    // `findUnique` 的 where 只接受唯一字段。
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    return user ? toUserRecord(user) : null;
  }

  async findIdentity(
    provider: CampusIdentityProvider,
    externalId: string,
  ): Promise<{ userId: string; identity: IdentityRecord } | null> {
    const row = await this.prisma.authIdentity.findUnique({
      where: { provider_externalId: { provider, externalId } },
    });
    if (!row) return null;
    return { userId: row.userId, identity: toIdentityRecord(row) };
  }

  async linkIdentity(userId: string, identity: CampusIdentity): Promise<IdentityRecord> {
    const existing = await this.findIdentity(identity.provider, identity.externalId);
    if (existing) {
      if (existing.userId === userId) return existing.identity;
      // 该上游身份已属于另一个账号：交给调用方翻成 409，避免"悄悄抢占"他人身份
      throw new ValidationError('该身份已绑定到其他账号', { provider: identity.provider });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('账号不存在，请重新登录');

    const created = await this.prisma.authIdentity.create({
      data: {
        userId,
        provider: identity.provider,
        externalId: identity.externalId,
        email: identity.email ?? null,
        realName: identity.realName ?? null,
        department: identity.department ?? null,
        lastLoginAt: new Date(),
      },
    });
    return toIdentityRecord(created);
  }

  async unlinkIdentity(userId: string, provider: CampusIdentityProvider): Promise<number> {
    const result = await this.prisma.authIdentity.deleteMany({ where: { userId, provider } });
    return result.count;
  }

  async listIdentities(userId: string): Promise<IdentityRecord[]> {
    const rows = await this.prisma.authIdentity.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toIdentityRecord);
  }

  async updateProfile(userId: string, patch: ProfilePatch): Promise<UserRecord> {
    // 与 `findById` 同一条不变式：已注销（deletedAt 非空）的账号视同不存在。
    // 否则旧 access token 仍能把「已注销用户」改回一个真实昵称 —— 破坏匿名化。
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundError('账号不存在，请重新登录');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
        ...(patch.avatarUrl === undefined ? {} : { avatarUrl: patch.avatarUrl }),
        ...(patch.department === undefined ? {} : { department: patch.department }),
      },
    });
    return toUserRecord(updated);
  }
}

function toUserRecord(user: User): UserRecord {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    department: user.department,
    createdAt: user.createdAt,
  };
}

function toIdentityRecord(row: AuthIdentity): IdentityRecord {
  return {
    provider: row.provider as CampusIdentityProvider,
    externalId: row.externalId,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}
