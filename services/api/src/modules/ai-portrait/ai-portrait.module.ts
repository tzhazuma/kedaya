import { Module } from '@nestjs/common';
import { AiPortraitController } from './ai-portrait.controller';
import { AiPortraitService } from './ai-portrait.service';
import { AiPortraitProfilePrismaRepository } from './data/ai-portrait.repository';
import { AI_PORTRAIT_PROFILE_REPOSITORY } from './domain/ai-portrait.domain';

/** AI 画像模块（契约 §9：独立权限域 + 审计 + 可关闭 + 数据最小化） */
@Module({
  controllers: [AiPortraitController],
  providers: [
    AiPortraitService,
    {
      provide: AI_PORTRAIT_PROFILE_REPOSITORY,
      useClass: AiPortraitProfilePrismaRepository,
    },
  ],
  exports: [AiPortraitService],
})
export class AiPortraitModule {}
