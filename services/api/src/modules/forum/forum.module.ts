/**
 * 论坛 · forum（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { ForumController } from './forum.controller';
import { ForumPostService } from './forum.service';
import { ForumPostPrismaRepository } from './data/forum.repository';
import { FORUM_POST_REPOSITORY } from './domain/forum.domain';

@Module({
  controllers: [ForumController],
  providers: [ForumPostService, { provide: FORUM_POST_REPOSITORY, useClass: ForumPostPrismaRepository }],
  exports: [ForumPostService],
})
export class ForumModule {}
