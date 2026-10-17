import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { ComplianceModule } from './common/compliance/compliance.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';
import { PrismaModule } from './prisma/prisma.module';

// 契约 §4.2 基础模块（5）
import { AuthModule } from './modules/auth/auth.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { CampusCardModule } from './modules/campus-card/campus-card.module';
import { ProfileModule } from './modules/profile/profile.module';
import { NotificationModule } from './modules/notifications/notifications.module';

// 契约 §4.1 业务模块（14）
import { GroupbuyModule } from './modules/groupbuy/groupbuy.module';
import { TakeoutGuardModule } from './modules/takeout-guard/takeout-guard.module';
import { FleaMarketModule } from './modules/flea-market/flea-market.module';
import { DormHarmonyModule } from './modules/dorm-harmony/dorm-harmony.module';
import { ErrandModule } from './modules/errand/errand.module';
import { BuddyModule } from './modules/buddy/buddy.module';
import { LostFoundModule } from './modules/lost-found/lost-found.module';
import { CanteenModule } from './modules/canteen/canteen.module';
import { ForumModule } from './modules/forum/forum.module';
import { AiPortraitModule } from './modules/ai-portrait/ai-portrait.module';
import { WellbeingModule } from './modules/wellbeing/wellbeing.module';
import { FaqModule } from './modules/faq/faq.module';
import { TechpieModule } from './modules/techpie/techpie.module';
import { WildlifeModule } from './modules/wildlife/wildlife.module';

/**
 * 应用根模块 —— 契约 §4 的 **19 个模块全部装配**。
 *
 * 三个全局提供者（契约 §6.1 的统一约定都靠它们落地）：
 *   APP_PIPE       ZodValidationPipe   —— 全站唯一校验入口
 *   APP_INTERCEPTOR EnvelopeInterceptor —— 成功响应收敛成 ApiEnvelope
 *   APP_FILTER     AllExceptionsFilter —— 异常收敛成 ApiEnvelope 失败形态
 *
 * 注意 trace 中间件**不**在这里用 `MiddlewareConsumer.forRoutes('*')` 注册：
 * Express 5 的 path-to-regexp 不再接受裸 `*` 通配符，
 * 因此改在 main.ts 用 `app.use()` 注册（见那里的注释）。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      cache: true,
    }),

    // 基础设施 + 合规层（都是 @Global）
    PrismaModule,
    ComplianceModule,

    // 19 个业务/基础模块
    AuthModule,
    ScheduleModule,
    CampusCardModule,
    ProfileModule,
    NotificationModule,
    GroupbuyModule,
    TakeoutGuardModule,
    FleaMarketModule,
    DormHarmonyModule,
    ErrandModule,
    BuddyModule,
    LostFoundModule,
    CanteenModule,
    ForumModule,
    AiPortraitModule,
    WellbeingModule,
    FaqModule,
    TechpieModule,
    WildlifeModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
