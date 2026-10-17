/**
 * 跳蚤 · flea-market（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { NotificationModule } from '../notifications/notifications.module';
import { FleaMarketController } from './flea-market.controller';
import { FleaItemService } from './flea-market.service';
import { FleaItemPrismaRepository } from './data/flea-market.repository';
import { FLEA_ITEM_REPOSITORY } from './domain/flea-market.domain';

@Module({
  // 引入通知模块，让 `NOTIFICATION_PORT` 能被解析（预定/解除预定会写站内信）
  imports: [NotificationModule],
  controllers: [FleaMarketController],
  providers: [FleaItemService, { provide: FLEA_ITEM_REPOSITORY, useClass: FleaItemPrismaRepository }],
  exports: [FleaItemService],
})
export class FleaMarketModule {}
