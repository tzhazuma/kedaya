import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ConsentMeta, ConsentRecord, ConsentRepository } from '../compliance.types';

/** Consent 表的 Prisma 实现（data 层：唯一允许碰 IO 的地方） */
@Injectable()
export class ConsentPrismaRepository implements ConsentRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findActive(userId: string, module: string): Promise<ConsentRecord | null> {
    return this.prisma.consent.findFirst({
      where: { userId, module, revokedAt: null },
      select: { id: true, userId: true, module: true, version: true, grantedAt: true, revokedAt: true },
    });
  }

  async upsertGrant(userId: string, module: string, meta: ConsentMeta): Promise<ConsentRecord> {
    const version = meta.version ?? 'v1';
    return this.prisma.consent.upsert({
      where: { userId_module: { userId, module } },
      create: {
        userId,
        module,
        version,
        ip: meta.ip ?? null,
        ua: meta.ua ?? null,
      },
      update: {
        version,
        // 重新同意：刷新时间并清除撤回标记
        grantedAt: new Date(),
        revokedAt: null,
        ip: meta.ip ?? null,
        ua: meta.ua ?? null,
      },
      select: { id: true, userId: true, module: true, version: true, grantedAt: true, revokedAt: true },
    });
  }

  async revoke(userId: string, module: string): Promise<ConsentRecord | null> {
    const existing = await this.prisma.consent.findUnique({
      where: { userId_module: { userId, module } },
      select: { id: true, revokedAt: true },
    });
    if (!existing || existing.revokedAt) return null;

    return this.prisma.consent.update({
      where: { userId_module: { userId, module } },
      data: { revokedAt: new Date() },
      select: { id: true, userId: true, module: true, version: true, grantedAt: true, revokedAt: true },
    });
  }

  async listByUser(userId: string): Promise<ConsentRecord[]> {
    return this.prisma.consent.findMany({
      where: { userId },
      orderBy: { grantedAt: 'desc' },
      select: { id: true, userId: true, module: true, version: true, grantedAt: true, revokedAt: true },
    });
  }
}
