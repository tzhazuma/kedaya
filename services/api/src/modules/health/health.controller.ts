import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * 健康检查 —— **容器/负载均衡/隧道探活专用**。
 *
 * ## 为什么这是源码功能而不是部署层的 shim
 *
 * 后端要长期跑在服务器上、前面挂着隧道，探活就必然需要一个稳定端点。
 * 用 `node -r compat-routes.cjs` 之类的**部署层 alias** 去"补"一个源码里不存在的路由，
 * 会让**跑验证的人以为这个能力存在**，而实际上：
 * - 它不进 dist、不进类型、不被任何测试覆盖；
 * - 换一台机器部署就没了；
 * - 路由表与源码不一致，是最难排查的一类问题。
 *
 * 所以放在源码里，并有 `health.controller.spec.ts` 锁住它的形状。
 *
 * ## 三条设计约束
 *
 * 1. **不碰数据库**。探活要能在数据库挂掉时仍然回答 ——
 *    否则数据库一慢，负载均衡就把健康实例也踢了，故障被放大。
 * 2. **不返回版本号以外的内部信息**。这是公开端点（隧道会暴露它），
 *    不泄露依赖清单、环境变量、构建路径。
 * 3. **`uptimeSec` 用整数秒**，便于监控做差值。
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  /** 进程启动时刻（模块加载时捕获，而不是每次请求现算） */
  private readonly startedAtMs = Date.now();

  @Get()
  @ApiOperation({
    summary: '健康检查（不触碰数据库）',
    description:
      '返回 `{ok, uptimeSec}`。**故意不查数据库** —— 探活必须在依赖故障时仍能回答，' +
      '否则数据库一慢就会把健康实例一起踢掉。',
  })
  check(): { ok: true; uptimeSec: number } {
    return {
      ok: true,
      uptimeSec: Math.max(0, Math.floor((Date.now() - this.startedAtMs) / 1000)),
    };
  }
}
