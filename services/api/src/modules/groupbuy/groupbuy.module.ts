import { Module } from '@nestjs/common';
import { NotificationModule } from '../notifications/notifications.module';
import { GroupbuyController } from './groupbuy.controller';
import { GroupbuyOrderService } from './groupbuy.service';
import { GroupbuyOrderPrismaRepository } from './data/groupbuy.repository';
import { GROUPBUY_ORDER_REPOSITORY } from './domain/groupbuy.domain';

/**
 * 拼单模块。
 *
 * `imports: [NotificationModule]` 是为了让 `NOTIFICATION_PORT` 能解析到值 ——
 * 模块之间只通过端口耦合，拼单模块并不知道站内信是怎么落库的。
 */
@Module({
  imports: [NotificationModule],
  controllers: [GroupbuyController],
  providers: [
    GroupbuyOrderService,
    { provide: GROUPBUY_ORDER_REPOSITORY, useClass: GroupbuyOrderPrismaRepository },
  ],
  exports: [GroupbuyOrderService],
})
export class GroupbuyModule {}
