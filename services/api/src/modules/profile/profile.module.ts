/**
 * 我的 · profile（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileSettingService } from './profile.service';
import { ProfileExportPrismaRepository } from './data/profile-export.prisma-repository';
import { ProfileSettingPrismaRepository } from './data/profile.repository';
import { PROFILE_SETTING_REPOSITORY } from './domain/profile.domain';
import { PROFILE_EXPORT_PORT } from './domain/profile-export.domain';

@Module({
  controllers: [ProfileController],
  providers: [
    ProfileSettingService,
    { provide: PROFILE_SETTING_REPOSITORY, useClass: ProfileSettingPrismaRepository },
    // 数据导出的只读投影端口（跨模块计数在 data 层完成，用例层不碰 Prisma）
    { provide: PROFILE_EXPORT_PORT, useClass: ProfileExportPrismaRepository },
  ],
  exports: [ProfileSettingService],
})
export class ProfileModule {}
