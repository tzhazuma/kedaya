/**
 * 场馆预约 · facility（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 14 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { FacilityController } from './facility.controller';
import { FacilityBookingService } from './facility.service';
import { FacilityBookingPrismaRepository } from './data/facility.repository';
import { FACILITY_BOOKING_REPOSITORY } from './domain/facility.domain';

@Module({
  controllers: [FacilityController],
  providers: [FacilityBookingService, { provide: FACILITY_BOOKING_REPOSITORY, useClass: FacilityBookingPrismaRepository }],
  exports: [FacilityBookingService],
})
export class FacilityModule {}
