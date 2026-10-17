/**
 * 跑腿 · errand（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { NotificationModule } from '../notifications/notifications.module';
import { ErrandController } from './errand.controller';
import { ErrandTaskService } from './errand.service';
import { ErrandTaskPrismaRepository } from './data/errand.repository';
import { ERRAND_TASK_REPOSITORY } from './domain/errand.domain';

@Module({
  // 引入通知模块，让 `NOTIFICATION_PORT` 能被解析（接单/送达/完成会写站内信）
  imports: [NotificationModule],
  controllers: [ErrandController],
  providers: [ErrandTaskService, { provide: ERRAND_TASK_REPOSITORY, useClass: ErrandTaskPrismaRepository }],
  exports: [ErrandTaskService],
})
export class ErrandModule {}
