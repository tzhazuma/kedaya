/**
 * 拼单 · groupbuy（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { GroupbuyController } from './groupbuy.controller';
import { GroupbuyOrderService } from './groupbuy.service';
import { GroupbuyOrderPrismaRepository } from './data/groupbuy.repository';
import { GROUPBUY_ORDER_REPOSITORY } from './domain/groupbuy.domain';

@Module({
  controllers: [GroupbuyController],
  providers: [GroupbuyOrderService, { provide: GROUPBUY_ORDER_REPOSITORY, useClass: GroupbuyOrderPrismaRepository }],
  exports: [GroupbuyOrderService],
})
export class GroupbuyModule {}
