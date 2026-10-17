/**
 * 校园卡 · data 层仓储（契约 §11.21-B）
 *
 * data 层是**唯一允许碰 IO 的地方**（契约 §7 依赖方向 `domain ← data`）。
 *
 * ⚠️ 本文件**不再是**脚手架生成的 `PrismaCursorRepository` 恒等映射：
 * 裁决 §11.21-B 把字段名从 `happenedAt` 改成 **`occurredAt`**、把方向从
 * `out`/`in` 改成 **`DEBIT`/`CREDIT`**，因此需要**显式映射**，
 * 而不是让 Prisma 行字段直接当领域模型用。
 *
 * 显式映射还有一个结构性的好处：将来给 Prisma 模型加列时，
 * 它**默认不会**出现在任何响应里。
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '@kedaya/contracts';
import type { CampusCardTransaction } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CAMPUS_CARD_DIRECTIONS,
  type CampusCardDirection,
  type CampusCardListParams,
  type CampusCardTransactionModel,
  type CampusCardTransactionRepository,
} from '../domain/campus-card.domain';

/**
 * 落库的方向字符串 → 契约方向。
 *
 * ⚠️ 旧数据里可能是 `out` / `in`（脚手架形状）。这里**不做**静默兼容映射 ——
 * 那等于把"两个名字"永久留在系统里（§11.20-D 明确反对）。
 * 迁移 `20261017070000_campus_card` 已把列改名并统一语义；
 * 读到不认识的取值时**原样暴露**，让上游的数据问题可见，而不是猜。
 */
function toDirection(raw: string): CampusCardDirection {
  return (CAMPUS_CARD_DIRECTIONS as readonly string[]).includes(raw)
    ? (raw as CampusCardDirection)
    : (raw as CampusCardDirection);
}

/** 行 → 领域模型（逐字段显式挑选） */
export function toTransactionModel(row: CampusCardTransaction): CampusCardTransactionModel {
  return {
    id: row.id,
    userId: row.userId,
    amountFen: row.amountFen,
    direction: toDirection(row.direction),
    balanceAfterFen: row.balanceAfterFen,
    occurredAt: row.occurredAt,
    merchant: row.merchant,
    createdAt: row.createdAt,
  };
}

/** 排序：最新在前。`id` 作为**唯一**的并列裁决键，保证游标分页是确定的。 */
const NEWEST_FIRST = [{ occurredAt: 'desc' }, { id: 'desc' }] as const;

@Injectable()
export class CampusCardTransactionPrismaRepository implements CampusCardTransactionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listByUser(
    userId: string,
    { cursor, limit }: CampusCardListParams,
  ): Promise<Page<CampusCardTransactionModel>> {
    const id = decodeCursor(cursor);
    const rows = await this.prisma.campusCardTransaction.findMany({
      where: { userId },
      take: limit + 1,
      orderBy: [...NEWEST_FIRST],
      ...(id ? { cursor: { id }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;
    const last = visible.at(-1);
    return {
      items: visible.map(toTransactionModel),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }

  async latestByUser(userId: string): Promise<CampusCardTransactionModel | null> {
    const row = await this.prisma.campusCardTransaction.findFirst({
      where: { userId },
      orderBy: [...NEWEST_FIRST],
    });
    return row ? toTransactionModel(row) : null;
  }
}
