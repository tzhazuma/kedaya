/**
 * 食堂营养 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CanteenDish } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import type { ListParams } from '../../../common/crud/resource';
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
 *
 * 与脚手架的默认实现（无筛选 + `id asc`）不同，这里自己翻 `where` / `orderBy`：
 *   · 列表要支持「按食堂筛」与「按菜名搜」——这是"真实可用"的底线；
 *   · 排序固定为**最新在前**（`createdAt desc`），并带 `id desc` 兜底。
 */
@Injectable()
export class CanteenDishPrismaRepository
  extends PrismaCursorRepository<CanteenDish, CanteenDishModel, CreateCanteenDishInput, UpdateCanteenDishInput>
  implements CanteenDishRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.canteenDish);
  }

  /**
   * 筛选 → Prisma `where`。
   *
   * `filters` 的 key 来自外部 query，**绝不能**直接 `{ [k]: v }` 拼进 where
   * （那会变成任意字段查询）。因此这里显式列出本模块允许的两个字段：
   *   · `canteen` —— 食堂精确匹配（用 `equals` 语义即可，直接给标量）；
   *   · `q`       —— 菜名 `contains`，`mode: 'insensitive'` 让英文大小写不敏感。
   * 未知 key 与空白值一律忽略。
   */
  protected override buildWhere(filters?: ListParams['filters']): Record<string, unknown> | undefined {
    if (!filters) return undefined;

    const where: Record<string, unknown> = {};

    if (typeof filters.canteen === 'string' && filters.canteen.length > 0) {
      where.canteen = filters.canteen;
    }

    if (typeof filters.q === 'string' && filters.q.trim().length > 0) {
      where.name = { contains: filters.q.trim(), mode: 'insensitive' };
    }

    return Object.keys(where).length === 0 ? undefined : where;
  }

  /**
   * 排序：最新在前。
   *
   * 游标分页要求全序稳定 —— 只按 `createdAt` 排序时，同一毫秒落库的两行会
   * 漏读 / 重读，所以必须用 `id desc` 作为第二排序键兜底。
   */
  protected override buildOrderBy(
    _filters?: ListParams['filters'],
  ): Record<string, unknown>[] {
    return [{ createdAt: 'desc' }, { id: 'desc' }];
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
