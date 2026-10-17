import { Inject, Injectable } from '@nestjs/common';
import type { WellbeingAppointment } from '@prisma/client';
import type { Page } from '@kedaya/contracts';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import type { ListParams } from '../../../common/crud/resource';
import { InternalError } from '../../../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  WELLBEING_STATUSES,
  type UpdateWellbeingAppointmentInput,
  type WellbeingAppointmentCreateRecord,
  type WellbeingAppointmentModel,
  type WellbeingAppointmentRepository,
  type WellbeingStatus,
} from '../domain/wellbeing.domain';

/**
 * data 层 · 访问域 wellbeing（契约 §9：独立权限域 + 审计）。
 *
 * 这个仓储唯一的用法是 `listByUser` —— 基类的 `list()` 会列出全表，
 * 对心理预约数据来说这是一次不可接受的数据泄漏，所以这里把它**覆写成抛错**：
 * 与其指望后来者记得别调用，不如让误用直接失败。
 *
 * 另外覆写两处（见基类注释）：
 *   · `buildWhere` —— 显式字段白名单，只有 `status`（服务层塞进来的）。
 *     绝不把 `filters` 原样透传给 Prisma：它的 key 来自外部输入。
 *   · `buildOrderBy` —— 预约时间"最近的在前"。
 */
@Injectable()
export class WellbeingAppointmentPrismaRepository
  extends PrismaCursorRepository<
    WellbeingAppointment,
    WellbeingAppointmentModel,
    WellbeingAppointmentCreateRecord,
    UpdateWellbeingAppointmentInput
  >
  implements WellbeingAppointmentRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.wellbeingAppointment);
  }

  /**
   * ⛔ 本模块**不存在**"列出全部预约"这个操作。
   *
   * 覆写成抛错而不是保持基类行为：这是最敏感的一张表，
   * 一次误调用就等于把全校的心理预约记录读出来。
   */
  override async list(): Promise<Page<WellbeingAppointmentModel>> {
    throw new InternalError('心理预约不允许跨用户列出，请使用 listByUser(userId, params)');
  }

  protected override buildWhere(
    filters?: ListParams['filters'],
  ): Record<string, unknown> | undefined {
    if (filters === undefined) return undefined;

    const where: Record<string, unknown> = {};

    // 状态：再过一次白名单，防止有人绕过 controller / service 直接调仓储
    const status = filters.status;
    if (typeof status === 'string' && (WELLBEING_STATUSES as readonly string[]).includes(status)) {
      where.status = status;
    }

    return Object.keys(where).length === 0 ? undefined : where;
  }

  /**
   * 预约时间新 → 旧。
   *
   * 为什么不是 `createdAt desc`：这一页回答的是"我接下来有哪些安排"，
   * 未来的预约必须排在已经过去的之前；`id desc` 是**必需**的第二排序键
   * （游标分页要求全序，同一时刻的两行只按一个键排会漏读 / 重读）。
   * 这个顺序也正好命中 schema 上的 `@@index([userId, slotAt])`。
   */
  protected override buildOrderBy(): Record<string, unknown>[] {
    return [{ slotAt: 'desc' }, { id: 'desc' }];
  }

  async listByUser(
    userId: string,
    { cursor, limit, filters }: ListParams,
  ): Promise<Page<WellbeingAppointmentModel>> {
    const id = decodeCursor(cursor);
    const rows = await this.prisma.wellbeingAppointment.findMany({
      // 归属是硬条件：`userId` 永远来自服务层注入的登录主体，不来自查询参数
      where: { userId, ...(this.buildWhere(filters) ?? {}) },
      orderBy: this.buildOrderBy(),
      take: limit + 1,
      ...(id ? { cursor: { id }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;
    const last = visible.at(-1);

    return {
      items: visible,
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  }

  /** 领域动作：状态跃迁（服务层已校验白名单与状态机） */
  async applyStatus(id: string, status: WellbeingStatus): Promise<WellbeingAppointmentModel> {
    const row = await this.prisma.wellbeingAppointment.update({ where: { id }, data: { status } });
    return row;
  }

  /** 领域动作：只打危机标记，不动状态（见 domain 的说明） */
  async markCrisis(id: string): Promise<WellbeingAppointmentModel> {
    const row = await this.prisma.wellbeingAppointment.update({
      where: { id },
      data: { crisisFlag: true },
    });
    return row;
  }
}
