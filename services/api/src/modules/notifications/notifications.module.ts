/**
 * 通知 · notifications（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { NotificationController } from './notifications.controller';
import { NotificationService } from './notifications.service';
import { NotificationPrismaRepository } from './data/notifications.repository';
import { NOTIFICATION_REPOSITORY } from './domain/notifications.domain';

@Module({
  controllers: [NotificationController],
  providers: [NotificationService, { provide: NOTIFICATION_REPOSITORY, useClass: NotificationPrismaRepository }],
  exports: [NotificationService],
})
export class NotificationModule {}
