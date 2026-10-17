/**
 * 校园卡 · 模块装配（契约 §11.21-B）
 *
 * ⚠️ **本模块已移出 `scripts/scaffold.mjs` 的 SPEC 表**（2026-10-17）——
 * 它现在是手写实现（五条端点 + 第二级绑定门）。留在 SPEC 表里意味着
 * 下一次 `npm run scaffold` 会把它覆盖回通用 CRUD 形状
 * （`items` + `summary`，而 `summary` 是汇总不是余额）。
 * 这条不变式由 `test/campus-card-http.spec.ts` 的架构断言钉死。
 *
 * 依赖 `TechpieModule` 以拿到 `CAMPUS_SESSION_PORT`（第二级能力层）——
 * 校园卡走独立的 **OPENID 通道**，与 CASTGC 完全解耦（规格 §2.5）。
 */
import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { TechpieModule } from '../techpie/techpie.module';
import { CampusCardController } from './campus-card.controller';
import { CampusCardService } from './campus-card.service';
import { CampusCardTransactionPrismaRepository } from './data/campus-card.repository';
import { CAMPUS_CARD_TRANSACTION_REPOSITORY } from './domain/campus-card.domain';

@Module({
  imports: [IdempotencyModule, TechpieModule],
  controllers: [CampusCardController],
  providers: [
    CampusCardService,
    { provide: CAMPUS_CARD_TRANSACTION_REPOSITORY, useClass: CampusCardTransactionPrismaRepository },
  ],
  exports: [CampusCardService, CAMPUS_CARD_TRANSACTION_REPOSITORY],
})
export class CampusCardModule {}
