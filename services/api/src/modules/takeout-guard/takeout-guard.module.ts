/**
 * 偷外卖 · takeout-guard（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { TakeoutGuardController } from './takeout-guard.controller';
import { TakeoutReportService } from './takeout-guard.service';
import { TakeoutReportPrismaRepository } from './data/takeout-guard.repository';
import { TAKEOUT_REPORT_REPOSITORY } from './domain/takeout-guard.domain';

@Module({
  controllers: [TakeoutGuardController],
  providers: [TakeoutReportService, { provide: TAKEOUT_REPORT_REPOSITORY, useClass: TakeoutReportPrismaRepository }],
  exports: [TakeoutReportService],
})
export class TakeoutGuardModule {}
