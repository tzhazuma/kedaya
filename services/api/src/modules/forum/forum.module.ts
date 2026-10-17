/**
 * 论坛 · forum（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { NotificationModule } from '../notifications/notifications.module';
import { ForumController } from './forum.controller';
import { ForumPostService } from './forum.service';
import { ForumPostPrismaRepository } from './data/forum.repository';
import { FORUM_POST_REPOSITORY } from './domain/forum.domain';

@Module({
  // 引入通知模块，让 `NOTIFICATION_PORT` 能被解析（回复会通知楼主）
  imports: [NotificationModule],
  controllers: [ForumController],
  providers: [ForumPostService, { provide: FORUM_POST_REPOSITORY, useClass: ForumPostPrismaRepository }],
  exports: [ForumPostService],
})
export class ForumModule {}
