/**
 * 朗读模块。
 *
 * ⚠️ 没有 Prisma 依赖 —— 朗读是**无状态**的（除了内存缓存），
 * 不碰数据库。所以这个模块在任何环境下都能加载，只是没模型时返回 503。
 */
import { Module } from '@nestjs/common';

import { TtsController } from './tts.controller';
import { TtsService } from './application/tts.service';

@Module({
  controllers: [TtsController],
  providers: [TtsService],
  exports: [TtsService],
})
export class TtsModule {}
