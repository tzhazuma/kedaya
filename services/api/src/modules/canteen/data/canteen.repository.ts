/**
 * 营养管家 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { CanteenDish } from '@prisma/client';
import type { Page } from '@kedaya/contracts';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import type { ListParams } from '../../../common/crud/resource';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateCanteenDishInput,
  CanteenDishModel,
  CanteenDishRepository,
  UpdateCanteenDishInput,
} from '../domain/canteen.domain';

type Row = CanteenDish & { deletedAt?: Date | null };

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 输入字段名与 Prisma 字段一一对应，因此直接复用基类的恒等映射。
 *
 * 与脚手架的默认实现（无筛选 + `id asc`）不同，这里自己翻 `where` / `orderBy`：
 *   · 列表要支持「按食堂筛」与「按菜名搜」——这是"真实可用"的底线；
 *   · 排序固定为**最新在前**（`createdAt desc`），并带 `id desc` 兜底。
 *
 * **软删除**：`remove()` 只写 `deletedAt`，不 DELETE。
 * 菜品是营养记录的历史依据，硬删会让 `MealItem.dishId` 变 NULL、
 * 历史无法回溯（ADR 0006 §3.1）。因此列表 / 详情 / 检索 / 推荐都要过滤。
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
   * （那会变成任意字段查询）。因此这里显式列出本模块允许的三个字段：
   *   · `canteen`  —— 食堂精确匹配（用 `equals` 语义即可，直接给标量）；
   *   · `q`        —— 菜名 `contains`，`mode: 'insensitive'` 让英文大小写不敏感；
   *   · `category` —— 菜的种类精确匹配。
   * 未知 key 与空白值一律忽略。
   *
   * 已下架（`deletedAt` 非 null）的菜品**永远不出现**在列表/检索结果里，
   * 因此这里无条件带上 `deletedAt: null`。
   */
  protected override buildWhere(filters?: ListParams['filters']): Record<string, unknown> {
    const where: Record<string, unknown> = { deletedAt: null };

    if (typeof filters?.canteen === 'string' && filters.canteen.length > 0) {
      where.canteen = filters.canteen;
    }

    if (typeof filters?.q === 'string' && filters.q.trim().length > 0) {
      where.name = { contains: filters.q.trim(), mode: 'insensitive' };
    }

    if (typeof filters?.category === 'string' && filters.category.length > 0) {
      where.category = filters.category;
    }

    return where;
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

  /** 详情：已下架的一律当「不存在」 */
  override async findById(id: string): Promise<CanteenDishModel | null> {
    const row = await this.prisma.canteenDish.findFirst({ where: { id, deletedAt: null } });
    return row === null ? null : this.toModel(row);
  }

  /** 下架（软删除）：保留历史关联 */
  override async remove(id: string): Promise<void> {
    await this.prisma.canteenDish.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** 按食堂汇总热量 / 均价（真实聚合查询，只算未下架） */
  async summarizeByCanteen(canteen: string): Promise<{ dishes: number; totalCaloriesKcal: number; avgPriceFen: number }> {
    const result = await this.prisma.canteenDish.aggregate({
      where: { canteen, deletedAt: null },
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
  }

  /** 菜品检索：名称模糊（大小写不敏感）+ 品类/食堂过滤 + 游标分页 */
  async searchDishes(query: {
    q?: string;
    category?: string;
    canteen?: string;
    cursor?: string;
    limit: number;
  }): Promise<Page<CanteenDishModel>> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };
    if (query.category) where.category = query.category;
    if (query.canteen) where.canteen = query.canteen;
    const after = decodeCursor(query.cursor);
    const rows = await this.prisma.canteenDish.findMany({
      where,
      take: query.limit + 1,
      orderBy: { id: 'asc' },
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;
    const last = visible.at(-1);
    return {
      items: visible.map((row) => this.toModel(row)),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }

  /** 按菜名精确取一道菜（未下架）。同名菜有多份时取最近维护的一份 */
  async findByExactName(name: string): Promise<CanteenDishModel | null> {
    const row = await this.prisma.canteenDish.findFirst({
      where: { name, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    return row === null ? null : this.toModel(row);
  }

  /** 推荐候选池：未下架 + 最近维护优先（避免「只推荐最早录入的 100 道」） */
  async listForRecommendation(limit: number): Promise<CanteenDishModel[]> {
    const rows = await this.prisma.canteenDish.findMany({
      where: { deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((row) => this.toModel(row));
  }

  /** 未下架菜品总数（菜品覆盖率的分母） */
  async countActive(): Promise<number> {
    return this.prisma.canteenDish.count({ where: { deletedAt: null } });
  }

  protected override toModel(row: Row): CanteenDishModel {
    return {
      id: row.id,
      canteen: row.canteen,
      name: row.name,
      category: row.category,
      servingG: row.servingG,
      caloriesKcal: row.caloriesKcal,
      proteinG: row.proteinG,
      fatG: row.fatG,
      carbG: row.carbG,
      fiberG: row.fiberG,
      sodiumMg: row.sodiumMg,
      priceFen: row.priceFen,
      source: row.source ?? null,
      lastVerifiedAt: row.lastVerifiedAt ?? null,
      allergens: row.allergens ?? [],
      deletedAt: row.deletedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
