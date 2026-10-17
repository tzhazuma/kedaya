/**
 * 失物招领 · lost-found（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { LostFoundController } from './lost-found.controller';
import { LostFoundItemService } from './lost-found.service';
import { LostFoundItemPrismaRepository } from './data/lost-found.repository';
import { LOST_FOUND_ITEM_REPOSITORY } from './domain/lost-found.domain';

@Module({
  controllers: [LostFoundController],
  providers: [LostFoundItemService, { provide: LOST_FOUND_ITEM_REPOSITORY, useClass: LostFoundItemPrismaRepository }],
  exports: [LostFoundItemService],
})
export class LostFoundModule {}
