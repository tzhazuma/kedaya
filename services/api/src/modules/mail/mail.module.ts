/**
 * 校园邮箱 · 模块装配
 *
 * ⚠️ **本模块不会被 `app.module.ts` 自动发现**。Lead 负责统一注册；
 * 本文件刻意不 import 任何根模块，也不修改 `app.module.ts`，
 * 以免与并行任务冲突。
 *
 * 三个端口 → 三个实现：
 *   · `MAIL_ACCOUNT_PORT`        → `MailAccountPrismaRepository`
 *   · `MAIL_MESSAGE_REPOSITORY`  → `MailMessagePrismaRepository`
 *   · `MAIL_INBOX_PORT`           → `MailImapAdapter`（imapflow，只读）
 *   · `MAIL_CLOCK`                → 系统时钟
 *
 * `MAIL_INBOX_PORT` 用 `useExisting` 别名到同一个 `MailImapAdapter` 实例：
 * 类本身也注册，方便测试/运维按具体类型取实例。
 */

import { Module } from '@nestjs/common';
import { MailService } from './application/mail.service';
import { MailAccountPrismaRepository } from './data/mail-account.prisma-repository';
import { MailMessagePrismaRepository } from './data/mail-event.prisma-repository';
import { MailImapAdapter } from './data/mail-imap.adapter';
import { MAIL_ACCOUNT_PORT, MAIL_CLOCK, MAIL_MESSAGE_REPOSITORY } from './domain/mail.domain';
import { MAIL_INBOX_PORT } from './domain/ports/mail-inbox.port';
import { MailController } from './mail.controller';

@Module({
  controllers: [MailController],
  providers: [
    MailService,
    MailAccountPrismaRepository,
    { provide: MAIL_ACCOUNT_PORT, useExisting: MailAccountPrismaRepository },
    MailMessagePrismaRepository,
    { provide: MAIL_MESSAGE_REPOSITORY, useExisting: MailMessagePrismaRepository },
    MailImapAdapter,
    { provide: MAIL_INBOX_PORT, useExisting: MailImapAdapter },
    { provide: MAIL_CLOCK, useValue: { now: () => new Date() } },
  ],
  exports: [MailService],
})
export class MailModule {}
