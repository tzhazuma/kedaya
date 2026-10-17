import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { ComplianceModule } from './common/compliance/compliance.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { MediaModule } from './common/media/media.module';
import { TraceMiddleware } from './common/middleware/trace.middleware';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';
import { PrismaModule } from './prisma/prisma.module';

// 契约 §4.2 基础模块（5）
import { AuthModule } from './modules/auth/auth.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { CampusCardModule } from './modules/campus-card/campus-card.module';
import { ProfileModule } from './modules/profile/profile.module';
import { NotificationModule } from './modules/notifications/notifications.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';

// 契约 §4.1 业务模块（14）
import { GroupbuyModule } from './modules/groupbuy/groupbuy.module';
import { TakeoutGuardModule } from './modules/takeout-guard/takeout-guard.module';
import { FleaMarketModule } from './modules/flea-market/flea-market.module';
import { DormHarmonyModule } from './modules/dorm-harmony/dorm-harmony.module';
import { ErrandModule } from './modules/errand/errand.module';
import { BuddyModule } from './modules/buddy/buddy.module';
import { LostFoundModule } from './modules/lost-found/lost-found.module';
import { CanteenModule } from './modules/canteen/canteen.module';
import { FacilityModule } from './modules/facility/facility.module';
import { ForumModule } from './modules/forum/forum.module';
import { AiPortraitModule } from './modules/ai-portrait/ai-portrait.module';
import { WellbeingModule } from './modules/wellbeing/wellbeing.module';
import { FaqModule } from './modules/faq/faq.module';
import { TechpieModule } from './modules/techpie/techpie.module';
import { WildlifeModule } from './modules/wildlife/wildlife.module';
// 跨模块隐私基础设施（不是契约 §4 的用户可见模块）：U8 联系方式交换
import { ContactExchangeModule } from './modules/contact-exchange/contact-exchange.module';

/**
 * 应用根模块 —— 契约 §4 的 **20 个模块全部装配**（v1.2 §11.10-C 新增 `facility`），
 * 另加一个**非用户可见**的跨模块隐私基础设施 `contact-exchange`（U8 联系方式交换）。
 * 后者刻意不进 `@kedaya/contracts` 的 `MODULES`：它没有首页宫格，也不改变
 * 三端"20 个模块"的交付状态断言。
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
    MediaModule,

    // 运维/治理旁路（不属于用户可见模块，故意不进 @kedaya/contracts 的 MODULES）
    TelemetryModule,

    // 20 个业务/基础模块（14 业务 + 5 基础 + facility）
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
    FacilityModule,
    ForumModule,
    AiPortraitModule,
    WellbeingModule,
    FaqModule,
    TechpieModule,
    WildlifeModule,
    // 联系方式交换（U8）：跨模块隐私基础设施，路由 /contact-exchange
    ContactExchangeModule,
  ],
  providers: [
    // TraceMiddleware 必须**显式提供**：虽然它由 `configure(consumer)` 挂载，
    // 但 `app.get(TraceMiddleware)` 是装配测试的核对点 —— 一个只被 `apply()`
    // 引用、却没进 providers 的类，在新版 Nest 里取不到实例（DI 容器里没有它）。
    TraceMiddleware,
    /*
     * ⚠️ 必须是 `useValue`，**不能**是 `useClass`。
     *
     * `ZodValidationPipe` 的构造函数是 `(schema?: ZodType, what = '请求参数')` ——
     * 那两个参数是**可选的配置**，不是依赖。而 Nest 对 `useClass` 提供者
     * 一律走依赖注入：它会按 `design:paramtypes` 去解析 index 0 的 `Object`，
     * 解析不到就抛
     *   `Nest can't resolve dependencies of the ZodValidationPipe (?, Object)`
     * —— **整个应用起不来**（20 个模块一起挂）。
     *
     * 这个缺陷原先存在，是本次实现 buddy 时由
     * `test/app-module.spec.ts`（真实装配 AppModule）抓出来的。
     * 修法：用 `useValue` 直接给一个实例，绕开 DI 解析。
     * 行为完全不变 —— 不带 schema 的全局管道本来就是透传形态，
     * 逐路由校验一直由 `@ZodBody` / `@ZodQuery` 复用同一个 `parseWith`。
     */
    { provide: APP_PIPE, useValue: new ZodValidationPipe() },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },

    /*
     * trace 中间件**必须**是提供者，即使它不用 `MiddlewareConsumer.forRoutes`
     * 注册（见类头注释：Express 5 不接受裸 `*`，改在 main.ts 用 `app.use()`）。
     *
     * 原因：`main.ts` 与 `test/app-assembly.spec.ts` 都走 `app.get(TraceMiddleware)`
     * 取实例 —— 而 `app.get()` 只查**容器里的提供者**。
     * 只 import 不 provide 会让真实服务启动时就抛
     *   `Nest could not find TraceMiddleware element`
     * （即装配合法但服务起不来），这个缺陷由 `test/app-assembly.spec.ts` 抓出来。
     */
    TraceMiddleware,
  ],
})
export class AppModule {}
