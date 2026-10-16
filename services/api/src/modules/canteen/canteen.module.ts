/**
 * 食堂营养 · canteen（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { CanteenController } from './canteen.controller';
import { CanteenDishService } from './canteen.service';
import { CanteenDishPrismaRepository } from './data/canteen.repository';
import { CANTEEN_DISH_REPOSITORY } from './domain/canteen.domain';

@Module({
  controllers: [CanteenController],
  providers: [CanteenDishService, { provide: CANTEEN_DISH_REPOSITORY, useClass: CanteenDishPrismaRepository }],
  exports: [CanteenDishService],
})
export class CanteenModule {}
