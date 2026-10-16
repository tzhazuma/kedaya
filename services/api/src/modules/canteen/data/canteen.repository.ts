/**
 * 食堂营养 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CanteenDish } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateCanteenDishInput,
  CanteenDishModel,
  CanteenDishRepository,
  UpdateCanteenDishInput,
} from '../domain/canteen.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 输入字段名与 Prisma 字段一一对应，因此直接复用基类的恒等映射。
 */
@Injectable()
export class CanteenDishPrismaRepository
  extends PrismaCursorRepository<CanteenDish, CanteenDishModel, CreateCanteenDishInput, UpdateCanteenDishInput>
  implements CanteenDishRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.canteenDish);
  }

  /** 按食堂汇总热量 / 均价（真实聚合查询） */
  async summarizeByCanteen(canteen: string): Promise<{ dishes: number; totalCaloriesKcal: number; avgPriceFen: number }> {
    const result = await this.prisma.canteenDish.aggregate({
      where: { canteen },
      _count: { _all: true },
      _sum: { caloriesKcal: true, priceFen: true },
    });
    const dishes = result._count._all;
    const totalPriceFen = result._sum.priceFen ?? 0;
    return {
      dishes,
      totalCaloriesKcal: result._sum.caloriesKcal ?? 0,
      avgPriceFen: dishes === 0 ? 0 : Math.round(totalPriceFen / dishes),
    };
  }}
