import { Module } from "@nestjs/common";
import {
  NOTIFICATION_PORT,
  NOTIFICATION_STRICT_PORT,
} from "../../common/notifications/notification.port";
import { NotificationController } from "./notifications.controller";
import { NotificationService } from "./notifications.service";
import { NotificationPrismaRepository } from "./data/notifications.repository";
import { NOTIFICATION_REPOSITORY } from "./domain/notifications.domain";
import { ConfigService } from "@nestjs/config";
import { PUSH_PROVIDERS, createPushProviders } from "./push/push.factory";
import {
  PUSH_REPOSITORY,
  PushPrismaRepository,
} from "./push/push.prisma-repository";
import { PushAdminController, PushDispatchWorker } from "./push/push.runtime";
import { PushService } from "./push/push.service";
import type { PushChannel, PushRepository } from "./push/push.service";
import type { PushProvider } from "./push/push.providers";

/**
 * 通知模块。
 *
 * 对外的两个出口：
 *   · `NOTIFICATION_PORT` —— 给**其它业务模块**写通知用（只依赖端口，不知道实现）；
 *   · `NotificationService` —— 给需要读未读数之类的场景用（目前只有本模块的控制器）。
 *
 * 业务模块（groupbuy / errand / flea-market / forum）在各自的 `imports` 里
 * 引入本模块，才能让 `@Inject(NOTIFICATION_PORT)` 解析到值。
 */
@Module({
  controllers: [NotificationController, PushAdminController],
  providers: [
    NotificationService,
    {
      provide: NOTIFICATION_REPOSITORY,
      useClass: NotificationPrismaRepository,
    },
    { provide: NOTIFICATION_PORT, useExisting: NotificationService },
    { provide: NOTIFICATION_STRICT_PORT, useExisting: NotificationService },
    { provide: PUSH_REPOSITORY, useClass: PushPrismaRepository },
    {
      provide: PUSH_PROVIDERS,
      useFactory: createPushProviders,
      inject: [ConfigService],
    },
    {
      provide: PushService,
      useFactory: (
        repo: PushRepository,
        providers: Partial<Record<PushChannel, PushProvider>>,
      ) => new PushService(repo, providers),
      inject: [PUSH_REPOSITORY, PUSH_PROVIDERS],
    },
    PushDispatchWorker,
  ],
  exports: [
    NotificationService,
    NOTIFICATION_PORT,
    NOTIFICATION_STRICT_PORT,
    PushService,
  ],
})
export class NotificationModule {}
