/**
 * 常见问题 · faq（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { FaqEntry } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import type { ListParams } from '../../../common/crud/resource';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateFaqEntryInput,
  FaqEntryModel,
  FaqEntryRepository,
  UpdateFaqEntryInput,
} from '../domain/faq.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 输入字段名与 Prisma 字段一一对应，因此直接复用基类的恒等映射。
 */
@Injectable()
export class FaqEntryPrismaRepository
  extends PrismaCursorRepository<FaqEntry, FaqEntryModel, CreateFaqEntryInput, UpdateFaqEntryInput>
  implements FaqEntryRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.faqEntry);
  }

  /**
   * 筛选 → Prisma `where`。
   *
   * **必须显式列字段**：`filters` 的值虽然已由 controller 的 Zod 收敛成标量，
   * 但它的 **key 来自外部输入**。写成 `where = { ...filters }` 的那一刻，
   * `?helpfulCount=0` 之类的参数就变成了任意字段查询条件（甚至能探测字段是否存在）。
   * 所以这里逐字段读取 + 类型守卫，白名单之外的一律忽略。
   */
  protected override buildWhere(
    filters?: ListParams['filters'],
  ): Record<string, unknown> | undefined {
    if (!filters) return undefined;

    const where: Record<string, unknown> = {};

    // 分类：精确匹配（数据库侧有 category 索引；不做 contains，否则索引失效）
    const category = filters.category;
    if (typeof category === 'string' && category !== '') {
      where.category = category;
    }

    // 关键词：question 或 answer 命中即可 —— 用户记得的往往不是问题原话
    const keyword = filters.q;
    if (typeof keyword === 'string' && keyword !== '') {
      where.OR = [
        { question: { contains: keyword, mode: 'insensitive' } },
        { answer: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    // 没有任何条件时返回 undefined：让基类**完全不带** where，而不是 `where: {}`
    return Object.keys(where).length === 0 ? undefined : where;
  }

  /**
   * 最新在前。`id` 是必需的**第二排序键**：
   * 只按 `createdAt` 排序时，同一毫秒落库的两行在游标（`cursor + skip 1`）下
   * 可能被跳过或被读两次 —— 全序稳定才谈得上不漏读。
   * 与排序方向保持一致（都 desc），游标才能一路往前走。
   */
  protected override buildOrderBy(): Record<string, 'asc' | 'desc'>[] {
    return [{ createdAt: 'desc' }, { id: 'desc' }];
  }

  /** 原子自增：并发下不会丢计数（刻意**不**做一人一票去重，见 controller） */
  async markHelpful(id: string): Promise<FaqEntryModel> {
    return this.prisma.faqEntry.update({
      where: { id },
      data: { helpfulCount: { increment: 1 } },
    });
  }
}
