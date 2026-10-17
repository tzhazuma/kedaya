/**
 * TechPie 整合 · 模块装配（规格 §8.1）
 *
 * ## 两个端口、两个实现，**物理隔离**
 *
 * | 端口 | 实现 | 说明 |
 * | --- | --- | --- |
 * | `CAMPUS_SESSION_PORT` | `CampusSessionService` | 第二级能力层；凭证的唯一落点 |
 * | `WEBVIEW_ALLOWLIST_PORT` | `WebviewSessionService` | 白名单占位标记的只读视图 |
 *
 * ⚠️ **`CampusSessionService` 刻意不住在 `modules/auth/`**：
 * 契约 §5 硬规则 1 要求两级身份在**实现层**也不耦合，
 * 不变式 **I2** 把它钉成静态扫描（`modules/auth/data/**` 不得 import `campus-session.port`）。
 * 实现放在身份模块里，那条扫描就只能靠"没写 import"通过，而真正的耦合依然存在。
 *
 * ⚠️ **本模块已移出 `scripts/scaffold.mjs` 的 SPEC 表** ——
 * 否则 `npm run scaffold` 会把下面这些手写实现覆盖回脚手架占位形状。
 */
import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { CampusBindingGuard } from './data/campus-binding.guard';
import { CampusSessionService } from './data/campus-session.service';
import { TechpieLinkPrismaRepository, TechpieSyncJobPrismaRepository } from './data/techpie.repository';
import { WebviewTicketStore } from './data/webview-session/ticket.store';
import { DisabledCookieDelivery, WebviewSessionService, WEBVIEW_COOKIE_DELIVERY } from './data/webview-session/webview-session.service';
import { CAMPUS_SESSION_PORT } from './domain/ports/campus-session.port';
// ⚠️ 合并同学分支后，auth 与 techpie 各有一套 `CAMPUS_SESSION_PORT` 符号。
// `CampusBindingGuard` 用的是 **auth 的**符号（它要能同时在 ScheduleModule 里解析），
// 而 TechpieModule 提供的是 techpie 的符号 —— 于是与守卫同模块时解析不到。
// 这里把 auth 的符号**别名**到同一个实例，两个符号指向同一份实现。
// 根治办法是统一两套 port 与枚举（记录为待办）。
import { CAMPUS_SESSION_PORT as AUTH_CAMPUS_SESSION_PORT } from '../auth/domain/auth.domain';
import { WEBVIEW_ALLOWLIST_PORT, type WebviewAllowlistPort } from './domain/ports/webview-allowlist.port';
import {
  TECHPIE_LINK_REPOSITORY,
  TECHPIE_SYNC_JOB_REPOSITORY,
} from './domain/techpie.domain';
import { TechpieController } from './techpie.controller';
import { TechpieService } from './techpie.service';

@Module({
  imports: [IdempotencyModule],
  controllers: [TechpieController],
  providers: [
    TechpieService,
    { provide: TECHPIE_LINK_REPOSITORY, useClass: TechpieLinkPrismaRepository },
    { provide: TECHPIE_SYNC_JOB_REPOSITORY, useClass: TechpieSyncJobPrismaRepository },
    CampusSessionService,
    { provide: CAMPUS_SESSION_PORT, useExisting: CampusSessionService },
    { provide: AUTH_CAMPUS_SESSION_PORT, useExisting: CampusSessionService },
    // 校园绑定守卫（不变式 I4 的通用落点）：schedule 等校园能力模块用它，
    // 因此必须 export，否则 `@UseGuards(CampusBindingGuard)` 在别的模块里解析不到。
    CampusBindingGuard,
    WebviewTicketStore,
    WebviewSessionService,
    // 白名单只读视图：与 WebviewSessionService 是**同一个实例**（`useExisting`），
    // 因此"白名单是占位"这个事实只有一个来源。
    { provide: WEBVIEW_ALLOWLIST_PORT, useExisting: WebviewSessionService },
    // Phase 0 的 cookie 投递实现：**拒绝**（见 DisabledCookieDelivery 的注释）。
    // 换成 W3（表单 POST）需要信息办书面确认 —— 那时只替换这一个 provider。
    { provide: WEBVIEW_COOKIE_DELIVERY, useClass: DisabledCookieDelivery },
  ],
  exports: [
    TechpieService,
    CampusSessionService,
    CAMPUS_SESSION_PORT,
    CampusBindingGuard,
    WebviewSessionService,
    WebviewTicketStore,
    WEBVIEW_ALLOWLIST_PORT,
  ],
})
export class TechpieModule {}

/**
 * 编译期防漂移断言：`WebviewSessionService` 必须**结构上**满足
 * `WEBVIEW_ALLOWLIST_PORT` 的接口。
 *
 * 为什么需要它：`useExisting` **不做类型检查** —— 形状对不上时只会静默注入一个
 * 缺字段的对象，表现为响应里某个字段变成 `undefined`。
 * 这个缺陷真实发生过一次（`GET /techpie/capabilities` 的 `allowlistPlaceholder`），
 * 由 `test/techpie-http.spec.ts` 抓出来。现在它会在 `npm run typecheck` 阶段就失败。
 */
type AssertAssignable<Target, _Actual extends Target> = true;
export type WebviewSessionServiceSatisfiesAllowlistPort = AssertAssignable<
  WebviewAllowlistPort,
  WebviewSessionService
>;
