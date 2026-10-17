/**
 * TechPie 整合 · techpie（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { TechpieController } from './techpie.controller';
import { TechpieLinkService } from './techpie.service';
import { TechpieLinkPrismaRepository } from './data/techpie.repository';
import { TECHPIE_LINK_REPOSITORY } from './domain/techpie.domain';

@Module({
  controllers: [TechpieController],
  providers: [TechpieLinkService, { provide: TECHPIE_LINK_REPOSITORY, useClass: TechpieLinkPrismaRepository }],
  exports: [TechpieLinkService],
})
export class TechpieModule {}
