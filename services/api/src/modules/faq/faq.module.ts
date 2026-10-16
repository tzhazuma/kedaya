/**
 * 常见问题 · faq —— NestJS 装配
 *
 * ⚠️ 本文件**手写**（不在 scaffold SPEC 表里，理由见 domain/faq.domain.ts 顶部）。
 * 条目与工单两个端口由同一个 Prisma 仓储实例承担（`useExisting`）。
 */
import { Module } from '@nestjs/common';
import { RoleModule } from '../../common/auth/role.port';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { FaqPrismaRepository } from './data/faq.repository';
import { FAQ_ENTRY_REPOSITORY, FAQ_TICKET_REPOSITORY } from './domain/faq.domain';
import { FaqController } from './faq.controller';
import { FaqService } from './faq.service';

@Module({
  imports: [IdempotencyModule, RoleModule],
  controllers: [FaqController],
  providers: [
    FaqService,
    FaqPrismaRepository,
    { provide: FAQ_ENTRY_REPOSITORY, useExisting: FaqPrismaRepository },
    { provide: FAQ_TICKET_REPOSITORY, useExisting: FaqPrismaRepository },
  ],
  exports: [FaqService],
})
export class FaqModule {}
