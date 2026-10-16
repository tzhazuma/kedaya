/**
 * 猫鸟黑天鹅 · wildlife（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { WildlifeController } from './wildlife.controller';
import { WildlifeSpotService } from './wildlife.service';
import { WildlifeSpotPrismaRepository } from './data/wildlife.repository';
import { WILDLIFE_SPOT_REPOSITORY } from './domain/wildlife.domain';

@Module({
  controllers: [WildlifeController],
  providers: [WildlifeSpotService, { provide: WILDLIFE_SPOT_REPOSITORY, useClass: WildlifeSpotPrismaRepository }],
  exports: [WildlifeSpotService],
})
export class WildlifeModule {}
