/**
 * 校园卡 · campus-card（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CampusCardTransaction } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateCampusCardTransactionInput,
  CampusCardTransactionModel,
  CampusCardTransactionRepository,
  UpdateCampusCardTransactionInput,
} from '../domain/campus-card.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 输入字段名与 Prisma 字段一一对应，因此直接复用基类的恒等映射。
 */
@Injectable()
export class CampusCardTransactionPrismaRepository
  extends PrismaCursorRepository<CampusCardTransaction, CampusCardTransactionModel, CreateCampusCardTransactionInput, UpdateCampusCardTransactionInput>
  implements CampusCardTransactionRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.campusCardTransaction);
  }

  /** 汇总总支出 / 总充值（整数分） */
  async summarize(userId: string): Promise<{ totalOutFen: number; totalInFen: number; count: number }> {
    const [out, incoming] = await Promise.all([
      this.prisma.campusCardTransaction.aggregate({
        where: { userId, direction: 'out' },
        _sum: { amountFen: true },
        _count: { _all: true },
      }),
      this.prisma.campusCardTransaction.aggregate({
        where: { userId, direction: 'in' },
        _sum: { amountFen: true },
        _count: { _all: true },
      }),
    ]);
    return {
      totalOutFen: out._sum.amountFen ?? 0,
      totalInFen: incoming._sum.amountFen ?? 0,
      count: out._count._all + incoming._count._all,
    };
  }

  async listRecent(userId: string, limit: number): Promise<CampusCardTransactionModel[]> {
    return this.prisma.campusCardTransaction.findMany({
      where: { userId },
      orderBy: [{ happenedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  async replaceAll(
    userId: string,
    rows: CreateCampusCardTransactionInput[],
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.campusCardTransaction.deleteMany({ where: { userId } });
      if (rows.length === 0) return 0;
      await tx.campusCardTransaction.createMany({
        data: rows.map((row) => ({
          userId,
          amountFen: row.amountFen,
          direction: row.direction,
          merchant: row.merchant,
          happenedAt: row.happenedAt,
          balanceAfterFen: row.balanceAfterFen,
        })),
      });
      return rows.length;
    });
  }

  async lastCachedAt(userId: string): Promise<Date | null> {
    const newest = await this.prisma.campusCardTransaction.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return newest?.createdAt ?? null;
  }}
