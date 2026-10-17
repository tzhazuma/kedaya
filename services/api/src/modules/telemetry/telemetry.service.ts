import { Inject, Injectable, Logger } from '@nestjs/common';
import { currentContext } from '../../common/context/request-context';
import {
  CLIENT_EVENT_RATE_LIMIT,
  SlidingWindowLimiter,
  normalizeClientEvent,
  truncate,
  type NormalizedClientEvent,
} from './domain/telemetry.domain';
import { TELEMETRY_REPOSITORY, type TelemetryRepository } from './data/telemetry.repository';

/** 控制器收到的原始事件（已由 Zod 收窄形状，但仍是不可信内容） */
export interface ClientEventInput {
  kind: string;
  message: string;
  stack?: string;
  route?: string;
  traceId?: string;
  platform?: string;
  appVersion?: string;
  context?: Record<string, unknown>;
}

export interface AcceptResult {
  /** 是否受理（false = 被限流丢掉） */
  accepted: boolean;
}

/**
 * 客户端遥测服务。
 *
 * ## 这份代码的第一原则：**绝不让上报本身变成故障源**
 *
 * 遥测是旁路。所以：
 *   · 落库失败**不抛错**，只记 `Logger.warn`，仍然返回 200 ——
 *     否则数据库一抖动，客户端会收到一个必然失败的请求，
 *     而它又会（在错误处理里）产生一条新的遥测……这就是自激振荡；
 *   · 超长字段**截断**而不是 400；
 *   · 未知 `kind` 归为 `error` 而不是丢弃；
 *   · 唯一会拒绝的情况是**限流**（防止有人把这张表当免费写入管道）。
 *
 * ## 为什么用 `currentContext()` 拿 ip / traceId
 *
 * 中间件已经把每请求的 `traceId` / `ip` / `ua` 放进了 AsyncLocalStorage，
 * 遥测没必要（也不应该）在控制器签名里再加 `@Req()` 之类的 HTTP 细节 ——
 * 那样服务层就没法在单测里被直接调用。
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly limiter = new SlidingWindowLimiter(
    CLIENT_EVENT_RATE_LIMIT.windowMs,
    CLIENT_EVENT_RATE_LIMIT.max,
  );
  /** 每 N 次调用清理一次限流窗口的过期键（避免 Map 随 IP 数无限增长） */
  private callsSinceSweep = 0;
  private static readonly SWEEP_EVERY = 200;

  constructor(
    @Inject(TELEMETRY_REPOSITORY) private readonly repository: TelemetryRepository,
  ) {}

  async accept(input: ClientEventInput): Promise<AcceptResult> {
    const context = currentContext();
    const now = Date.now();
    const source = context?.ip ?? 'unknown';

    this.callsSinceSweep += 1;
    if (this.callsSinceSweep >= TelemetryService.SWEEP_EVERY) {
      this.callsSinceSweep = 0;
      this.limiter.sweep(now);
    }

    if (!this.limiter.tryAcquire(source, now)) {
      // 限流命中只记 debug：这本身可能是一次疯狂重试，别把日志也刷爆
      this.logger.debug(`遥测被限流，来源 ${truncate(source, 64)}`);
      return { accepted: false };
    }

    // 客户端给的 traceId 与本次请求的 traceId 可能不同（上报是**另一次**请求）：
    // 客户端把它自己出错时的 traceId 带过来，才能和后端日志对上同一次失败请求。
    const event = normalizeClientEvent(input);

    try {
      await this.repository.save(event, {
        userId: context?.userId ?? null,
        ip: context?.ip ?? null,
        userAgent: context?.ua ?? null,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`遥测落库失败（已忽略，不影响客户端）：${truncate(reason, 200)}`);
    }

    // 无论落库成功与否都打一行结构化日志：云托管的日志检索是最快的排查入口，
    // 数据库只是"能按条件查"的补充。
    this.logger.warn(
      `[client:${event.kind}] ${event.message}` +
        (event.route === null ? '' : ` @${event.route}`) +
        (event.traceId === null ? '' : ` trace=${event.traceId}`),
    );

    return { accepted: true };
  }
}

/** 仅测试用 —— 断言归一化结果时不必构造整条链路 */
export type { NormalizedClientEvent };
