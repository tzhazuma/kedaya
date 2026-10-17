import { Module } from '@nestjs/common';
import { NOTIFICATION_PORT } from '../../common/notifications/notification.port';
import { NotificationController } from './notifications.controller';
import { NotificationService } from './notifications.service';
import { NotificationPrismaRepository } from './data/notifications.repository';
import { NOTIFICATION_REPOSITORY } from './domain/notifications.domain';

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
  controllers: [NotificationController],
  providers: [
    NotificationService,
    { provide: NOTIFICATION_REPOSITORY, useClass: NotificationPrismaRepository },
    { provide: NOTIFICATION_PORT, useExisting: NotificationService },
  ],
  exports: [NotificationService, NOTIFICATION_PORT],
})
export class NotificationModule {}
