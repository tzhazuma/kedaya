/**
 * 校园活动 · 模块装配（路由 `/activities`）
 *
 * 依赖：
 *   · `MailModule`         —— 复用只读 IMAP 归一结果（`MAIL_MESSAGE_REPOSITORY`）
 *   · `WechatModule`       —— 复用单篇公众号抓取/解析（`WechatArticleService`）
 *   · `NotificationModule` —— 严格站内信端口（失败必须抛出，提醒才能回退重试）
 *   · `IdempotencyModule`  —— POST 的 `Idempotency-Key`
 *
 * 刻意**不**引入 `@nestjs/schedule`：派发由外部 cron 调
 * `POST /activities/reminders/dispatch`，避免每个 API 副本各自定时、
 * 也避免把"定时"这件事藏进进程内。
 */

import { Module } from '@nestjs/common';

import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { MailModule } from '../mail/mail.module';
import { NotificationModule } from '../notifications/notifications.module';
import { WechatModule } from '../wechat/wechat.module';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './application/activities.service';
import { ActivityPrismaRepository } from './data/activity.prisma-repository';
import { ActivityReminderPrismaRepository } from './data/activity-reminder.prisma-repository';
import {
  ACTIVITY_CLOCK,
  ACTIVITY_REMINDER_REPOSITORY,
  ACTIVITY_REPOSITORY,
} from './domain/activities.domain';

@Module({
  imports: [IdempotencyModule, MailModule, WechatModule, NotificationModule],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesService,
    ActivityPrismaRepository,
    { provide: ACTIVITY_REPOSITORY, useExisting: ActivityPrismaRepository },
    ActivityReminderPrismaRepository,
    { provide: ACTIVITY_REMINDER_REPOSITORY, useExisting: ActivityReminderPrismaRepository },
    { provide: ACTIVITY_CLOCK, useValue: { now: () => new Date() } },
  ],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
