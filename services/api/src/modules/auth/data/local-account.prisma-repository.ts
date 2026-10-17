import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConflictError } from '../../../common/errors/app-error';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AttachCredentialInput,
  CreateLocalAccountInput,
  LocalAccountRecord,
  LocalAccountRepository,
  LocalAccountStatus,
} from '../domain/local-account.domain';

/**
 * 自建账号的 Prisma 实现。
 *
 * 关键点：注册必须在**一个事务**里同时创建 `User` 与 `UserCredential`，
 * 并顺带建立默认的隐私开关行 —— 否则会出现「有凭据但没有用户资料」
 * 这种半成品账号，后续所有 `me` 查询都要做空值兜底。
 */
@Injectable()
export class LocalAccountPrismaRepository implements LocalAccountRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<LocalAccountRecord | null> {
    const row = await this.prisma.userCredential.findUnique({ where: { email } });
    return row ? toRecord(row) : null;
  }

  async findByUserId(userId: string): Promise<LocalAccountRecord | null> {
    const row = await this.prisma.userCredential.findUnique({ where: { userId } });
    return row ? toRecord(row) : null;
  }

  async createAccount(input: CreateLocalAccountInput): Promise<LocalAccountRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          displayName: input.displayName,
          anonEnabled: true,
          // 契约 §9：隐私开关默认全部关闭
          profileSetting: { create: {} },
          credential: {
            create: { email: input.email, passwordHash: input.passwordHash },
          },
        },
        include: { credential: true },
      });

      if (!user.credential) {
        // 事务里不可能出现，但类型上需要收敛
        throw new Error('创建账号失败：凭据未写入');
      }
      return user.credential;
    });

    return toRecord(row);
  }

  async attachCredential(input: AttachCredentialInput): Promise<LocalAccountRecord> {
    const existing = await this.prisma.userCredential.findUnique({ where: { userId: input.userId } });
    if (existing) {
      // 一个账号只允许一套邮箱密码；重复挂载属于状态冲突，不做静默覆盖。
      throw new ConflictError('该账号已设置邮箱密码', { email: existing.email });
    }

    const row = await this.prisma.userCredential.create({
      data: {
        userId: input.userId,
        email: input.email,
        passwordHash: input.passwordHash,
      },
    });
    return toRecord(row);
  }

  async updatePassword(accountId: string, passwordHash: string): Promise<void> {    await this.prisma.userCredential.update({
      where: { id: accountId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
        status: 'active',
      },
    });
  }

  async recordFailedAttempt(
    accountId: string,
    failedAttempts: number,
    lockedUntil: Date | null,
  ): Promise<void> {
    await this.prisma.userCredential.update({
      where: { id: accountId },
      data: {
        failedAttempts,
        lockedUntil,
        status: lockedUntil ? 'locked' : 'active',
      },
    });
  }

  async markLogin(accountId: string, at: Date): Promise<void> {
    await this.prisma.userCredential.update({
      where: { id: accountId },
      data: { lastLoginAt: at, failedAttempts: 0, lockedUntil: null, status: 'active' },
    });
  }
}

interface CredentialRow {
  id: string;
  userId: string;
  email: string;
  passwordHash: string;
  status: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date;
  lastLoginAt: Date | null;
}

function toRecord(row: CredentialRow): LocalAccountRecord {
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    passwordHash: row.passwordHash,
    status: row.status as LocalAccountStatus,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
    passwordChangedAt: row.passwordChangedAt,
    lastLoginAt: row.lastLoginAt,
  };
}

/** 默认展示名：邮箱前缀（去掉非常规字符），保证可读且不会为空 */
export function deriveDisplayName(email: string): string {
  const prefix = email.split('@')[0] ?? '';
  const cleaned = prefix.replace(/[^0-9A-Za-z._-]/g, '');
  if (cleaned.length >= 2) return cleaned.slice(0, 24);
  return `鸭友${randomBytes(2).toString('hex')}`;
}
