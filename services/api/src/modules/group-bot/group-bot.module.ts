/**
 * 群机器人接入 · Nest 模块装配
 *
 * ## 这不是契约 §4 的用户可见模块
 * 它是**基础设施**：把官方支持的 QQ 群/企业微信群消息落成待确认草稿。
 * 因此不进 `@kedaya/contracts` 的 `MODULES`，路由独立挂 `/group-bot`。
 *
 * ## 默认关闭
 * `GROUP_BOT_ENABLED` 不是 `'true'` 时 webhook 一律 403。
 * 接入是**显式动作** —— 不能因为误配了公钥就开始被动接收群消息。
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GroupBotController } from './group-bot.controller';
import { GroupBotService } from './group-bot.service';
import { PrismaGroupDraftRepository } from './data/group-bot.prisma-repository';
import { GROUP_DRAFT_REPOSITORY } from './domain/group-bot.repository';

@Module({
  imports: [PrismaModule],
  controllers: [GroupBotController],
  providers: [
    GroupBotService,
    // `useExisting` 而不是 `useClass`：token 只是类实例的别名，
    // DI 图里不会出现两个实例（与 buddy / contact-exchange 同一约定）
    { provide: GROUP_DRAFT_REPOSITORY, useExisting: PrismaGroupDraftRepository },
    PrismaGroupDraftRepository,
  ],
  exports: [GroupBotService],
})
export class GroupBotModule {}
