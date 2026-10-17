/**
 * 找搭子 · buddy（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { BuddyController } from './buddy.controller';
import { BuddyGroupService } from './buddy.service';
import { BuddyGroupPrismaRepository } from './data/buddy.repository';
import { BUDDY_GROUP_REPOSITORY } from './domain/buddy.domain';

@Module({
  controllers: [BuddyController],
  providers: [BuddyGroupService, { provide: BUDDY_GROUP_REPOSITORY, useClass: BuddyGroupPrismaRepository }],
  exports: [BuddyGroupService],
})
export class BuddyModule {}
