/**
 * 课表 · schedule（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { TechpieModule } from '../techpie/techpie.module';
import { ScheduleController } from './schedule.controller';
import { ScheduleCourseService } from './schedule.service';
import { ScheduleCoursePrismaRepository } from './data/schedule.repository';
import { SCHEDULE_COURSE_REPOSITORY } from './domain/schedule.domain';

@Module({
  imports: [TechpieModule],
  controllers: [ScheduleController],
  providers: [ScheduleCourseService, { provide: SCHEDULE_COURSE_REPOSITORY, useClass: ScheduleCoursePrismaRepository }],
  exports: [ScheduleCourseService],
})
export class ScheduleModule {}
