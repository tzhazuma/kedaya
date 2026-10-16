/**
 * 论坛 · forum —— NestJS 装配
 *
 * ⚠️ 本文件**手写**（不在 scaffold SPEC 表里，理由见 domain/forum.domain.ts 顶部）。
 *
 * 三个仓储 token 用 `useExisting` 指向**同一个** Prisma 仓储实例
 * （它同时实现主题/版块/举报三个端口）—— 拆三个类只会多三份构造样板。
 */
import { Module } from '@nestjs/common';
import { RoleModule } from '../../common/auth/role.port';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { ForumPrismaRepository } from './data/forum.repository';
import {
  FORUM_BOARD_REPOSITORY,
  FORUM_POST_REPOSITORY,
  FORUM_REPORT_REPOSITORY,
  FORUM_USER_DIRECTORY,
} from './domain/forum.domain';
import { ForumController } from './forum.controller';
import { ForumService } from './forum.service';

@Module({
  imports: [IdempotencyModule, RoleModule],
  controllers: [ForumController],
  providers: [
    ForumService,
    ForumPrismaRepository,
    { provide: FORUM_POST_REPOSITORY, useExisting: ForumPrismaRepository },
    { provide: FORUM_BOARD_REPOSITORY, useExisting: ForumPrismaRepository },
    { provide: FORUM_REPORT_REPOSITORY, useExisting: ForumPrismaRepository },
    { provide: FORUM_USER_DIRECTORY, useExisting: ForumPrismaRepository },
  ],
  exports: [ForumService],
})
export class ForumModule {}
