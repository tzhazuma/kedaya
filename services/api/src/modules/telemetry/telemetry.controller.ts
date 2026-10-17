import { Controller, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { OptionalAuthGuard } from '../../common/auth/auth.guard';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { TelemetryService } from './telemetry.service';
import { CLIENT_EVENT_LIMITS } from './domain/telemetry.domain';

/**
 * 客户端遥测 HTTP 层。
 *
 * ## 路由为什么是字面量 `telemetry`，而不是 `modulePath('telemetry')`
 *
 * `modulePath` 依赖 `@kedaya/contracts` 的 `MODULES`，而契约 §4 把模块清单
 * **冻结为 19 个用户可见模块**。遥测是基础设施，混进去会同时打破
 * `apps/web` 的交付状态断言和首页宫格 —— 所以这里刻意用一个非模块路径。
 *
 * ## 为什么挂 `OptionalAuthGuard` 而不是 `AuthGuard`
 *
 * 崩溃最常发生在**登录之前**（冷启动、token 过期、登录页本身报错）。
 * 要求登录等于在最需要日志的场景静默丢掉全部上报。
 * 有登录态时顺手记下 `userId`（守卫会回填请求上下文），没有也照收 ——
 * 内容已经脱敏，且匿名可写的接口天然要限流（见 `TelemetryService`）。
 */

const clientEventSchema = z.object({
  kind: z.string().trim().min(1).max(40),
  // 上限放宽到归一化上限的 2 倍：Zod 负责挡掉"明显是攻击"的超长体，
  // 而"只超了一点"由 domain 的 truncate 平滑处理 —— 后者不报错，避免丢整条日志。
  message: z.string().trim().min(1).max(CLIENT_EVENT_LIMITS.message * 2),
  stack: z.string().max(CLIENT_EVENT_LIMITS.stack * 2).optional(),
  route: z.string().max(CLIENT_EVENT_LIMITS.route * 2).optional(),
  traceId: z.string().max(CLIENT_EVENT_LIMITS.traceId * 2).optional(),
  platform: z.string().max(32).optional(),
  appVersion: z.string().max(CLIENT_EVENT_LIMITS.appVersion * 2).optional(),
  /**
   * `context` 只允许标量：与 `normalizeContext` 的白名单一致。
   * 用 `unknown` 会让"客户端塞了一棵 10 层的树"通过校验、再在归一化时才被丢掉 ——
   * 两处规则不一致是最容易出事的地方，所以校验层就收窄。
   */
  context: z
    .record(z.string().max(40), z.union([z.string().max(400), z.number(), z.boolean(), z.null()]))
    .optional(),
});

type ClientEventBody = z.infer<typeof clientEventSchema>;

@ApiTags('telemetry · 客户端遥测')
@Controller('telemetry')
@UseGuards(OptionalAuthGuard)
export class TelemetryController {
  constructor(@Inject(TelemetryService) private readonly service: TelemetryService) {}

  /**
   * `@HttpCode(200)` 是必要的：Nest 对 POST 默认返回 201，
   * 而这里并没有创建"资源"，201 会让客户端与监控误判。
   */
  @Post('client-events')
  @HttpCode(200)
  @ApiOperation({
    summary: '上报一条客户端事件（崩溃 / 未处理拒绝 / 服务端故障 / 404 页面）',
    description:
      '匿名可调用（崩溃常发生在登录前）；内容在服务端脱敏与截断；按来源限流。' +
      '落库失败也不影响响应 —— 遥测不得成为新的故障源。',
  })
  report(@ZodBody(clientEventSchema) body: ClientEventBody) {
    return this.service.accept(body);
  }
}
