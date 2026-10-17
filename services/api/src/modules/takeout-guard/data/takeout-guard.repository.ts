import { Inject, Injectable } from '@nestjs/common';
import type { TakeoutReport } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import type { ListParams } from '../../../common/crud/resource';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  TAKEOUT_REPORT_STATUSES,
  type TakeoutReportCreateRecord,
  type TakeoutReportModel,
  type TakeoutReportRepository,
  type TakeoutReportStatus,
  type UpdateTakeoutReportInput,
} from '../domain/takeout-guard.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 *
 * 输入字段名与 Prisma 字段一一对应，因此复用基类的恒等映射；本模块只覆写两处：
 *   · `buildWhere` —— 列表的筛选**只有** `reporterId`（服务层强制填当前主体）与 `status`
 *     精确匹配。这里逐字段显式列出，绝不把 `filters` 直接透传给 Prisma：
 *     它的 key 来自外部输入，`{ [k]: v }` 会变成任意字段查询。
 *   · `buildOrderBy` —— 新记录在前（`createdAt desc` + `id desc` 兜底）。
 *
 * `applyStatus` 单独开一个方法（而不是走通用 `update`）：状态跃迁是领域动作，
 * 不能让任何 `PATCH` 都能写 `status`，否则服务层的状态白名单形同虚设。
 */
@Injectable()
export class TakeoutReportPrismaRepository
  extends PrismaCursorRepository<
    TakeoutReport,
    TakeoutReportModel,
    TakeoutReportCreateRecord,
    UpdateTakeoutReportInput
  >
  implements TakeoutReportRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.takeoutReport);
  }

  protected override buildWhere(
    filters?: ListParams['filters'],
  ): Record<string, unknown> | undefined {
    if (filters === undefined) return undefined;

    const where: Record<string, unknown> = {};

    // 归属：只接受非空字符串（服务层保证它就是当前登录主体）
    const reporterId = filters.reporterId;
    if (typeof reporterId === 'string' && reporterId !== '') where.reporterId = reporterId;

    // 状态：再过一次白名单，防止有人绕过 controller 的 Zod 直接调仓储
    const status = filters.status;
    if (typeof status === 'string' && (TAKEOUT_REPORT_STATUSES as readonly string[]).includes(status)) {
      where.status = status;
    }

    return Object.keys(where).length === 0 ? undefined : where;
  }

  /**
   * 新记录在前。`id desc` 是**必需**的第二排序键：
   * 游标分页要求全序，同一毫秒落库的两行只按 `createdAt` 排会漏读 / 重读。
   */
  protected override buildOrderBy(): Record<string, unknown>[] {
    return [{ createdAt: 'desc' }, { id: 'desc' }];
  }

  async applyStatus(id: string, status: TakeoutReportStatus): Promise<TakeoutReportModel> {
    const row = await this.prisma.takeoutReport.update({ where: { id }, data: { status } });
    return this.toModel(row);
  }
}
