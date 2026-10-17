/**
 * 课表 · schedule（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScheduleController } from './schedule.controller';
import { ScheduleCourseService } from './schedule.service';
import { CampusBindingGuard } from '../techpie/data/campus-binding.guard';
import { ScheduleCoursePrismaRepository } from './data/schedule.repository';
import { SCHEDULE_COURSE_REPOSITORY } from './domain/schedule.domain';

/**
 * 课表 · schedule（契约 §4）
 *
 * 依赖 AuthModule 的**第二级**能力（`CAMPUS_SESSION_PORT` 取 session、
 * `CAMPUS_DATA_PORT` 去教务系统取数）—— 课表数据的所有权是教务系统的，
 * 本地表只是缓存。因此本模块不 import Prisma 之外的任何上游细节。
 */
@Module({
  imports: [AuthModule],
  controllers: [ScheduleController],
  providers: [CampusBindingGuard, ScheduleCourseService, { provide: SCHEDULE_COURSE_REPOSITORY, useClass: ScheduleCoursePrismaRepository }],
  exports: [ScheduleCourseService],
})
export class ScheduleModule {}
