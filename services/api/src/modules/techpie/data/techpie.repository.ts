/**
 * TechPie 整合 · techpie（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { TechpieLink } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import type { ListParams } from '../../../common/crud/resource';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateTechpieLinkInput,
  TechpieLinkModel,
  TechpieLinkRepository,
  UpdateTechpieLinkInput,
} from '../domain/techpie.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 输入字段名与 Prisma 字段一一对应，因此直接复用基类的恒等映射。
 *
 * 与脚手架的默认实现（无筛选 + `id asc`）不同，这里自己翻 `where` / `orderBy`：
 *   · 列表要支持「按分类筛」与「按关键词搜」——这是它作为服务目录能被用的下限；
 *   · 排序固定为**最新在前**（`createdAt desc`），并带 `id desc` 兜底。
 */
@Injectable()
export class TechpieLinkPrismaRepository
  extends PrismaCursorRepository<TechpieLink, TechpieLinkModel, CreateTechpieLinkInput, UpdateTechpieLinkInput>
  implements TechpieLinkRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.techpieLink);
  }

  /**
   * 筛选 → Prisma `where`。
   *
   * `filters` 的 key 来自外部 query，**绝不能**直接 `{ [k]: v }` 拼进 where
   * （那会变成任意字段查询）。因此这里显式列出本模块允许的两个字段：
   *   · `category` —— 分类精确匹配（用 `equals` 语义即可，直接给标量）；
   *   · `q`        —— 关键词，`name` 或 `url` 的 `contains`，`mode: 'insensitive'`
   *                   让英文大小写不敏感（`VPN` / `vpn` 都要搜得到）。
   * 未知 key 与空白值一律忽略。
   *
   * 为什么 `q` 搜 `url` 而不搜「说明」：`TechpieLink` 表里没有说明列
   * （见 `domain/techpie.domain.ts` 文件头）。宁可搜一个真实存在的列，
   * 也不假装有一个说明字段。
   */
  protected override buildWhere(filters?: ListParams['filters']): Record<string, unknown> | undefined {
    if (!filters) return undefined;

    const where: Record<string, unknown> = {};

    if (typeof filters.category === 'string' && filters.category.length > 0) {
      where.category = filters.category;
    }

    if (typeof filters.q === 'string' && filters.q.trim().length > 0) {
      const keyword = filters.q.trim();
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { url: { contains: keyword, mode: 'insensitive' } },
      ];
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
}
