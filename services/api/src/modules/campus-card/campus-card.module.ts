/**
 * 校园卡 · campus-card（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CampusCardController } from './campus-card.controller';
import { CampusCardTransactionService } from './campus-card.service';
import { CampusCardTransactionPrismaRepository } from './data/campus-card.repository';
import { CAMPUS_CARD_TRANSACTION_REPOSITORY } from './domain/campus-card.domain';

@Module({
  imports: [AuthModule],
  controllers: [CampusCardController],
  providers: [CampusCardTransactionService, { provide: CAMPUS_CARD_TRANSACTION_REPOSITORY, useClass: CampusCardTransactionPrismaRepository }],
  exports: [CampusCardTransactionService],
})
export class CampusCardModule {}
