/**
 * 常见问题 · faq（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { FaqController } from './faq.controller';
import { FaqEntryService } from './faq.service';
import { FaqEntryPrismaRepository } from './data/faq.repository';
import { FAQ_ENTRY_REPOSITORY } from './domain/faq.domain';

@Module({
  controllers: [FaqController],
  providers: [FaqEntryService, { provide: FAQ_ENTRY_REPOSITORY, useClass: FaqEntryPrismaRepository }],
  exports: [FaqEntryService],
})
export class FaqModule {}
