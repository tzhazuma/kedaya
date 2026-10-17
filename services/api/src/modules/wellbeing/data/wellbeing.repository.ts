import { Inject, Injectable } from '@nestjs/common';
import type { WellbeingAppointment } from '@prisma/client';
import type { Page } from '@kedaya/contracts';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import type { ListParams } from '../../../common/crud/resource';
import { decodeCursor, encodeCursor } from '../../../common/pagination/cursor';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateWellbeingAppointmentInput,
  UpdateWellbeingAppointmentInput,
  WellbeingAppointmentModel,
  WellbeingAppointmentRepository,
} from '../domain/wellbeing.domain';

/**
 * data 层 · 访问域 wellbeing（契约 §9：独立权限域 + 审计）。
 *
 * 注意 `listByUser` 是**必须**的：基类的 `list()` 会列出全表，
 * 对心理预约数据来说是不可接受的数据泄漏，所以这里不暴露它。
 */
@Injectable()
export class WellbeingAppointmentPrismaRepository
  extends PrismaCursorRepository<
    WellbeingAppointment,
    WellbeingAppointmentModel,
    CreateWellbeingAppointmentInput,
    UpdateWellbeingAppointmentInput
  >
  implements WellbeingAppointmentRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.wellbeingAppointment);
  }

  async listByUser(userId: string, { cursor, limit }: ListParams): Promise<Page<WellbeingAppointmentModel>> {
    const id = decodeCursor(cursor);
    const rows = await this.prisma.wellbeingAppointment.findMany({
      where: { userId },
      orderBy: { id: 'asc' },
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
}
