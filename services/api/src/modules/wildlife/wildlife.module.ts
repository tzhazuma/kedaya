/**
 * 野生居民档案 · wildlife。已实现自定义地图观察/身份业务，勿用通用 CRUD 脚手架覆盖。
 */
import { Module } from '@nestjs/common';
import { WildlifeArchiveController } from './archive.controller';
import { WildlifeArchiveService } from './archive.service';
import { WildlifeSpotService } from './wildlife.service';
import { WildlifeSpotPrismaRepository } from './data/wildlife.repository';
import { WILDLIFE_SPOT_REPOSITORY } from './domain/wildlife.domain';

@Module({
  controllers: [WildlifeArchiveController],
  providers: [WildlifeArchiveService, WildlifeSpotService, { provide: WILDLIFE_SPOT_REPOSITORY, useClass: WildlifeSpotPrismaRepository }],
  exports: [WildlifeSpotService],
})
export class WildlifeModule {}
