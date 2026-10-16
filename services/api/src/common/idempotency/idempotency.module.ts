import { Global, Module } from '@nestjs/common';
import { IdempotencyStore } from './idempotency.store';

/**
 * 幂等能力（契约 §11.3）。
 *
 * `@Global()` 但**仍需被至少一个模块 import** —— 这里由 ForumModule / FaqModule
 * 各自 import（Nest 按类去重，两个模块拿到的是同一个 store 单例）。
 * 这样不必改 AppModule（跨工作流共享文件，减少并行写冲突）。
 */
@Global()
@Module({
  providers: [IdempotencyStore],
  exports: [IdempotencyStore],
})
export class IdempotencyModule {}
