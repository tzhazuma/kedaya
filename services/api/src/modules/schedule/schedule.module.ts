/**
 * 课表 · schedule（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TechpieModule } from '../techpie/techpie.module';
import { CampusBindingGuard } from '../techpie/data/campus-binding.guard';
import { ScheduleController } from './schedule.controller';
import { ScheduleCourseService } from './schedule.service';
import { ScheduleCoursePrismaRepository } from './data/schedule.repository';
import { SCHEDULE_COURSE_REPOSITORY } from './domain/schedule.domain';

/**
 * 课表 · schedule（契约 §4）
 *
 * 依赖 AuthModule 的**第二级**能力（`CAMPUS_DATA_PORT` 去教务系统取数）
 * —— 课表数据的所有权是教务系统的，本地表只是缓存。
 *
 * ⚠️ **同时 import `TechpieModule`**：绑定守卫（不变式 I4）的实现与绑定表
 * 都在 techpie 侧（§11.20 收敛后两套 port/枚举合成了一套）。
 */
@Module({
  imports: [AuthModule, TechpieModule],
  controllers: [ScheduleController],
  providers: [
    /*
     * 守卫在本模块**显式 provide**（它按 techpie 的端口类型注入 techpie 的
     * `CAMPUS_SESSION_PORT`）。
     *
     * ⚠️ 这里曾经放过一个陷阱：守卫如果按 **auth 的**同名符号注入，
     * 而本模块又 import 了 AuthModule，就会解析到 auth 侧那份**没有
     * `getBinding()`** 的会话适配器 —— 「已登录但未绑定」于是不是 409
     * 而是 HTTP 500 TypeError（合并后 `test/techpie-http.spec.ts` 的 P0-4
     * 抓到的形态）。守卫现在只认 techpie 的符号（§11.20 收敛后的唯一绑定实现），
     * 由 `TechpieModule` 导出，任何用到它的模块都必须 import `TechpieModule`。
     */
    CampusBindingGuard,
    ScheduleCourseService,
    { provide: SCHEDULE_COURSE_REPOSITORY, useClass: ScheduleCoursePrismaRepository },
  ],
  exports: [ScheduleCourseService],
})
export class ScheduleModule {}
