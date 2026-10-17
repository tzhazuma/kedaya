import { Module } from '@nestjs/common';
import { DormHarmonyController } from './dorm-harmony.controller';
import { DormHarmonyService } from './dorm-harmony.service';
import { DormHarmonyCasePrismaRepository } from './data/dorm-harmony.repository';
import { DORM_HARMONY_CASE_REPOSITORY } from './domain/dorm-harmony.domain';

/** 宿舍矛盾模块（契约 §9：匿名 + 二次同意 + 审计 + 禁止进入画像） */
@Module({
  controllers: [DormHarmonyController],
  providers: [
    DormHarmonyService,
    { provide: DORM_HARMONY_CASE_REPOSITORY, useClass: DormHarmonyCasePrismaRepository },
  ],
  exports: [DormHarmonyService],
})
export class DormHarmonyModule {}
