/**
 * 联系方式交换（U8）· Nest 模块装配
 *
 * ## 这不是契约 §4 的用户可见模块
 *
 * `contact-exchange` 是跨模块的隐私基础设施：搭子 / 拼单 / 跑腿等在
 * 「双方同意」后调用它，而不是各自发明一套"交换微信号"的字段。
 * 因此它**不进** `@kedaya/contracts` 的 `MODULES`（那会改变 20 个模块的
 * 宫格与交付状态断言），路由也独立挂在 `/contact-exchange`。
 *
 * ## 依赖装配
 *
 * | token | 实现 | 说明 |
 * | --- | --- | --- |
 * | `CONTACT_EXCHANGE_REPOSITORY` | `PrismaContactExchangeRepository` | 唯一碰 Prisma 的地方 |
 * | `CONTACT_EXCHANGE_CIPHER` | `AesGcmContactCrypto` | 构造时校验密钥；缺失 → **启动失败** |
 *
 * 用 `useExisting` 而不是 `useClass`：token 只是类实例的别名，DI 图里
 * 不会出现两个实例（与 buddy 模块同一约定）。
 */

import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { ContactExchangeController } from './contact-exchange.controller';
import { ContactEntryService } from './application/contact-entry.service';
import { ContactExchangeService } from './application/contact-exchange.service';
import { ContactAuditService } from './application/contact-audit.service';
import { PrismaContactExchangeRepository } from './data/contact-exchange.repository';
import { AesGcmContactCrypto } from './data/aes-gcm-contact.crypto';
import {
  CONTACT_EXCHANGE_CIPHER,
  CONTACT_EXCHANGE_REPOSITORY,
} from './domain/contact-exchange.domain';

@Module({
  // IdempotencyModule 是 @Global 的，但仍需被至少一个模块 import（Nest 按类去重）。
  imports: [IdempotencyModule],
  controllers: [ContactExchangeController],
  providers: [
    PrismaContactExchangeRepository,
    // 构造函数里读 CONTACT_EXCHANGE_ENC_KEY：缺失/长度错误直接抛错，
    // 让 `AppModule` 装配失败（fail closed），而不是运行到第一次写入才发现。
    AesGcmContactCrypto,
    ContactEntryService,
    ContactExchangeService,
    ContactAuditService,
    { provide: CONTACT_EXCHANGE_REPOSITORY, useExisting: PrismaContactExchangeRepository },
    { provide: CONTACT_EXCHANGE_CIPHER, useExisting: AesGcmContactCrypto },
  ],
  exports: [ContactExchangeService],
})
export class ContactExchangeModule {}
