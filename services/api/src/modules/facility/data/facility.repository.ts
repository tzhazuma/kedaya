/**
 * 场馆预约 · facility（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 14 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { FacilityBooking } from '@prisma/client';
import { PrismaCursorRepository } from '../../../common/crud/prisma-cursor.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  CreateFacilityBookingInput,
  FacilityBookingModel,
  FacilityBookingRepository,
  UpdateFacilityBookingInput,
} from '../domain/facility.domain';

/**
 * data 层：唯一允许碰 IO 的地方（契约 §7 依赖方向 domain ← data）。
 * 输入字段名与 Prisma 字段一一对应，因此直接复用基类的恒等映射。
 */
@Injectable()
export class FacilityBookingPrismaRepository
  extends PrismaCursorRepository<FacilityBooking, FacilityBookingModel, CreateFacilityBookingInput, UpdateFacilityBookingInput>
  implements FacilityBookingRepository
{
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super(prisma.facilityBooking);
  }

  /**
   * 时段冲突检测（同一场馆 + 同一时间段 + 未取消的预约）。
   * 半开区间 [startsAt, endsAt) 相交：existing.startsAt < new.endsAt && existing.endsAt > new.startsAt。
   */
  async findOverlapping(input: {
    kind: string;
    facilityName: string | null;
    startsAt: Date;
    endsAt: Date;
  }): Promise<FacilityBookingModel | null> {
    const row = await this.prisma.facilityBooking.findFirst({
      where: {
        kind: input.kind,
        status: 'booked',
        ...(input.facilityName ? { facilityName: input.facilityName } : {}),
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
      },
      orderBy: { startsAt: 'asc' },
    });
    return row ? (row as unknown as FacilityBookingModel) : null;
  }}
