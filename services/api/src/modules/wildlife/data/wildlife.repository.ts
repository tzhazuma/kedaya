/**
 * 猫鸟黑天鹅 · wildlife（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { WildlifeSpot } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import type { ListParams } from '../../../common/crud/resource';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateWildlifeSpotInput,
  WildlifeSpotModel,
  WildlifeSpotRepository,
  UpdateWildlifeSpotInput,
} from '../domain/wildlife.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 输入字段名与 Prisma 字段一一对应，因此直接复用基类的恒等映射。
 */
@Injectable()
export class WildlifeSpotPrismaRepository
  extends PrismaCursorRepository<WildlifeSpot, WildlifeSpotModel, CreateWildlifeSpotInput, UpdateWildlifeSpotInput>
  implements WildlifeSpotRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.wildlifeSpot);
  }

  /**
   * 筛选 → Prisma `where`。
   *
   * **显式列字段白名单**，不做 `{ [key]: value }` 展开：`filters` 的 key 来自外部
   * query，铺开就等于开放了任意字段查询（`?reportedBy=某人` 会变成"谁上报过"的
   * 检索能力），而它本来只是一个"找动物"的筛选。
   *
   * 物种名在数据里是中英混杂的（「白鹭」/「Little Egret」），因此用
   * `contains` + `mode: 'insensitive'` 而不是精确匹配 —— 否则用户必须把物种名
   * 一字不差地背下来才能筛，等于没有这个功能。
   */
  protected override buildWhere(
    filters?: ListParams['filters'],
  ): Record<string, unknown> | undefined {
    if (!filters) return undefined;

    const where: Record<string, unknown> = {};

    const species = filters.species;
    if (typeof species === 'string' && species.trim() !== '') {
      where.species = { contains: species.trim(), mode: 'insensitive' };
    }

    // 没有命中任何白名单条件时返回 undefined：让 findMany 完全不出现 where 键，
    // 与「显式传空对象」区分开（后者会让人怀疑是不是漏加了条件）。
    return Object.keys(where).length > 0 ? where : undefined;
  }

  /**
   * 排序：最新上报在前。
   *
   * 必须带 `id` 兜底。游标分页要求排序键构成**全序**：只用 `createdAt` 时，
   * 同一毫秒落库的两行（种子批量写入、同一次导入都很容易发生）在翻页时会
   * 被跳过或重复 —— 这是"看起来偶尔少了一条"的经典来源。
   */
  protected override buildOrderBy(
    _filters?: ListParams['filters'],
  ): Record<string, unknown>[] {
    return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}
