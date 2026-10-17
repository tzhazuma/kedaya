import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateVerificationCodeInput,
  VerificationCodeRecord,
  VerificationCodeRepository,
} from '../domain/local-account.domain';
import type { VerificationPurpose } from '../domain/verification-code';

/**
 * 验证码仓储（Prisma）。
 *
 * 「最近一条未消费」用 `createdAt desc` 取第一条；
 * 频控用 `count since` —— 两条查询都走 `[target, purpose, createdAt]` 索引。
 */
@Injectable()
export class VerificationCodePrismaRepository implements VerificationCodeRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findLatestActive(
    target: string,
    purpose: VerificationPurpose,
  ): Promise<VerificationCodeRecord | null> {
    const row = await this.prisma.verificationCode.findFirst({
      where: { target, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toRecord(row) : null;
  }

  async countSince(
    target: string,
    purpose: VerificationPurpose,
    since: Date,
  ): Promise<number> {
    return this.prisma.verificationCode.count({
      where: { target, purpose, createdAt: { gte: since } },
    });
  }

  async create(input: CreateVerificationCodeInput): Promise<VerificationCodeRecord> {
    const row = await this.prisma.verificationCode.create({
      data: {
        target: input.target,
        purpose: input.purpose,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        ip: input.ip ?? null,
      },
    });
    return toRecord(row);
  }

  async incrementAttempts(id: string): Promise<void> {
    await this.prisma.verificationCode.update({
      where: { id },
      data: { attempts: { increment: 1 } },
    });
  }

  async consume(id: string, at: Date): Promise<void> {
    await this.prisma.verificationCode.update({
      where: { id },
      data: { consumedAt: at },
    });
  }

  async consumeAll(
    target: string,
    purpose: VerificationPurpose,
    at: Date,
  ): Promise<void> {
    await this.prisma.verificationCode.updateMany({
      where: { target, purpose, consumedAt: null },
      data: { consumedAt: at },
    });
  }
}

interface VerificationCodeRow {
  id: string;
  target: string;
  purpose: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

function toRecord(row: VerificationCodeRow): VerificationCodeRecord {
  return {
    id: row.id,
    target: row.target,
    purpose: row.purpose as VerificationPurpose,
    codeHash: row.codeHash,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    attempts: row.attempts,
    createdAt: row.createdAt,
  };
}
