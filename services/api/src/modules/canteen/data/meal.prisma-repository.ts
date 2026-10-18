/**
 * 营养管家园 · 当餐记录的 Prisma 实现
 *
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 营养值在 create 时由 service 快照好传入，本文件只负责落库与回读。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { MealItem, MealRecord } from '@prisma/client';
import { sumItems, type MealItemLike } from '@kedaya/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  MealItemModel,
  MealRecordModel,
  MealRecordRepository,
  RecordMealInput,
  UpdateMealInput,
} from '../domain/meal.domain';

type RowWithItems = MealRecord & { items: MealItem[] };

@Injectable()
export class MealRecordPrismaRepository implements MealRecordRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(userId: string, input: RecordMealInput, items: MealItemModel[]): Promise<MealRecordModel> {
    const row = await this.prisma.mealRecord.create({
      data: {
        userId,
        mealType: input.mealType,
        source: input.source,
        eatenAt: input.eatenAt ?? new Date(),
        note: input.note ?? null,
        clientRequestId: input.clientRequestId ?? null,
        items: {
          create: items.map((item) => ({
            dishId: item.dishId,
            dishName: item.dishName,
            category: item.category,
            servings: item.servings,
            caloriesKcal: item.caloriesKcal,
            proteinG: item.proteinG,
            fatG: item.fatG,
            carbG: item.carbG,
            fiberG: item.fiberG,
            sodiumMg: item.sodiumMg,
          })),
        },
      },
      include: { items: true },
    });
    return this.toModel(row);
  }

  async listByUser(userId: string, from: Date, to: Date): Promise<MealRecordModel[]> {
    const rows = await this.prisma.mealRecord.findMany({
      where: { userId, eatenAt: { gte: from, lt: to } },
      include: { items: true },
      orderBy: { eatenAt: 'desc' },
    });
    return rows.map((row) => this.toModel(row));
  }

  async findById(userId: string, id: string): Promise<MealRecordModel | null> {
    // where 里带 userId：越权读别人的记录直接查不到（权限落在 SQL 条件里，不在 if 里）
    // items 固定按 id asc：update() 的份数按下标对齐，两边顺序必须一致
    const row = await this.prisma.mealRecord.findFirst({
      where: { id, userId },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    return row === null ? null : this.toModel(row);
  }

  async findByClientRequestId(userId: string, clientRequestId: string): Promise<MealRecordModel | null> {
    const row = await this.prisma.mealRecord.findFirst({
      where: { userId, clientRequestId },
      include: { items: true },
    });
    return row === null ? null : this.toModel(row);
  }

  async update(
    userId: string,
    id: string,
    input: UpdateMealInput,
    items: MealItemModel[],
  ): Promise<MealRecordModel> {
    const current = await this.prisma.mealRecord.findFirst({
      where: { id, userId },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (current === null) throw new Error(`餐记录不存在: ${id}`);

    // 份数按「明细的稳定顺序（id asc）」逐条更新，顺序与 service 传入的 items 一致
    const servingsOps = current.items
      .map((item, index) => {
        const next = items[index]?.servings;
        return next === undefined || next === item.servings
          ? null
          : this.prisma.mealItem.update({ where: { id: item.id }, data: { servings: next } });
      })
      .filter((op) => op !== null);

    const results = await this.prisma.$transaction([
      this.prisma.mealRecord.update({
        where: { id },
        data: {
          ...(input.mealType === undefined ? {} : { mealType: input.mealType }),
          ...(input.note === undefined ? {} : { note: input.note }),
        },
        include: { items: { orderBy: { id: 'asc' } } },
      }),
      ...servingsOps,
    ]);

    return this.toModel(results[0] as RowWithItems);
  }

  async remove(userId: string, id: string): Promise<void> {
    // deleteMany + userId 条件：删不掉别人的记录，也不因「不存在」抛 500
    await this.prisma.mealRecord.deleteMany({ where: { id, userId } });
  }

  private toModel(row: RowWithItems): MealRecordModel {
    const items: MealItemModel[] = row.items.map((item) => ({
      dishId: item.dishId,
      dishName: item.dishName,
      category: item.category,
      servings: item.servings,
      caloriesKcal: item.caloriesKcal,
      proteinG: item.proteinG,
      fatG: item.fatG,
      carbG: item.carbG,
      fiberG: item.fiberG,
      sodiumMg: item.sodiumMg,
    }));
    return {
      id: row.id,
      userId: row.userId,
      mealType: row.mealType,
      source: row.source,
      eatenAt: row.eatenAt,
      note: row.note,
      clientRequestId: row.clientRequestId,
      createdAt: row.createdAt,
      items,
      totals: sumItems(items as MealItemLike[]),
    };
  }
}
