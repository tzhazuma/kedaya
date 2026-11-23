/**
 * 校园邮箱 · 模块装配
 *
 * 已在 `app.module.ts` 装配（路由 `/mail`）。三个端口 → 三个实现：
 *   · `MAIL_ACCOUNT_PORT`        → `MailAccountPrismaRepository`
 *   · `MAIL_MESSAGE_REPOSITORY`  → `MailMessagePrismaRepository`
 *   · `MAIL_INBOX_PORT`           → `MailImapAdapter`（imapflow，只读）
 *   · `MAIL_CLOCK`                → 系统时钟
 *
 * `MAIL_INBOX_PORT` 用 `useExisting` 别名到同一个 `MailImapAdapter` 实例：
 * 类本身也注册，方便测试/运维按具体类型取实例。
 *
 * `MAIL_MESSAGE_REPOSITORY` 对外导出：activities 模块要把邮件归一结果提升为
 * 活动时需要读到 `accountId`（用于解绑级联），但不应该复制一份 Prisma 查询。
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
  exports: [MailService, MAIL_MESSAGE_REPOSITORY],
})
export class MailModule {}
