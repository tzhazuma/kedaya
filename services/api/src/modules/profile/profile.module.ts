/**
 * 我的 · profile（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileSettingService } from './profile.service';
import { ProfileSettingPrismaRepository } from './data/profile.repository';
import { PROFILE_SETTING_REPOSITORY } from './domain/profile.domain';

@Module({
  controllers: [ProfileController],
  providers: [ProfileSettingService, { provide: PROFILE_SETTING_REPOSITORY, useClass: ProfileSettingPrismaRepository }],
  exports: [ProfileSettingService],
})
export class ProfileModule {}
